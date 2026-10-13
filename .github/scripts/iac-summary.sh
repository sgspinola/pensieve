#!/usr/bin/env bash
# Ticket 63: iac.yml's step summary, with the prod plan iac-plan.sh wrote,
# if any. Reads PLAN_OUTCOME (the plan step's outcome) and JOB_STATUS.
set -euo pipefail

icon=$([ "$JOB_STATUS" = success ] && echo ":white_check_mark:" || echo ":x:")
case "$PLAN_OUTCOME" in
  success|failure) plan="prod plan below ($PLAN_OUTCOME)" ;;
  *) plan="no plan (only same-repository PRs)" ;;
esac
echo "### iac $icon fmt, validate, test and tflint over $(echo infra/*/ | xargs -n1 basename | paste -sd, -); $plan" >> "$GITHUB_STEP_SUMMARY"
if [ -f "$RUNNER_TEMP/plan.txt" ]; then
  {
    echo '<details open><summary>terraform plan (prod)</summary>'
    echo
    echo '```'
    # A step summary is capped at 1 MiB.
    head -c 900000 "$RUNNER_TEMP/plan.txt"
    echo '```'
    echo '</details>'
  } >> "$GITHUB_STEP_SUMMARY"
fi
