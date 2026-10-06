# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# Ticket 58: who did what in the account over the last 90 days, including
# read-only calls and every read of the Terraform state, queryable with
# Athena. Investigation only: no CloudWatch Logs, metric filters or SNS
# (spec 11 excludes alarms).

# Semgrep's CMK finding is suppressed on the resource line, for the SSE-S3 reason below.
# kics-scan ignore-block (SSE-S3 rather than KMS, and no CloudWatch Logs or SNS: see log-bucket.tf and the header)
resource "aws_cloudtrail" "account" { # nosemgrep: terraform.aws.security.aws-cloudtrail-encrypted-with-cmk.aws-cloudtrail-encrypted-with-cmk
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.logs.id
  s3_key_prefix                 = local.log_prefixes.cloudtrail
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true

  # Read and write management events (no readOnly selector means both).
  advanced_event_selector {
    name = "Management events"
    field_selector {
      field  = "eventCategory"
      equals = ["Management"]
    }
  }

  # Every object-level call on the state, so each read of it shows who.
  advanced_event_selector {
    name = "State bucket objects"
    field_selector {
      field  = "eventCategory"
      equals = ["Data"]
    }
    field_selector {
      field  = "resources.type"
      equals = ["AWS::S3::Object"]
    }
    field_selector {
      field       = "resources.ARN"
      starts_with = ["${aws_s3_bucket.state.arn}/"]
    }
  }

  # Reads and deletes of the logs themselves. PutObject is left out, or
  # every delivery (this trail's included) would log another event.
  advanced_event_selector {
    name = "Log bucket objects, except writes"
    field_selector {
      field  = "eventCategory"
      equals = ["Data"]
    }
    field_selector {
      field  = "resources.type"
      equals = ["AWS::S3::Object"]
    }
    field_selector {
      field       = "resources.ARN"
      starts_with = ["${aws_s3_bucket.logs.arn}/"]
    }
    field_selector {
      field      = "eventName"
      not_equals = ["PutObject"]
    }
  }

  # CloudTrail checks it can write to the bucket when the trail is created.
  depends_on = [aws_s3_bucket_policy.logs]
}

# Queries run as the admin user, the only principal the log bucket lets read.
resource "aws_athena_workgroup" "logs" {
  name = "pensieve"

  configuration {
    enforce_workgroup_configuration = true
    result_configuration {
      output_location       = "s3://${aws_s3_bucket.logs.id}/${local.log_prefixes.athena_results}/"
      expected_bucket_owner = local.account_id
      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }
}

resource "aws_glue_catalog_database" "logs" {
  name = "pensieve_logs"
}

# The regions the multi-region trail writes to, for the partition projection.
data "aws_regions" "enabled" {}

# AWS's CloudTrail table, with partition projection over region and day so
# no partition ever needs adding. Filter on `day` ('yyyy/MM/dd') to keep
# scans small, e.g. WHERE day >= '2026/10/01'.
resource "aws_glue_catalog_table" "cloudtrail" {
  database_name = aws_glue_catalog_database.logs.name
  name          = "cloudtrail"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                       = "TRUE"
    classification                 = "cloudtrail"
    "projection.enabled"           = "true"
    "projection.region.type"       = "enum"
    "projection.region.values"     = join(",", sort(data.aws_regions.enabled.names))
    "projection.day.type"          = "date"
    "projection.day.format"        = "yyyy/MM/dd"
    "projection.day.range"         = "2026/10/01,NOW"
    "projection.day.interval"      = "1"
    "projection.day.interval.unit" = "DAYS"
    "storage.location.template"    = "s3://${aws_s3_bucket.logs.id}/${local.log_prefixes.cloudtrail}/AWSLogs/${local.account_id}/CloudTrail/$${region}/$${day}"
  }

  partition_keys {
    name = "region"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/${local.log_prefixes.cloudtrail}/AWSLogs/${local.account_id}/CloudTrail/"
    input_format  = "com.amazon.emr.cloudtrail.CloudTrailInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    dynamic "columns" {
      for_each = local.cloudtrail_columns
      content {
        name = columns.value[0]
        type = columns.value[1]
      }
    }
  }
}

locals {
  # [name, type], in the order of AWS's DDL (a map would sort them).
  cloudtrail_columns = [
    ["eventversion", "string"],
    ["useridentity", "struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,onbehalfof:struct<userid:string,identitystorearn:string>,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>,sourceidentity:string,ec2roledelivery:string,webidfederationdata:struct<federatedprovider:string,attributes:map<string,string>>>>"],
    ["eventtime", "string"],
    ["eventsource", "string"],
    ["eventname", "string"],
    ["awsregion", "string"],
    ["sourceipaddress", "string"],
    ["useragent", "string"],
    ["errorcode", "string"],
    ["errormessage", "string"],
    ["requestparameters", "string"],
    ["responseelements", "string"],
    ["additionaleventdata", "string"],
    ["requestid", "string"],
    ["eventid", "string"],
    ["readonly", "string"],
    ["resources", "array<struct<arn:string,accountid:string,type:string>>"],
    ["eventtype", "string"],
    ["apiversion", "string"],
    ["recipientaccountid", "string"],
    ["serviceeventdetails", "string"],
    ["sharedeventid", "string"],
    ["vpcendpointid", "string"],
    ["vpcendpointaccountid", "string"],
    ["eventcategory", "string"],
    ["addendum", "struct<reason:string,updatedfields:string,originalrequestid:string,originaleventid:string>"],
    ["sessioncredentialfromconsole", "string"],
    ["edgedevicedetails", "string"],
    ["tlsdetails", "struct<tlsversion:string,ciphersuite:string,clienthostheader:string>"],
  ]
}
