# 58: Account audit trail and log bucket (bootstrap)

**What to build:** After an incident, the maintainer can reconstruct who did what in the AWS account over the last 90 days, including read-only calls, and who read the Terraform state, by querying Athena. The **bootstrap** config gains a dedicated log bucket, a multi-region CloudTrail trail and an Athena workgroup with a CloudTrail table. Scope is investigation only: no alarms, metric filters or SNS, so spec 11's "no alarms" exclusion still holds. There's no spec: the decisions come from the security-logging analysis and are listed below.

**Blocked by:** 46 (bootstrap config merged and applied, with the `pensieve-admin` IAM user as the admin principal)

**Status:** ready-for-agent

- [ ] Log bucket `pensieve-logs-<account>`, its name shared through the bootstrap names so prod can deliver to it: SSE-S3, versioning, public access blocked, TLS-only, bucket-owner-enforced
- [ ] Bucket policy denies every principal except the admin user. The deny is limited to callers that carry `aws:PrincipalArn` (a `Null` test), because service principals don't have it and a plain `ArnNotLike` would deny them. Allow statements let CloudTrail and log delivery write to their own prefixes only, scoped by `aws:SourceAccount` and `aws:SourceArn`
- [ ] Lifecycle by prefix: `cloudtrail/` 90 days (to match the free Event History), `vpc-flow/` and `resolver/` 30 days, `athena-results/` 7 days. Noncurrent versions expire as well
- [ ] Trail: multi-region, includes global service events, read and write management events, log file validation on, delivering to `cloudtrail/`
- [ ] Data events, using advanced event selectors: every object-level call on the state bucket; on the log bucket, everything except `PutObject`, so log delivery doesn't feed back into the trail but reads and deletes of the logs are still recorded
- [ ] Athena workgroup with results under `athena-results/`, and a CloudTrail Glue table that uses partition projection, so no partitions ever need adding
- [ ] Bootstrap README updated: what's created and the expected resource count at the plan-review step
- [ ] Applied by the maintainer. An Athena query shows the plan role's `GetObject` on the state file after a CI plan, and `aws cloudtrail validate-logs` passes
