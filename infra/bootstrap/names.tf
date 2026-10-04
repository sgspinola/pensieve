# Names of resources the prod config (tickets 48 and 49) creates later. The
# deploy roles below are scoped to them by ARN before they exist, so prod must
# use exactly these names: change one here and there together.
locals {
  region      = "eu-north-1"
  account_id  = data.aws_caller_identity.current.account_id
  github_repo = "sgspinola/pensieve"

  ecr_repositories = ["pensieve", "pensieve-db"]

  ecs_cluster = "pensieve"
  ecs_service = "pensieve"

  task_families = {
    app          = "pensieve-app"
    migrate      = "pensieve-migrate"
    db_bootstrap = "pensieve-db-bootstrap" # no GitHub role may touch this one
  }

  # Task (runtime) and execution (image pull, logs) roles per task family.
  app_task_roles     = ["pensieve-app-task", "pensieve-app-execution"]
  migrate_task_roles = ["pensieve-migrate-task", "pensieve-migrate-execution"]

  migrate_log_group = "/ecs/pensieve-migrate"

  rds_instance              = "pensieve"
  predeploy_snapshot_prefix = "pensieve-predeploy-"

  # Derived ARNs.
  ecr_repository_arns = [for r in local.ecr_repositories : "arn:aws:ecr:${local.region}:${local.account_id}:repository/${r}"]
  ecs_cluster_arn     = "arn:aws:ecs:${local.region}:${local.account_id}:cluster/${local.ecs_cluster}"
  ecs_service_arn     = "arn:aws:ecs:${local.region}:${local.account_id}:service/${local.ecs_cluster}/${local.ecs_service}"
  task_definition_arn = { for k, f in local.task_families : k => "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/${f}:*" }
  rds_instance_arn    = "arn:aws:rds:${local.region}:${local.account_id}:db:${local.rds_instance}"
  predeploy_snapshots = "arn:aws:rds:${local.region}:${local.account_id}:snapshot:${local.predeploy_snapshot_prefix}*"
  migrate_log_arn     = "arn:aws:logs:${local.region}:${local.account_id}:log-group:${local.migrate_log_group}:*"
  role_arns           = { for r in concat(local.app_task_roles, local.migrate_task_roles) : r => "arn:aws:iam::${local.account_id}:role/${r}" }
}
