# Ticket 48: shared settings. The names the bootstrap config's CI roles are
# scoped to (infra/bootstrap/names.tf) must match exactly: change one there
# and here together.
locals {
  region = "eu-north-1"

  # Two AZs, because an RDS subnet group needs two. The task and the
  # instance both run in the first.
  azs = ["eu-north-1a", "eu-north-1b"]

  ecr_repositories = ["pensieve", "pensieve-db"]

  rds_instance = "pensieve"

  log_groups = {
    app          = "/ecs/pensieve-app"
    cloudflared  = "/ecs/pensieve-cloudflared"
    migrate      = "/ecs/pensieve-migrate"
    db_bootstrap = "/ecs/pensieve-db-bootstrap"
  }
}
