#!/usr/bin/env bash
# Ticket 45: db.yml's upgrade-path check, the way production upgrades. In a
# second database on db-apply's Postgres service, applies the previous
# release's migrations (BASE's drizzle/, with drizzle-kit), then runs the
# built DB image's migrator on top with ALLOW_BREAKING=true. Reads BASE (a
# ref or commit on origin) and POSTGRES_CONTAINER; writes base, from,
# applied and expected to $GITHUB_OUTPUT for the job's summary.
set -euo pipefail

url=postgres://pensieve:pensieve@localhost:5432/upgrade
psql() { docker exec "$POSTGRES_CONTAINER" psql -U pensieve -v ON_ERROR_STOP=1 "$@"; }
recorded() { psql -d upgrade -tAc 'select count(*) from drizzle.__drizzle_migrations'; }

# The repository is public, so the fetch needs no credentials.
git fetch --no-tags --depth=1 origin "$BASE"
echo "base=$(git rev-parse --short FETCH_HEAD)" >> "$GITHUB_OUTPUT"

psql -d pensieve -c 'create database upgrade'

# drizzle.config.ts reads ./drizzle, so the previous release's folder stands
# in for it while drizzle-kit runs, and this commit's is put back after.
mv drizzle "$RUNNER_TEMP/drizzle-current"
trap 'rm -rf drizzle; mv "$RUNNER_TEMP/drizzle-current" drizzle' EXIT
git archive FETCH_HEAD drizzle | tar -x
DATABASE_URL=$url npx drizzle-kit migrate
rm -rf drizzle
mv "$RUNNER_TEMP/drizzle-current" drizzle
trap - EXIT
echo "from=$(recorded)" >> "$GITHUB_OUTPUT"

docker run --rm --network host -e DATABASE_URL="$url" -e ALLOW_BREAKING=true pensieve-db:ci

applied=$(recorded)
expected=$(jq '.entries | length' drizzle/meta/_journal.json)
echo "applied=$applied" >> "$GITHUB_OUTPUT"
echo "expected=$expected" >> "$GITHUB_OUTPUT"
if [ "$applied" != "$expected" ]; then
  echo "::error::after the upgrade, $applied migration(s) recorded, but the journal lists $expected"
  exit 1
fi
