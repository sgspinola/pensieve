# Ticket 48: Terraform and the AWS provider pinned as in the bootstrap
# config, kept equal to it: Terraform 1.16, any patch (CI runs the exact
# infra/.terraform-version; keep that inside this range), and the AWS provider
# to a minor version. Ticket 49 adds the Cloudflare and random providers
# (prod only), pinned the same way. The
# committed .terraform.lock.hcl pins the exact build, with darwin-arm64 and
# linux-arm64 checksums (`terraform providers lock -platform=darwin_arm64
# -platform=linux_arm64`).
terraform {
  required_version = "~> 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9.0"
    }
  }

  # State lives in the bootstrap config's bucket, KMS-encrypted (the bucket's
  # default), locked with S3's native lockfile. The bucket name carries the
  # account ID, which stays out of this public repository, so it's passed at
  # init: `terraform init -backend-config=bucket=pensieve-tfstate-<account>`
  # (CI derives it from the plan role's ARN).
  backend "s3" {
    key          = "prod/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}
