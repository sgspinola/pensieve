# 48: Prod foundation: network, RDS, ECR, logs, budgets

**What to build:** The stateful and network foundation of production in eu-north-1, in the **prod** root configuration with its state in the bootstrap bucket. It provisions a VPC with subnets in two AZs, a private subnet for the task, a single NAT Gateway, and an S3 gateway endpoint. It also provisions the RDS and task security groups, and RDS PostgreSQL 17 (`db.t4g.micro`, single-AZ, 20→50 GB gp3, IAM auth, RDS-managed master password, 35-day point-in-time recovery, deletion protection, final snapshot, retained backups, encrypted, night backup window). Rounding it out: the `pensieve` and `pensieve-db` ECR repositories, CloudWatch log groups, and AWS Budgets alerts. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 18, 19, 21–23, 26–31, 45–49; "Network", "Database", "Registry", "Observability and cost").

**Blocked by:** 47 (CI plan on infrastructure PRs), 58 (audit trail, so prod's first apply is recorded)

**Status:** ready-for-agent

- [ ] VPC with two-AZ subnets, a private task subnet, a single NAT Gateway + EIP, and an S3 gateway endpoint
- [ ] RDS security group accepts Postgres only from the task security group; the task security group allows no inbound traffic
- [ ] RDS instance configured exactly as spec 11 lists, with the master password never in state
- [ ] Both ECR repositories with immutable tags (or immutable-with-exclusions for a moving `main` tag, if the pinned provider supports it, per spec 12) and lifecycle rules: keep the last 50 `sha-*` (`tagPatternList`), expire untagged after 1 day, no archive tier (spec 11: the running image can be several releases old)
- [ ] Log groups for app, `cloudflared`, migrate and db-bootstrap, with 30-day retention
- [ ] Monthly budget with notifications at $10 actual and $20 forecast to the maintainer
- [ ] CI plan is clean on the PR; applied by the maintainer, and the instance is reachable from inside the VPC only
