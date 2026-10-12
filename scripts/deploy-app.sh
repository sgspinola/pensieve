#!/usr/bin/env bash
# Ticket 52 (spec 12, "`deploy-app` workflow", user stories 12-18, 20): an
# app release, run by .github/workflows/deploy-app.yml with the deploy-app
# role (infra/bootstrap/iam-deploy-app.tf), which can't touch the database:
# no snapshots, no migrations, no one-off tasks. Schema changes go through
# deploy-db.
#
#   scripts/deploy-app.sh <app-sha>
#
# Aborts on the first failure:
# 1. Verifies sha-<app-sha> in pensieve by digest against ci.yml on main,
#    before changing anything.
# 2. Registers a pensieve-app revision from the family's latest with only the
#    app container's image changed (Terraform owns the rest, the sidecar
#    included).
# 3. Points the service at it, at its current desired count, or 1 on the
#    first deploy (Terraform creates the service at 0), and waits until it's
#    stable on it. Downtime is about one Fargate cold start: the old task
#    stops before the new one starts (minimum healthy 0%).
# If the new task never turns healthy (a startup schema check refusal
# included, ticket 44), the circuit breaker fails the rollout and rolls back
# to the previous revision, and the run fails, linking the app's log group.
set -euo pipefail
# shellcheck source=scripts/lib/deploy.sh
source "$(dirname "$0")/lib/deploy.sh"

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "usage: $0 <app-sha>  (the main commit whose release published the app image, 7-40 hex chars)" >&2
  exit 2
fi
readonly app_sha=${1:0:7}
readonly log_group=/ecs/pensieve-app
# The console wants the group's slashes encoded twice, as $252F.
readonly log_group_url="https://$AWS_REGION.console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#logsV2:log-groups/log-group/${log_group//\//\$252F}"

deploy_init
summary "### deploy-app: \`sha-$app_sha\`"

app_image=$(verified_image pensieve "$app_sha" ci.yml)

count=$(service_state | jq -er .desiredCount)
if [[ $count -eq 0 ]]; then
  count=1
fi

task_definition=$(register_from_latest pensieve-app app "$app_image")
echo "Deploying $task_definition at desired count $count"
if ! update_service "$task_definition" "$count"; then
  summary "App logs: [$log_group]($log_group_url)"
  die "the service didn't settle on ${task_definition##*/}; see the app log group $log_group"
fi
summary ":white_check_mark: Service on \`${task_definition##*/}\` (\`sha-$app_sha\`) at desired count $count."
