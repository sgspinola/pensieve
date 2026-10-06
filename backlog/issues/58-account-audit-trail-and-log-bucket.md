# 58: Account audit trail and log bucket (bootstrap)

**What to build:** After an incident, the maintainer can reconstruct who did what in the AWS account over the last 90 days, including read-only calls, and who read the Terraform state, by querying Athena. The **bootstrap** config gains a dedicated log bucket, a multi-region CloudTrail trail and an Athena workgroup with a CloudTrail table. Scope is investigation only: no alarms, metric filters or SNS, so spec 11's "no alarms" exclusion still holds. There's no spec: the decisions come from the security-logging analysis and are listed below.

**Blocked by:** 46 (bootstrap config merged and applied, with the `pensieve-admin` IAM user as the admin principal)

**Status:** ready-for-agent

- [x] Log bucket `pensieve-logs-<account>`, its name shared through the bootstrap names so prod can deliver to it: SSE-S3, versioning, public access blocked, TLS-only, bucket-owner-enforced
- [x] Bucket policy denies every principal except the admin user. The deny exempts AWS service principals (`aws:PrincipalIsAWSService` is `false`), because they carry no `aws:PrincipalArn` and a plain `ArnNotLike` would deny them. (A `Null` test on `aws:PrincipalArn` was the original plan, but CloudTrail's create-time policy check rejected it with `InsufficientS3BucketPolicyException`.) Allow statements let CloudTrail and log delivery write to their own prefixes only, scoped by `aws:SourceAccount` and `aws:SourceArn`
- [x] Added during the work: the hand-made `pensieve-auditor` user (ScoutSuite) may read the state and log buckets' configuration but not list or read their objects, via a config-reads-only deny in both bucket policies. Terraform only references the user by name (`auditor_user_name`)
- [x] Lifecycle by prefix: `cloudtrail/` 90 days (to match the free Event History), `vpc-flow/` and `resolver/` 30 days, `athena-results/` 7 days. Noncurrent versions expire as well
- [x] Trail: multi-region, includes global service events, read and write management events, log file validation on, delivering to `cloudtrail/`
- [x] Data events, using advanced event selectors: every object-level call on the state bucket; on the log bucket, everything except `PutObject`, so log delivery doesn't feed back into the trail but reads and deletes of the logs are still recorded
- [x] Athena workgroup with results under `athena-results/`, and a CloudTrail Glue table that uses partition projection, so no partitions ever need adding
- [x] Bootstrap README updated: what's created and the expected resource count at the plan-review step
- [ ] Applied by the maintainer. An Athena query shows the plan role's `GetObject` on the state file after a CI plan, and `aws cloudtrail validate-logs` passes
