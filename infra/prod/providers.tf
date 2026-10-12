provider "aws" {
  region = local.region

  default_tags {
    tags = {
      Project   = "pensieve"
      ManagedBy = "terraform"
      Config    = "prod"
    }
  }
}

# Ticket 49. The API token comes from CLOUDFLARE_API_TOKEN: the maintainer's
# own for applies, a read-only (Zone and Tunnel read) one in CI's plan.
provider "cloudflare" {}
