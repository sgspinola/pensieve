# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# The S3 bucket every other root config keeps its state in. Locking uses S3's
# native lockfile (`use_lockfile = true` in the prod backend), so there's no
# DynamoDB table. The prod state will hold the Cloudflare tunnel token, so
# the bucket is KMS-encrypted and only the admin and plan roles can reach it
# (plus the auditor user, for the bucket's configuration only).

# kics-scan ignore-block (no explicit policy: the default delegates to IAM, see below)
resource "aws_kms_key" "state" {
  description         = "Terraform state (pensieve)"
  enable_key_rotation = true
  # The default key policy: the account's IAM policies decide who may use it
  # (the admin permission set, and the plan role's decrypt grant).
}

resource "aws_kms_alias" "state" {
  name          = "alias/pensieve-tfstate"
  target_key_id = aws_kms_key.state.key_id
}

# No access logging: it needs a second bucket, and CloudTrail records changes
# to the bucket policy and the key.
# kics-scan ignore-block
resource "aws_s3_bucket" "state" {
  # Bucket names are global; the account ID keeps this one unique.
  bucket = "pensieve-tfstate-${local.account_id}"
}

# kics-scan ignore-block (no MFA Delete: only the root user can enable it, via the CLI)
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

locals {
  admin_user_arn   = "arn:aws:iam::${local.account_id}:user/${var.admin_user_name}"
  auditor_user_arn = "arn:aws:iam::${local.account_id}:user/${var.auditor_user_name}"

  # What the auditor may do on the state and log buckets: read their
  # configuration, as ScoutSuite does. Its ReadOnlyAccess would otherwise
  # also read the objects (the state holds the tunnel token), and ListBucket
  # is left out too, since object keys alone say something.
  auditor_bucket_config_reads = [
    "s3:GetBucketAcl",
    "s3:GetBucketLogging",
    "s3:GetBucketPolicy",
    "s3:GetBucketPublicAccessBlock",
    "s3:GetBucketTagging",
    "s3:GetBucketVersioning",
    "s3:GetBucketWebsite",
    "s3:GetEncryptionConfiguration",
    "s3:GetLifecycleConfiguration",
  ]
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid       = "OnlyAdminPlanAndAuditor"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotLike"
      variable = "aws:PrincipalArn"
      values   = [local.admin_user_arn, aws_iam_role.plan.arn, local.auditor_user_arn]
    }
  }

  statement {
    sid         = "AuditorConfigOnly"
    effect      = "Deny"
    not_actions = local.auditor_bucket_config_reads
    resources   = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:PrincipalArn"
      values   = [local.auditor_user_arn]
    }
  }

  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
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
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.state]
}
