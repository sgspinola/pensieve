# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# Ticket 58: the account's log bucket. CloudTrail (audit-trail.tf) delivers
# here, prod's VPC flow logs and Resolver query logs will too (ticket 59),
# and Athena writes its query results here. Only the admin user can read it;
# AWS services can only write, each to its own prefix. Investigation only:
# nothing here alerts (spec 11 excludes alarms).

# No access logging: it would need yet another bucket. Reads and deletes of
# these objects are CloudTrail data events instead (audit-trail.tf).
# kics-scan ignore-block
resource "aws_s3_bucket" "logs" {
  bucket = local.log_bucket
}

# kics-scan ignore-block (no MFA Delete: only the root user can enable it, via the CLI)
resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3, not KMS: log delivery would need a key-policy grant per service,
# and the bucket policy already decides who can read.
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Days to keep each prefix. CloudTrail matches the 90 days of the free Event
# History. A deleted or overwritten object stays recoverable as a noncurrent
# version for a while after (except Athena's throwaway results).
locals {
  log_retention = {
    (local.log_prefixes.cloudtrail)     = { days = 90, noncurrent_days = 30 }
    (local.log_prefixes.vpc_flow)       = { days = 30, noncurrent_days = 30 }
    (local.log_prefixes.resolver)       = { days = 30, noncurrent_days = 30 }
    (local.log_prefixes.athena_results) = { days = 7, noncurrent_days = 1 }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  dynamic "rule" {
    for_each = local.log_retention
    content {
      id     = rule.key
      status = "Enabled"
      filter {
        prefix = "${rule.key}/"
      }
      expiration {
        days = rule.value.days
      }
      noncurrent_version_expiration {
        noncurrent_days = rule.value.noncurrent_days
      }
      abort_incomplete_multipart_upload {
        days_after_initiation = 1
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.logs]
}

data "aws_iam_policy_document" "log_bucket" {
  # Service principals carry no aws:PrincipalArn, and ArnNotLike matches a
  # missing key, so without an exemption this would deny CloudTrail and log
  # delivery too. The allows below scope those. aws:PrincipalIsAWSService,
  # not a Null test on aws:PrincipalArn: CloudTrail's create-time policy
  # check rejected the Null form (InsufficientS3BucketPolicyException).
  statement {
    sid       = "OnlyAdmin"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:PrincipalIsAWSService"
      values   = ["false"]
    }
    condition {
      test     = "ArnNotLike"
      variable = "aws:PrincipalArn"
      values   = [local.admin_user_arn]
    }
  }

  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.logs.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/${local.log_prefixes.cloudtrail}/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  # VPC flow logs and Resolver query logs (ticket 59) both deliver as
  # delivery.logs.amazonaws.com. Hive-style flow-log keys put
  # `aws-account-id=<id>` after AWSLogs/, so the account is pinned by
  # aws:SourceAccount rather than the path.
  statement {
    sid       = "LogDeliveryAclCheck"
    actions   = ["s3:GetBucketAcl", "s3:ListBucket"]
    resources = [aws_s3_bucket.logs.arn]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:${local.region}:${local.account_id}:*"]
    }
  }

  statement {
    sid     = "LogDeliveryWrite"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.logs.arn}/${local.log_prefixes.vpc_flow}/AWSLogs/*",
      "${aws_s3_bucket.logs.arn}/${local.log_prefixes.resolver}/AWSLogs/*",
    ]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:${local.region}:${local.account_id}:*"]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.log_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.logs]
}
