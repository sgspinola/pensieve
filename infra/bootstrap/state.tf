# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# The S3 bucket every other root config keeps its state in. Locking uses S3's
# native lockfile (`use_lockfile = true` in the prod backend), so there's no
# DynamoDB table. The prod state will hold the Cloudflare tunnel token, so
# the bucket is KMS-encrypted and only the admin and plan roles can reach it.

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
  # Identity Center roles live under aws-reserved/sso.amazonaws.com/, with
  # or without a region segment depending on the account, and end in a
  # random suffix, hence the wildcards.
  admin_role_arn_pattern = "arn:aws:iam::${local.account_id}:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_${var.admin_permission_set_name}_*"
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid       = "OnlyAdminAndPlan"
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
      values   = [local.admin_role_arn_pattern, aws_iam_role.plan.arn]
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
