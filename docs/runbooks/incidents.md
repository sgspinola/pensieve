# Investigating an incident

Every source below exists to answer questions after the fact: nothing alerts. Run everything as the admin user (`aws login --profile pensieve-admin`). It's the only principal that can read the log bucket.

| Question | Where | How |
| --- | --- | --- |
| Who changed what in AWS, from where? | CloudTrail, 90 days | Athena: `pensieve_logs.cloudtrail` |
| Who signed in to the console? | CloudTrail Event History, 90 days | `aws cloudtrail lookup-events`, or the console |
| What did a task talk to, and how much went out? | VPC Flow Logs, 30 days | Athena: `pensieve_logs.vpc_flow` |
| Which domains did something in the VPC resolve? | Resolver query logs, 30 days | Athena: `pensieve_logs.resolver` |
| Who connected to Postgres, and who changed roles, grants or the schema? | RDS `postgresql` log, 30 days | Logs Insights: `/aws/rds/instance/pensieve/postgresql` |
| Did anyone fail an IAM database login? | RDS `iam-db-auth-error` log, 30 days | `aws logs filter-log-events` on `/aws/rds/instance/pensieve/iam-db-auth-error` |
| Who tried to get into the app, from where? | App auth events and request lines, 30 days | Logs Insights: `/ecs/pensieve-app` |
| What changed in Cloudflare (DNS, tunnel, WAF)? | Cloudflare audit log | Dashboard: Manage Account → Audit Log |

Each AWS query below was run against production's real data on 2026-10-13. Replace the dates.

## Athena

In the Athena console, pick the `pensieve` workgroup. Results land in the log bucket's `athena-results/` prefix for 7 days. Always filter on the partition columns (`day` for CloudTrail and the Resolver logs; `year`, `month` and `day` for flow logs), so a query scans one day rather than everything.

**Changes in AWS, newest first:**

```sql
SELECT eventtime, useridentity.arn AS who, sourceipaddress, eventsource, eventname
FROM pensieve_logs.cloudtrail
WHERE day = '2026/10/13' AND readonly = 'false'
  AND eventsource IN ('ecs.amazonaws.com', 'rds.amazonaws.com', 'iam.amazonaws.com', 'ecr.amazonaws.com')
ORDER BY eventtime DESC
LIMIT 50;
```

**Denied or failed calls:**

```sql
SELECT eventtime, useridentity.arn AS who, sourceipaddress, eventname, errorcode
FROM pensieve_logs.cloudtrail
WHERE day = '2026/10/13' AND errorcode IS NOT NULL
ORDER BY eventtime DESC
LIMIT 50;
```

**What the task sent out through the NAT, biggest first.** On the NAT's interface, `pkt_srcaddr`/`pkt_dstaddr` are the task's own address and the real destination:

```sql
SELECT from_unixtime(start) AS at, pkt_srcaddr, pkt_dstaddr, dstport, bytes, traffic_path
FROM pensieve_logs.vpc_flow
WHERE year = 2026 AND month = 10 AND day = 13
  AND flow_direction = 'egress' AND pkt_dstaddr NOT LIKE '10.%'
ORDER BY bytes DESC
LIMIT 50;
```

Normal traffic is the tunnel to Cloudflare's edge (`198.41.192.x` and `198.41.200.x` addresses on port 7844, in production's real data), plus ECR, CloudWatch Logs, Secrets Manager and Docker Hub over 443. A large flow anywhere else is the thing to explain.

**Domains resolved from inside the VPC.** `vpc` must name the prod VPC: get it from `aws ec2 describe-vpcs --filters Name=tag:Name,Values=pensieve`.

```sql
SELECT query_timestamp, srcaddr, query_name, query_type, rcode
FROM pensieve_logs.resolver
WHERE vpc = 'vpc-…' AND day >= '2026/10/13'
ORDER BY query_timestamp DESC
LIMIT 50;
```

Normal names are the RDS endpoint, `*.argotunnel.com` and the AWS service endpoints.

## CloudWatch Logs Insights

**Auth events in the app**, counted by kind and outcome. Every line carries `clientIp`, `userAgent` and `cfRay` when the request came through Cloudflare, and `userId` where known:

```
filter logger = "pensieve.auth"
| stats count(*) by properties.event, properties.outcome
```

Then, to see one kind (for example, refused sessions) with where they came from:

```
filter logger = "pensieve.auth" and properties.event = "session_rejected"
| fields @timestamp, properties.path, properties.reason, properties.clientIp, properties.userAgent
| sort @timestamp desc
| limit 50
```

**Failed API requests:**

```
filter logger = "pensieve.api" and properties.status >= 400
| fields @timestamp, properties.method, properties.route, properties.status, properties.userId, properties.clientIp
| sort @timestamp desc
| limit 50
```

**Role, grant and schema changes in Postgres** (pgaudit), by who and what:

```
filter @message like /AUDIT: SESSION/
| parse @message /:(?<user>[a-z_]+)@[a-z_]+:.*AUDIT: SESSION,\d+,\d+,(?<class>[A-Z]+),(?<command>[A-Z ]+),/
| stats count(*) by user, class, command
```

Only the bootstrap (as `pensieve_master`) and migrations (as `pensieve_migrator`) should appear. Anything else is the thing to explain.

**Database connections by user:**

```
filter @message like /connection authorized/
| parse @message /user=(?<user>[a-z_]+)/
| stats count(*) by user
```

Expect `pensieve_app`, `pensieve_migrator` during a deploy, `pensieve_master` during a bootstrap, and `rdsadmin`, which is RDS's own.

**Failed IAM database logins:** every line of the `iam-db-auth-error` log is a failure. Read it with the CLI rather than Logs Insights:

```sh
aws logs filter-log-events --log-group-name /aws/rds/instance/pensieve/iam-db-auth-error \
  --start-time "$(( ($(date +%s) - 7 * 86400) * 1000 ))" --output json |
  jq -r '.events[] | "\(.timestamp / 1000 | todate) \(.message)"'
```

It names the database user and the reason, e.g. `Failed to authenticate the connection request for user 'pensieve_master' because the provided token is malformed or otherwise invalid. (… Error Code: InvalidToken)`. Logs Insights missed the one real entry: RDS back-filled it, with a timestamp earlier than the log group, when the export was first switched on.

## Event History

Console sign-ins over the last 90 days:

```sh
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=ConsoleLogin \
  --max-results 50 --output json |
  jq -r '.Events[] | "\(.EventTime) \(.Username) \(.CloudTrailEvent | fromjson | .responseElements.ConsoleLogin)"'
```

## Cloudflare

Changes to the zone, the tunnel and the WAF are in Cloudflare's audit log (Manage Account → Audit Log), which records who made each change and from which IP. That's also where to check that nobody changed the tunnel's ingress or the DNS record pointing at it.
