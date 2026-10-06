# 47: CI `iac` job with read-only plan

**What to build:** Every PR that touches infrastructure is checked and shows a Terraform plan, without any secret able to leak into this public repository's logs or artifacts. An `iac` job, running on every PR like every other job and required by name in the rulesets, runs `terraform fmt -check`, `validate` (initialised without a backend) and tflint with the pinned AWS ruleset over both root configurations. On same-repository PRs only, `terraform plan` for prod runs in the `plan` GitHub Environment, assuming the plan role via OIDC and using a read-only Cloudflare token stored as an environment secret. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 9–13; "CI `iac` job").

**Blocked by:** 46 (plan role)

**Status:** done

**Completed:** on `feat/47-ci-iac-job`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/48

- [x] `iac` job runs fmt, validate and tflint (AWS plugin pinned) on both configs on every change, and is added by name to the `develop`/`main` rulesets' required checks — job loops over every `infra/*/` config; `infra/.tflint.hcl` pins the AWS ruleset at 0.49.0. Added to `protect-main`; `protect-develop` deliberately requires no checks, so nothing was added there
- [x] Plan runs only on `pull_request` where the head repo is this repository, never on forks, inside the `plan` Environment
- [x] Plan authenticates via OIDC as the plan role, and to Cloudflare with the read-only Zone+Tunnel token
- [x] Plan text goes to the run summary only. No plan file is uploaded and `TF_LOG` is never set
- [x] Manual: the maintainer creates the `plan` Environment and the read-only Cloudflare token secret — Environment created on PR #48's first run; `PLAN_ROLE_ARN` variable and `CLOUDFLARE_API_TOKEN` secret (Tunnel, Zone, Zone Settings and DNS Read; steps in `infra/bootstrap/README.md`, "CI plan") added by the maintainer
- [x] Verified by a PR that touches `infra/` (fmt/validate/tflint and the plan shown) — PR #48: fmt/validate/tflint over `infra/bootstrap`, and a temporary read-only `infra/prod` (since removed) planned successfully as the plan role with the Cloudflare token. Getting there found and fixed the CI roles' trust policies, which didn't match the repository's immutable OIDC subjects (`f5a4b38`, applied by the maintainer). The no-Environment path (pushes, forks, Dependabot) was verified with a temporary commit
