# Ticket 47: tflint config for every root config under infra/ (CI's `iac`
# job passes it with --config). The AWS ruleset is pinned to an exact
# version; `tflint --init` verifies its signature against the key tflint
# ships for terraform-linters plugins.
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
