#!/usr/bin/env bash
# Ticket 54 (spec 13, "`deploy-db` workflow", user stories 7, 8, 18-22): the
# database's maintenance window, run by .github/workflows/deploy-db.yml with
# the deploy-db role (infra/bootstrap/iam-deploy-db.tf).
#
#   scripts/deploy-db.sh <db-sha> [<app-sha>]
#
# <db-sha> names the DB image to migrate with; <app-sha>, for a breaking
# migration, the app version that expects it. Aborts on the first failure:
# 1. Verifies the DB image (and the app image) by digest against the
#    workflow that published it on main, before changing anything.
# 2. Records the service's revision and desired count, scales it to 0 and
#    waits, so no app runs during the migration.
# 3. Snapshots the database as pensieve-predeploy-<db-sha>-<UTC time> and
#    waits until it's available.
# 4. Runs the migrator as a one-off task on a revision of pensieve-migrate
#    with the DB image and ALLOW_BREAKING set explicitly, `true` only with
#    <app-sha> (the migrator refuses a pending breaking migration otherwise;
#    ticket 43). Explicitly, because each revision is made from the latest,
#    which may be a breaking deploy's.
#    If anything up to here fails, the migrator applied nothing (it runs in
#    one transaction), so the recorded revision and count are restored and
#    the run fails: the outage ends there. The snapshot is kept. The
#    exception: if the wait for the migrator gives up, it may still be
#    running, so the app stays stopped and the run says so.
# 5. Starts the recorded revision, or a new one for <app-sha>, at the
#    recorded count and waits until it's stable on it. A first deploy's
#    count is 0, so the app stays down until deploy-app starts it.
#    If the new revision doesn't take, the circuit breaker rolls back to the
#    old one, which the startup check (ticket 44) keeps down on a breaking
#    schema: the run fails and points at the restore runbook.
# 6. Deletes the older pensieve-predeploy-* snapshots (point-in-time
#    recovery covers what they did).
set -euo pipefail
# shellcheck source=scripts/lib/deploy.sh
source "$(dirname "$0")/lib/deploy.sh"

if [[ $# -lt 1 || $# -gt 2 || ! $1 =~ ^[0-9a-f]{7,40}$ || ($# -eq 2 && ! $2 =~ ^[0-9a-f]{7,40}$) ]]; then
  echo "usage: $0 <db-sha> [<app-sha>]  (main commits whose releases published the images, 7-40 hex chars)" >&2
  exit 2
fi
readonly db_sha=${1:0:7} app_sha=${2:+${2:0:7}}
readonly rds_instance=pensieve

deploy_init
summary "### deploy-db: \`sha-$db_sha\`${app_sha:+ with app \`sha-$app_sha\`}"

# --- 1. verify ----------------------------------------------------------------
db_image=$(verified_image pensieve-db "$db_sha" db.yml)
if [[ -n $app_sha ]]; then
  app_image=$(verified_image pensieve "$app_sha" ci.yml)
fi

# --- 2. stop the app ----------------------------------------------------------
state=$(service_state)
recorded_td=$(jq -er .taskDefinition <<<"$state")
recorded_count=$(jq -er .desiredCount <<<"$state")
echo "Recorded $recorded_td at desired count $recorded_count"

snapshot=""
restore_on_failure=false
restore() {
  echo "Restoring $recorded_td at desired count $recorded_count" >&2
  if update_service "$recorded_td" "$recorded_count"; then
    summary "Restored the previous app revision; nothing was migrated."
  else
    summary ":x: Restoring the previous app revision didn't stabilise either: check the service."
  fi
  if [[ -n $snapshot ]]; then
    summary "Kept snapshot \`$snapshot\`."
  fi
}
# From here until the migration succeeds, any failure restores the app.
# (Replaces deploy_init's trap, so it cleans up $work too.)
on_exit() {
  local status=$?
  if [[ $status -ne 0 && $restore_on_failure == true ]]; then
    restore
  fi
  rm -rf "$work"
}
trap on_exit EXIT
restore_on_failure=true

update_service "$recorded_td" 0 || die "couldn't scale the service to 0"

# --- 3. snapshot --------------------------------------------------------------
snapshot="pensieve-predeploy-$db_sha-$(date -u +%Y%m%d%H%M%S)"
echo "Snapshotting as $snapshot"
aws rds create-db-snapshot --db-instance-identifier "$rds_instance" --db-snapshot-identifier "$snapshot" \
  --output json >/dev/null
aws rds wait db-snapshot-available --db-snapshot-identifier "$snapshot" ||
  die "snapshot $snapshot didn't become available"

# --- 4. migrate ---------------------------------------------------------------
allow_breaking=false
if [[ -n $app_sha ]]; then
  allow_breaking=true
fi
migrate_td=$(register_from_latest pensieve-migrate migrate "$db_image" "ALLOW_BREAKING=$allow_breaking")
echo "Migrating with $migrate_td (ALLOW_BREAKING=$allow_breaking)"
migrate_status=0
run_one_off "$migrate_td" migrate pensieve-migrate || migrate_status=$?
if [[ $migrate_status -eq 2 ]]; then
  restore_on_failure=false
  die "gave up waiting for the migration, which may still be running: the app stays stopped. Check /ecs/pensieve-migrate, then restart the app (deploy-app, or deploy-db again)"
elif [[ $migrate_status -ne 0 ]]; then
  die "migration failed or was refused (a breaking migration needs an app SHA); restoring the app (snapshot $snapshot kept). Log group /ecs/pensieve-migrate"
fi
restore_on_failure=false
summary "Migrated with \`sha-$db_sha\`."

# --- 5. start the app ---------------------------------------------------------
target_td=$recorded_td
if [[ -n $app_sha ]]; then
  target_td=$(register_from_latest pensieve-app app "$app_image")
fi
echo "Starting $target_td at desired count $recorded_count"
if ! update_service "$target_td" "$recorded_count"; then
  die "the app didn't stabilise on ${target_td##*/} after the migration: follow the restore runbook (snapshot $snapshot; log group /ecs/pensieve-app)"
fi
summary "Service on \`${target_td##*/}\` at desired count $recorded_count."

# --- 6. prune snapshots -------------------------------------------------------
aws rds describe-db-snapshots --db-instance-identifier "$rds_instance" --snapshot-type manual --output json |
  jq -r --arg keep "$snapshot" \
    '.DBSnapshots[].DBSnapshotIdentifier | select(startswith("pensieve-predeploy-") and . != $keep)' |
  while read -r old; do
    echo "Deleting older snapshot $old"
    aws rds delete-db-snapshot --db-snapshot-identifier "$old" --output json >/dev/null
  done
summary ":white_check_mark: Done; kept snapshot \`$snapshot\`."
