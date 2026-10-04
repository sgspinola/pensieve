provider "aws" {
  region = local.region

  default_tags {
    tags = {
      Project   = "pensieve"
      ManagedBy = "terraform"
      Config    = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}
