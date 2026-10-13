# 59: Network flow and DNS logs (prod)

**What to build:** After an incident, the maintainer can see what anything in the prod VPC talked to, how many bytes went out and to where, and which domains it resolved. These are the traces a compromised container leaves when it exfiltrates data, calls home or mines crypto. VPC Flow Logs and Route 53 Resolver query logs deliver to the bootstrap log bucket, and both get Athena tables. Investigation only, no alerting. There's no spec: the decisions come from the security-logging analysis.

**Blocked by:** 48 (VPC), 58 (log bucket and Athena workgroup)

**Status:** done

**Completed:** on `feat/59-network-flow-and-dns-logs`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/87

- [x] Flow log attached to the VPC, not to each ENI, so the task, RDS and NAT are all covered. It captures `ALL` traffic, not only `REJECT`, because exfiltration is accepted traffic
- [x] Custom flow-log format adds `pkt-srcaddr`, `pkt-dstaddr`, `flow-direction` and `traffic-path`, so traffic through the NAT shows the task's real IP and the true destination. Delivered to `vpc-flow/` as Parquet with hourly Hive-style partitions, default 10-minute aggregation
- [x] Resolver query-log config associated with the prod VPC, delivering to `resolver/`
- [x] Athena tables with partition projection for both prefixes, in bootstrap next to the CloudTrail table. `vpc_flow` projects `year`, `month`, `day` and `hour` (integers, matching the Hive-style keys). `resolver` projects `day` and takes the VPC as an injected `vpc` partition, since bootstrap can't know prod's VPC ID: every query names it
- [x] Applied. Athena returns NAT egress flows showing the real destination, and DNS queries made from inside the VPC. Bootstrap and prod applied on 2026-10-13 (release `7501f1c`). Both README queries returned rows: `vpc_flow` shows the task's egress through the NAT to its real destinations (the Cloudflare tunnel edges, `198.41.x.x:7844`), each flow seen on the task's ENI (`traffic_path` 1) and the NAT's (8); `resolver` shows the RDS endpoint and `region1.v2.argotunnel.com` resolved from inside the VPC. That also proves both tables' partition projection, integer `year`/`month`/`day`/`hour` and the injected `vpc`

Added during review: an off switch, since volume-billed delivery could become a budget problem. `network_logs_enabled` (no default) gates the flow log and Resolver query logging. Its value lives in the `plan` Environment's `NETWORK_LOGS_ENABLED` variable (set to `true`): CI's plan passes it, and a local apply exports it with `gh variable get`, so switching off is a variable change plus an apply, with no drift. The Athena tables stay either way.

