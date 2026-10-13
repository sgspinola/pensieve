#!/usr/bin/env bash
# Ticket 63: iac.yml's `terraform plan (prod)` step. Runs only in the `plan`
# Environment, with the step's env: AWS_ROLE_ARN, AWS_REGION,
# CLOUDFLARE_API_TOKEN, TERRAFORM_IMAGE and the TF_VAR_* variables. Writes
# the init and plan output to $RUNNER_TEMP/plan.txt for iac-summary.sh.
set -euo pipefail

# Every TF_VAR_* the step sets reaches Terraform, so adding a variable only
# touches the step's env.
tf_vars=()
for name in $(compgen -e | grep '^TF_VAR_'); do
  tf_vars+=(-e "$name")
done

mkdir -m 700 "$RUNNER_TEMP/oidc"
# fd 3 is the step's real stdout: the mask command must reach the
# runner, not the redirected plan output below.
exec 3>&1
# GitHub's OIDC token lives about five minutes, so each Terraform
# run gets a fresh one rather than init's expiring before plan.
tf() {
  token=$(curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value)
  echo "::add-mask::$token" >&3
  printf '%s' "$token" > "$RUNNER_TEMP/oidc/token"
  docker run --rm -v "$PWD:/repo" -v "$RUNNER_TEMP/oidc:/oidc:ro" -w /repo/infra/prod \
    -e AWS_ROLE_ARN -e AWS_REGION -e AWS_WEB_IDENTITY_TOKEN_FILE=/oidc/token \
    -e CLOUDFLARE_API_TOKEN "${tf_vars[@]}" -e TF_IN_AUTOMATION=1 "$TERRAFORM_IMAGE" "$@"
}
# The state bucket is named after the account (infra/prod/versions.tf),
# the same account as the plan role.
account=$(echo "$AWS_ROLE_ARN" | cut -d: -f5)
# Output (errors included) goes to a file for the summary, not to the log.
# The plan role can't write the state lockfile, hence -lock=false.
{
  tf init -reconfigure -input=false -no-color -backend-config="bucket=pensieve-tfstate-$account" &&
    tf plan -lock=false -input=false -no-color
} > "$RUNNER_TEMP/plan.txt" 2>&1
