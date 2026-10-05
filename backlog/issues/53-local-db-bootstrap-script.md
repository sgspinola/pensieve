# 53: Local `db-bootstrap` script

**What to build:** The one master-powered step is a deliberate local act that never puts the master password on the maintainer's machine. A script taking a DB image SHA runs with the maintainer's SSO credentials. It verifies the image signature with cosign, registers a bootstrap task-definition revision on that image, runs it with `aws ecs run-task` in the service's subnets and security group, waits for exit code 0, and prints the CloudWatch log location. It's run once after the first prod apply and whenever the bootstrap SQL changes. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 23–25; "Local script", "Isolation").

**Blocked by:** 42 (bootstrap entrypoint), 49 (bootstrap task definition and role), 51 (signed DB images)

**Status:** ready-for-agent

- [ ] Script verifies the DB image with `cosign verify` (expected `main` identity) before anything else
- [ ] Registers a bootstrap revision on that image and runs it as a one-off task in the service's network config
- [ ] Waits for the task to stop and exits non-zero unless the container exit code is 0, printing the log group and stream either way
- [ ] Confirmed that no GitHub role can run the bootstrap family or pass its roles
- [ ] Verified by the first real bootstrap (with ticket 56), and a re-run that changes nothing (idempotent)
