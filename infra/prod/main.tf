# TEMPORARY (ticket 47): read-only smoke test of CI's plan path. Reverted
# before merge; ticket 48 adds the real prod config.
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
  }

  backend "s3" {
    bucket       = "pensieve-tfstate-674123984797"
    key          = "ci-smoke/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-north-1"
}

provider "cloudflare" {}

data "aws_caller_identity" "current" {}

data "cloudflare_zone" "site" {
  filter = {
    name = "pensieve.fyi"
  }
}

data "cloudflare_zero_trust_tunnel_cloudflareds" "all" {
  account_id = data.cloudflare_zone.site.account.id
}

output "assumed_plan_role" {
  description = "CI authenticated to AWS as the plan role."
  value       = strcontains(data.aws_caller_identity.current.arn, "pensieve-github-plan")
}

output "zone_readable" {
  description = "The Cloudflare token can read the zone."
  value       = data.cloudflare_zone.site.name == "pensieve.fyi"
}

output "tunnels_listed" {
  description = "The Cloudflare token can list tunnels."
  value       = length(data.cloudflare_zero_trust_tunnel_cloudflareds.all.result)
}
