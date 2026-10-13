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

  # Ticket 49. The deploy roles may run and pass only the app and migrate
  # families and their roles; the db-bootstrap family's names
  # (pensieve-db-bootstrap*) are deliberately absent from the bootstrap
  # config.
  ecs_cluster = "pensieve"
  ecs_service = "pensieve"

  task_families = {
    app          = "pensieve-app"
    migrate      = "pensieve-migrate"
    db_bootstrap = "pensieve-db-bootstrap"
  }

  # Task (runtime) and execution (image pull, logs, secrets) roles. The
  # db-bootstrap family has no task role (iam.tf).
  roles = {
    app_task               = "pensieve-app-task"
    app_execution          = "pensieve-app-execution"
    migrate_task           = "pensieve-migrate-task"
    migrate_execution      = "pensieve-migrate-execution"
    db_bootstrap_execution = "pensieve-db-bootstrap-execution"
  }

  # kics-scan ignore-line (the secret's name, not its value)
  tunnel_token_secret = "pensieve/cloudflared-tunnel-token"

  # Ticket 59: the bootstrap config's log bucket and the two prefixes its
  # policy lets log delivery write to (infra/bootstrap/names.tf).
  log_bucket     = "pensieve-logs-${local.account_id}"
  log_bucket_arn = "arn:aws:s3:::${local.log_bucket}"
  log_prefixes = {
    vpc_flow = "vpc-flow"
    resolver = "resolver"
  }

  # Not shared with the bootstrap config.
  domain = "pensieve.fyi"

  # The database users db/bootstrap.sql creates (spec 13), each IAM-only.
  db_users = {
    app      = "pensieve_app"
    migrator = "pensieve_migrator"
  }

  account_id = data.aws_caller_identity.current.account_id
}

data "aws_caller_identity" "current" {}
