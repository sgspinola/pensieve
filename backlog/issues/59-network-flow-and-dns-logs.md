# 59: Network flow and DNS logs (prod)

**What to build:** After an incident, the maintainer can see what anything in the prod VPC talked to, how many bytes went out and to where, and which domains it resolved. These are the traces a compromised container leaves when it exfiltrates data, calls home or mines crypto. VPC Flow Logs and Route 53 Resolver query logs deliver to the bootstrap log bucket, and both get Athena tables. Investigation only, no alerting. There's no spec: the decisions come from the security-logging analysis.

**Blocked by:** 48 (VPC), 58 (log bucket and Athena workgroup)

**Status:** ready-for-agent

- [ ] Flow log attached to the VPC, not to each ENI, so the task, RDS and NAT are all covered. It captures `ALL` traffic, not only `REJECT`, because exfiltration is accepted traffic
- [ ] Custom flow-log format adds `pkt-srcaddr`, `pkt-dstaddr`, `flow-direction` and `traffic-path`, so traffic through the NAT shows the task's real IP and the true destination. Delivered to `vpc-flow/` as Parquet with hourly Hive-style partitions, default 10-minute aggregation
- [ ] Resolver query-log config associated with the prod VPC, delivering to `resolver/`
- [ ] Athena tables with partition projection for both prefixes, in bootstrap next to the CloudTrail table
- [ ] Applied. Athena returns NAT egress flows showing the real destination, and DNS queries made from inside the VPC
