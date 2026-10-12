#!/usr/bin/env bash
# Ticket 53 (spec 13, "Local script", user stories 23-25): the one
# master-powered step on the database, run deliberately by the maintainer.
#
#   scripts/db-bootstrap.sh <db-sha>
#
# Runs db/bootstrap.sql (the DB image's bootstrap.cjs) as a one-off ECS task
# inside AWS, so the RDS master password never reaches this machine: ECS
# injects it from the RDS-managed secret through the bootstrap family's
# execution role (infra/prod/iam.tf), the only principal that can read it.
# No GitHub role can run that family or pass its role (infra/bootstrap/
# names.tf leaves them out on purpose), which is why this is a local script
# and not a workflow step.
#
# Run it once after the first prod apply, and again whenever the bootstrap
# SQL changes (it's idempotent). Needs the admin user's credentials
# (`aws login --profile pensieve-admin`; export AWS_PROFILE), cosign 3 and jq.
# <db-sha> is the main commit whose release published the DB image (its
# `sha-<7>` tag in ECR's pensieve-db).
#
# 1. Resolves the tag to its digest and verifies that digest's keyless
#    signature against db.yml's publish-db on main (the identity
#    .github/actions/publish-image signs with), before touching ECS.
# 2. Registers a new revision of pensieve-db-bootstrap from the family's
#    latest one with only the image changed (to the digest-pinned
#    reference): Terraform owns everything else in it. A re-run on the
#    image the latest revision already has reuses that revision.
# 3. Runs it with `ecs run-task` in the service's subnets and security group
#    (read from the service, so no IDs live here), waits for it to stop, and
#    exits non-zero unless the container exited 0, printing the CloudWatch
#    log group and stream either way.
set -euo pipefail

readonly cluster=pensieve
readonly service=pensieve
readonly family=pensieve-db-bootstrap
readonly container=db-bootstrap
readonly repository=pensieve-db
readonly identity=https://github.com/sgspinola/pensieve/.github/workflows/db.yml@refs/heads/main
readonly issuer=https://token.actions.githubusercontent.com
# Prod's only region (infra/prod/names.tf), whatever the profile says.
export AWS_REGION=eu-north-1

die() {
  echo "db-bootstrap: $*" >&2
  exit 1
}

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "usage: $0 <db-sha>  (the main commit whose release published the DB image, 7-40 hex chars)" >&2
  exit 2
fi
readonly tag="sha-${1:0:7}"

for tool in aws cosign jq; do
  command -v "$tool" >/dev/null || die "$tool not found on PATH"
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --- 1. verify ----------------------------------------------------------------
# The account ID isn't committed (public repository): read it from the caller.
account=$(aws sts get-caller-identity --output json | jq -er .Account)
registry="$account.dkr.ecr.$AWS_REGION.amazonaws.com"
digest=$(aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$tag" --output json |
  jq -er '.imageDetails[0].imageDigest') || die "no $repository image tagged $tag"
image="$registry/$repository@$digest"

# cosign reads registry credentials from a Docker config; a throwaway one, so
# the ECR token doesn't outlive the run in ~/.docker.
export DOCKER_CONFIG="$work/docker"
aws ecr get-login-password | cosign login "$registry" --username AWS --password-stdin >/dev/null
echo "Verifying $image ($tag)"
cosign verify --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" "$image" >/dev/null ||
  die "signature verification failed for $image: not published by db.yml on main"

# --- 2. register --------------------------------------------------------------
# The latest ACTIVE revision, with its tags (default_tags in infra/prod).
aws ecs describe-task-definition --task-definition "$family" --include TAGS --output json >"$work/latest.json"
latest_arn=$(jq -er .taskDefinition.taskDefinitionArn "$work/latest.json")
jq -e --arg c "$container" '[.taskDefinition.containerDefinitions[] | select(.name == $c)] | length == 1' \
  "$work/latest.json" >/dev/null || die "$latest_arn has no single container named $container"

if jq -e --arg c "$container" --arg image "$image" \
  '.taskDefinition.containerDefinitions[] | select(.name == $c) | .image == $image' "$work/latest.json" >/dev/null; then
  # A re-run on the same image: nothing to register.
  task_definition=$latest_arn
else
  # register-task-definition rejects the fields only describe returns, and
  # an empty tags list.
  jq --arg c "$container" --arg image "$image" '
    (.tags // []) as $tags
      | .taskDefinition
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)
      | .containerDefinitions |= map(if .name == $c then .image = $image else . end)
      | if ($tags | length) > 0 then .tags = $tags else . end
  ' "$work/latest.json" >"$work/register.json"
  task_definition=$(aws ecs register-task-definition --cli-input-json "file://$work/register.json" --output json |
    jq -er .taskDefinition.taskDefinitionArn)
fi
echo "Task definition: $task_definition"

# --- 3. run -------------------------------------------------------------------
# The service's subnets, security group and public-IP setting (no IDs here).
network=$(aws ecs describe-services --cluster "$cluster" --services "$service" --output json |
  jq -ec '.services[0].networkConfiguration // error("none")') ||
  die "couldn't read service $service's network configuration"

aws ecs run-task --cluster "$cluster" --task-definition "$task_definition" --launch-type FARGATE \
  --count 1 --network-configuration "$network" --started-by db-bootstrap-script --output json >"$work/run.json"
task_arn=$(jq -er '.tasks[0].taskArn // empty' "$work/run.json") ||
  die "ECS didn't start the task: $(jq -c .failures "$work/run.json")"

# awslogs names the stream <prefix>/<container>/<task ID>.
log_option() {
  jq -er --arg c "$container" --arg o "$1" \
    '.taskDefinition.containerDefinitions[] | select(.name == $c) | .logConfiguration.options[$o]' "$work/latest.json"
}
log_group=$(log_option awslogs-group)
log_stream="$(log_option awslogs-stream-prefix)/$container/${task_arn##*/}"
logs() {
  echo "Log group:  $log_group"
  echo "Log stream: $log_stream"
  echo "  aws logs tail $log_group --log-stream-names $log_stream --region $AWS_REGION"
}

echo "Started $task_arn; waiting for it to stop"
if ! aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"; then
  logs
  die "gave up waiting for $task_arn to stop; it may still be running"
fi

aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --output json >"$work/task.json"
exit_code=$(jq -r --arg c "$container" \
  '.tasks[0].containers[] | select(.name == $c) | .exitCode // "none"' "$work/task.json")
logs
if [[ $exit_code != 0 ]]; then
  die "bootstrap failed: container exit code $exit_code ($(jq -r '.tasks[0].stoppedReason // "no reason given"' "$work/task.json"))"
fi
echo "Bootstrap succeeded on $image"
