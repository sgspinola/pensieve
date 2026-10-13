# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# Ticket 59: Athena tables over the network logs prod delivers to the log
# bucket (infra/prod/network-logs.tf), next to the CloudTrail table
# (audit-trail.tf) in the same database and workgroup. Both use partition
# projection, so there are no partitions to add. Keep each table's columns
# in step with what prod writes.

# VPC flow logs: Parquet, in Hive-style hourly partitions. Filter on year,
# month and day (and hour) to keep scans small, e.g.
#   WHERE year = 2026 AND month = 10 AND day = 13
# Without them, Athena projects every hour up to 2100.
resource "aws_glue_catalog_table" "vpc_flow" {
  database_name = aws_glue_catalog_database.logs.name
  name          = "vpc_flow"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                    = "TRUE"
    classification              = "parquet"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2026,2100"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "projection.hour.type"      = "integer"
    "projection.hour.range"     = "0,23"
    "projection.hour.digits"    = "2"
    "storage.location.template" = "${local.vpc_flow_location}year=$${year}/month=$${month}/day=$${day}/hour=$${hour}"
  }

  dynamic "partition_keys" {
    for_each = ["year", "month", "day", "hour"]
    content {
      name = partition_keys.value
      type = "int"
    }
  }

  storage_descriptor {
    location      = local.vpc_flow_location
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.vpc_flow_columns
      content {
        name = columns.value[0]
        type = columns.value[1]
      }
    }
  }
}

# Resolver query logs: gzipped JSON lines, under a folder per VPC and day.
# The VPC is prod's, which this config can't know, so `vpc` is injected:
# every query names it, with the day ('yyyy/MM/dd'), e.g.
#   WHERE vpc = 'vpc-0123456789abcdef0' AND day >= '2026/10/13'
# (`aws ec2 describe-vpcs --filters Name=tag:Name,Values=pensieve`).
resource "aws_glue_catalog_table" "resolver" {
  database_name = aws_glue_catalog_database.logs.name
  name          = "resolver"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                       = "TRUE"
    classification                 = "json"
    "projection.enabled"           = "true"
    "projection.vpc.type"          = "injected"
    "projection.day.type"          = "date"
    "projection.day.format"        = "yyyy/MM/dd"
    "projection.day.range"         = "2026/10/13,NOW"
    "projection.day.interval"      = "1"
    "projection.day.interval.unit" = "DAYS"
    "storage.location.template"    = "${local.resolver_location}$${vpc}/$${day}"
  }

  partition_keys {
    name = "vpc"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
  }

  storage_descriptor {
    location      = local.resolver_location
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
    }

    dynamic "columns" {
      for_each = local.resolver_columns
      content {
        name = columns.value[0]
        type = columns.value[1]
      }
    }
  }
}

locals {
  vpc_flow_location = "s3://${aws_s3_bucket.logs.id}/${local.log_prefixes.vpc_flow}/AWSLogs/aws-account-id=${local.account_id}/aws-service=vpcflowlogs/aws-region=${local.region}/"
  resolver_location = "s3://${aws_s3_bucket.logs.id}/${local.log_prefixes.resolver}/AWSLogs/${local.account_id}/vpcdnsquerylogs/"

  # [name, type], in the order of prod's flow-log format (a map would sort
  # them). Parquet names each field with underscores for its hyphens.
  vpc_flow_columns = [
    ["version", "int"],
    ["account_id", "string"],
    ["interface_id", "string"],
    ["srcaddr", "string"],
    ["dstaddr", "string"],
    ["srcport", "int"],
    ["dstport", "int"],
    ["protocol", "bigint"],
    ["packets", "bigint"],
    ["bytes", "bigint"],
    ["start", "bigint"],
    ["end", "bigint"],
    ["action", "string"],
    ["log_status", "string"],
    ["pkt_srcaddr", "string"],
    ["pkt_dstaddr", "string"],
    ["flow_direction", "string"],
    ["traffic_path", "int"],
  ]

  # AWS's Resolver query log fields.
  resolver_columns = [
    ["version", "string"],
    ["account_id", "string"],
    ["region", "string"],
    ["vpc_id", "string"],
    ["query_timestamp", "string"],
    ["query_name", "string"],
    ["query_type", "string"],
    ["query_class", "string"],
    ["rcode", "string"],
    ["answers", "array<struct<rdata:string,type:string,class:string>>"],
    ["srcaddr", "string"],
    ["srcport", "int"],
    ["transport", "string"],
    ["srcids", "struct<instance:string,resolver_endpoint:string>"],
    ["firewall_rule_action", "string"],
    ["firewall_rule_group_id", "string"],
    ["firewall_domain_list_id", "string"],
  ]
}
