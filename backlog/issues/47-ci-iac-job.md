# 47: CI `iac` job with read-only plan

**What to build:** Every PR that touches infrastructure is checked and shows a Terraform plan, without any secret able to leak into this public repository's logs or artifacts. An `iac` job, running on every PR like every other job and required by name in the rulesets, runs `terraform fmt -check`, `validate` (initialised without a backend) and tflint with the pinned AWS ruleset over both root configurations. On same-repository PRs only, `terraform plan` for prod runs in the `plan` GitHub Environment, assuming the plan role via OIDC and using a read-only Cloudflare token stored as an environment secret. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 9–13; "CI `iac` job").

**Blocked by:** 46 (plan role)

**Status:** in-progress (code on `feat/47-ci-iac-job`, PR #48; rulesets and the `plan` Environment's variable and secret pending)

- [ ] `iac` job runs fmt, validate and tflint (AWS plugin pinned) on both configs on every change, and is added by name to the `develop`/`main` rulesets' required checks — job done (loops over every `infra/*/` config; `infra/.tflint.hcl` pins the AWS ruleset at 0.49.0). Rulesets not yet updated
- [x] Plan runs only on `pull_request` where the head repo is this repository, never on forks, inside the `plan` Environment
- [x] Plan authenticates via OIDC as the plan role, and to Cloudflare with the read-only Zone+Tunnel token
- [x] Plan text goes to the run summary only. No plan file is uploaded and `TF_LOG` is never set
- [ ] Manual: the maintainer creates the `plan` Environment and the read-only Cloudflare token secret — the Environment exists (GitHub created it on PR #48's first run); `PLAN_ROLE_ARN` variable and `CLOUDFLARE_API_TOKEN` secret still to add (steps in `infra/bootstrap/README.md`, "CI plan")
- [ ] Verified by a PR that touches `infra/` (fmt/validate/tflint and the plan shown) — fmt/validate/tflint verified on PR #48 (in the `plan` Environment), and the no-Environment path verified with a temporary commit. The plan itself can't run until `infra/prod` exists; ticket 48's "CI plan is clean on the PR" covers it
