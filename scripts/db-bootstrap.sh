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
# The steps are scripts/lib/deploy.sh's, shared with deploy-db (ticket 54):
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
# shellcheck source=scripts/lib/deploy.sh
source "$(dirname "$0")/lib/deploy.sh"

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "usage: $0 <db-sha>  (the main commit whose release published the DB image, 7-40 hex chars)" >&2
  exit 2
fi

deploy_init
image=$(verified_image pensieve-db "$1" db.yml)
task_definition=$(register_from_latest pensieve-db-bootstrap db-bootstrap "$image")
echo "Task definition: $task_definition"
run_one_off "$task_definition" db-bootstrap pensieve-db-bootstrap || die "bootstrap failed"
echo "Bootstrap succeeded on $image"
