# 47: CI `iac` job with read-only plan

**What to build:** Every PR that touches infrastructure is checked and shows a Terraform plan, without any secret able to leak into this public repository's logs or artifacts. An `iac` job, running on every PR like every other job and required by name in the rulesets, runs `terraform fmt -check`, `validate` (initialised without a backend) and tflint with the pinned AWS ruleset over both root configurations. On same-repository PRs only, `terraform plan` for prod runs in the `plan` GitHub Environment, assuming the plan role via OIDC and using a read-only Cloudflare token stored as an environment secret. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 9–13; "CI `iac` job").

**Blocked by:** 46 (plan role)

**Status:** ready-for-agent

- [ ] `iac` job runs fmt, validate and tflint (AWS plugin pinned) on both configs on every change, and is added by name to the `develop`/`main` rulesets' required checks
- [ ] Plan runs only on `pull_request` where the head repo is this repository, never on forks, inside the `plan` Environment
- [ ] Plan authenticates via OIDC as the plan role, and to Cloudflare with the read-only Zone+Tunnel token
- [ ] Plan text goes to the run summary only. No plan file is uploaded and `TF_LOG` is never set
- [ ] Manual: the maintainer creates the `plan` Environment and the read-only Cloudflare token secret
- [ ] Verified by a PR that touches `infra/` (fmt/validate/tflint and the plan shown)
