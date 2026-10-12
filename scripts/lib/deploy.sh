# shellcheck shell=bash
# Tickets 52-54: what the deploy scripts share (scripts/db-bootstrap.sh,
# scripts/deploy-db.sh, scripts/deploy-app.sh). Sourced, not run.
# Callers `set -euo pipefail` first. Needs aws, cosign 3 and jq on PATH, and
# AWS credentials: the admin user's locally, a deploy role's in CI.
#
# Bash 3.2 compatible: macOS's /bin/bash runs db-bootstrap.sh locally. So
# no `inherit_errexit`, and `set -e` doesn't reach into the $(...) these
# functions return values through, or into a function called from `if` or
# `||`: each checks its own failures (`|| die`, `jq -e` on what it read).
#
# Every image is verified by digest against the keyless signature of the
# workflow that published it on main (.github/actions/publish-image), and
# used by that digest from then on, so what runs is what was verified.

readonly cluster=pensieve
readonly service=pensieve
readonly issuer=https://token.actions.githubusercontent.com
readonly workflows=https://github.com/sgspinola/pensieve/.github/workflows
# Prod's only region (infra/prod/names.tf), whatever the profile says.
export AWS_REGION=eu-north-1

die() {
  echo "$(basename "$0" .sh): $*" >&2
  summary ":x: $*"
  exit 1
}

# Usage: summary <markdown line>; appends to the GitHub job summary, if any.
summary() {
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    echo "$*" >>"$GITHUB_STEP_SUMMARY"
  fi
}


# Usage: deploy_init; call once, after validating arguments and before
# anything else here. Sets $work (a scratch directory, removed on exit) and
# $registry, and logs cosign in to ECR.
deploy_init() {
  local tool account
  for tool in aws cosign jq; do
    command -v "$tool" >/dev/null || die "$tool not found on PATH"
  done

  work=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: $work is fixed for the run
  trap "rm -rf '$work'" EXIT

  # cosign reads registry credentials from a Docker config; a throwaway one,
  # so the ECR token doesn't outlive the run in ~/.docker.
  export DOCKER_CONFIG="$work/docker"
  # The account ID isn't committed (public repository): read it from the caller.
  account=$(aws sts get-caller-identity --output json | jq -er .Account)
  registry="$account.dkr.ecr.$AWS_REGION.amazonaws.com"
  aws ecr get-login-password | cosign login "$registry" --username AWS --password-stdin >/dev/null
}

# Usage: verified_image <repository> <sha> <workflow file>
# Prints <registry>/<repository>@<digest> for the repository's sha-<7> tag,
# once its signature verifies against <workflow file> on main.
verified_image() {
  local repository=$1 tag="sha-${2:0:7}" workflow=$3 digest image
  digest=$(aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$tag" --output json |
    jq -er '.imageDetails[0].imageDigest') || die "no $repository image tagged $tag"
  image="$registry/$repository@$digest"
  echo "Verifying $image ($tag)" >&2
  cosign verify --certificate-identity "$workflows/$workflow@refs/heads/main" \
    --certificate-oidc-issuer "$issuer" "$image" >/dev/null ||
    die "signature verification failed for $image: not published by $workflow on main"
  echo "$image"
}

# register-task-definition rejects the fields only describe returns.
readonly strip_describe_only='def strip: del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
  .compatibilities, .registeredAt, .registeredBy, .deregisteredAt); '

# Usage: register_from_latest <family> <container> <image> [NAME=VALUE...]
# Prints the ARN of a new revision of <family> made from its latest one with
# only <container>'s image changed, plus any NAME=VALUE environment entries
# (set, or replaced by name). Terraform owns everything else in it. When the
# latest already is exactly that, prints the latest's ARN instead. No tags:
# neither deploy role may tag (ecs:TagResource).
register_from_latest() {
  local family=$1 container=$2 image=$3 latest wanted
  shift 3
  latest="$work/$family.json"
  aws ecs describe-task-definition --task-definition "$family" --output json >"$latest"
  jq -e --arg c "$container" '[.taskDefinition.containerDefinitions[] | select(.name == $c)] | length == 1' \
    "$latest" >/dev/null || die "$family has no single container named $container"

  # With --args, jq takes every argument after the filter as a value, so
  # the input comes on stdin.
  wanted="$work/$family-register.json"
  jq --arg c "$container" --arg image "$image" --args "$strip_describe_only"'
    ($ARGS.positional | map(capture("^(?<name>[^=]+)=(?<value>.*)$"))) as $env
      | .taskDefinition | strip
      | .containerDefinitions |= map(
          if .name == $c then
            .image = $image
            | reduce $env[] as $e (.; .environment = ([(.environment // [])[] | select(.name != $e.name)] + [$e]))
          else . end)
  ' "$@" <"$latest" >"$wanted"

  if jq -e --slurpfile wanted "$wanted" "$strip_describe_only"'.taskDefinition | strip == $wanted[0]' \
    "$latest" >/dev/null; then
    jq -r .taskDefinition.taskDefinitionArn "$latest"
  else
    aws ecs register-task-definition --cli-input-json "file://$wanted" --output json |
      jq -er .taskDefinition.taskDefinitionArn
  fi
}

# Usage: service_state; prints the service's describe-services entry as JSON.
service_state() {
  aws ecs describe-services --cluster "$cluster" --services "$service" --output json | jq -ec '.services[0]'
}

# Usage: run_one_off <task definition ARN> <container> <family>
# Runs one task of it in the service's subnets and security group (read
# from the service, so no IDs live here), waits for it to stop and prints
# its log output and location. Call it after register_from_latest for
# <family>, whose copy of the definition it reads the log settings from.
# Returns 0 when <container> exited 0, 1 when it failed or never ran, and 2
# when the outcome is unknown (the wait gave up; it may still be running).
run_one_off() {
  local task_definition=$1 container=$2 family=$3 network task_arn exit_code log_group log_stream
  network=$(service_state | jq -ec '.networkConfiguration // error("none")') ||
    die "couldn't read service $service's network configuration"

  aws ecs run-task --cluster "$cluster" --task-definition "$task_definition" --launch-type FARGATE \
    --count 1 --network-configuration "$network" --started-by "$(basename "$0" .sh)" --output json >"$work/run.json"
  task_arn=$(jq -er '.tasks[0].taskArn // empty' "$work/run.json") ||
    die "ECS didn't start the task: $(jq -c .failures "$work/run.json")"

  # awslogs names the stream <prefix>/<container>/<task ID>.
  log_option() {
    jq -er --arg c "$container" --arg o "$1" \
      '.taskDefinition.containerDefinitions[] | select(.name == $c) | .logConfiguration.options[$o]' "$work/$family.json"
  }
  log_group=$(log_option awslogs-group)
  log_stream="$(log_option awslogs-stream-prefix)/$container/${task_arn##*/}"
  logs() {
    echo "--- $container output"
    # Best effort: the outcome is the exit code, not whether the logs read.
    aws logs get-log-events --log-group-name "$log_group" --log-stream-name "$log_stream" --start-from-head \
      --output json 2>/dev/null | jq -r '.events[].message' 2>/dev/null || echo "(couldn't read the log output)"
    echo "---"
    echo "Log group:  $log_group"
    echo "Log stream: $log_stream"
  }

  echo "Started $task_arn; waiting for it to stop"
  if ! aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"; then
    logs
    echo "gave up waiting for $task_arn to stop; it may still be running" >&2
    return 2
  fi

  aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --output json >"$work/task.json"
  exit_code=$(jq -r --arg c "$container" \
    '.tasks[0].containers[] | select(.name == $c) | .exitCode // "none"' "$work/task.json")
  logs
  if [[ $exit_code != 0 ]]; then
    echo "$container failed: exit code $exit_code ($(jq -r '.tasks[0].stoppedReason // "no reason given"' "$work/task.json"))" >&2
    return 1
  fi
}

# Usage: update_service <task definition ARN> <desired count>
# Points the service at the revision with that count and waits until its
# rollout has completed: the only deployment, at that many running tasks.
# The task definition is always passed: the deploy roles may only update the
# service with one (infra/bootstrap/iam-deploy-*.tf).
# Returns non-zero if the update fails, the circuit breaker fails the
# rollout (or another deployment replaced it), or it doesn't finish within
# DEPLOY_WAIT_ATTEMPTS polls DEPLOY_WAIT_SECONDS apart (default 80 x 15s, 20
# minutes: the breaker needs a few failed tasks, minutes each, before it
# gives up, more than the services-stable waiter's 10).
update_service() {
  local task_definition=$1 count=$2 attempt=0 outcome
  local attempts=${DEPLOY_WAIT_ATTEMPTS:-80} pause=${DEPLOY_WAIT_SECONDS:-15}
  aws ecs update-service --cluster "$cluster" --service "$service" \
    --task-definition "$task_definition" --desired-count "$count" --output json >/dev/null || return 1
  while ((attempt < attempts)); do
    attempt=$((attempt + 1))
    outcome=$(service_state | jq -r --arg td "$task_definition" --argjson n "$count" '
      ([.deployments[] | select(.taskDefinition == $td)][0]) as $d
        | if $d == null or $d.status != "PRIMARY" then "replaced"
          elif $d.rolloutState == "FAILED" then "failed"
          elif $d.rolloutState == "COMPLETED" and (.deployments | length) == 1
            and .desiredCount == $n and .runningCount == $n then "done"
          else "waiting" end') || return 1
    case $outcome in
      done) return 0 ;;
      failed | replaced)
        echo "the circuit breaker failed the rollout of ${task_definition##*/} ($outcome) and rolls the service back" >&2
        return 1
        ;;
    esac
    sleep "$pause"
  done
  echo "gave up waiting for the rollout of ${task_definition##*/} to complete" >&2
  return 1
}

