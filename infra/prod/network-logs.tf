# Ticket 59: what anything in the VPC talked to, and which domains it
# resolved, for investigating after an incident (a compromised container
# exfiltrating data, calling home or mining). Both deliver to the bootstrap
# config's log bucket, whose policy lets log delivery write only under these
# two prefixes; the Athena tables over them are bootstrap's too
# (infra/bootstrap/network-logs.tf). Investigation only, no alerting.
# var.network_logs_enabled switches all three resources off; the bucket's
# lifecycle rules expire what was already delivered.

# On the VPC, not per ENI, so the task, RDS and the NAT Gateway are all
# covered, including ENIs created later. ALL traffic, not only REJECT:
# exfiltration is accepted traffic.
resource "aws_flow_log" "vpc" {
  count = var.network_logs_enabled ? 1 : 0

  vpc_id                   = aws_vpc.main.id
  traffic_type             = "ALL"
  log_destination_type     = "s3"
  log_destination          = "${local.log_bucket_arn}/${local.log_prefixes.vpc_flow}/"
  log_format               = local.flow_log_format
  max_aggregation_interval = 600

  destination_options {
    file_format                = "parquet"
    hive_compatible_partitions = true
    per_hour_partition         = true
  }

  tags = { Name = "pensieve" }
}

locals {
  # The default fields, plus the four that see through the NAT Gateway:
  # on its ENI, srcaddr/dstaddr are the NAT's own addresses, while
  # pkt-srcaddr/pkt-dstaddr are the task's private IP and the real
  # destination. flow-direction tells egress from ingress, and traffic-path
  # how egress left the VPC.
  # Keep in step with the Athena table's columns (bootstrap's
  # network-logs.tf), which name each field with underscores.
  flow_log_fields = [
    "version", "account-id", "interface-id", "srcaddr", "dstaddr", "srcport", "dstport",
    "protocol", "packets", "bytes", "start", "end", "action", "log-status",
    "pkt-srcaddr", "pkt-dstaddr", "flow-direction", "traffic-path",
  ]
  flow_log_format = join(" ", [for f in local.flow_log_fields : "$${${f}}"])
}

# Every DNS query the VPC's resolver answers, the task's included.
resource "aws_route53_resolver_query_log_config" "vpc" {
  count = var.network_logs_enabled ? 1 : 0

  name            = "pensieve"
  destination_arn = "${local.log_bucket_arn}/${local.log_prefixes.resolver}"
}

resource "aws_route53_resolver_query_log_config_association" "vpc" {
  count = var.network_logs_enabled ? 1 : 0

  resolver_query_log_config_id = aws_route53_resolver_query_log_config.vpc[0].id
  resource_id                  = aws_vpc.main.id
}
