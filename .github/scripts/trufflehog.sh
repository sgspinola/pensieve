#!/usr/bin/env bash
# Ticket 63: ci.yml's `trufflehog` scan (the job's comment has the why).
# Reads SINCE, HEAD_SHA, TARGET and TRUFFLEHOG_IMAGE from the step's env and
# writes trufflehog.sarif.
set -euo pipefail

if [ "$TARGET" = main ]; then
  # The checked-out release, minus .git (its objects are history).
  printf '%s\n' '^/repo/\.git/' > "$RUNNER_TEMP/trufflehog-exclude"
  docker run --rm -v "$PWD:/repo:ro" -v "$RUNNER_TEMP/trufflehog-exclude:/exclude:ro" "$TRUFFLEHOG_IMAGE" \
    filesystem /repo --exclude-paths=/exclude \
    --results=verified,unknown,unverified --fail --fail-on-scan-errors --no-update --sarif \
    > trufflehog.sarif
else
  # --branch pins the scan to the commit under test: without it,
  # TruffleHog walks every fetched ref, including other PR branches.
  docker run --rm -v "$PWD:/repo" "$TRUFFLEHOG_IMAGE" \
    git file:///repo --since-commit "$SINCE" --branch "$HEAD_SHA" \
    --results=verified,unknown,unverified --fail --fail-on-scan-errors --no-update --sarif \
    > trufflehog.sarif
fi
