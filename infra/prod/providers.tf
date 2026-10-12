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
