# Ticket 46: exact Terraform version, matching infra/.terraform-version (the
# file CI's setup step reads), so a plan behaves the same on the maintainer's
# laptop and in CI. The provider is pinned to a minor version; the committed
# .terraform.lock.hcl pins the exact build, with darwin-arm64 and linux-arm64
# checksums (`terraform providers lock -platform=darwin_arm64 -platform=linux_arm64`).
terraform {
  required_version = "1.16.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67.0"
    }
  }

  # Local state on purpose: this config creates the S3 bucket every other
  # config keeps its state in. It holds no secrets (no resource here has a
  # secret attribute), and everything in it can be re-imported if it's lost.
}
