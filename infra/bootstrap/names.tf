# Ticket 46: shared settings, and the names of resources the prod config
# (tickets 48 and 49) creates later. The CI roles are scoped to those by ARN
# before they exist, so prod must use exactly these names: change one here
# and there together. Note each task family has its own execution role.
# The db-bootstrap family and its roles (pensieve-db-bootstrap*) are
# deliberately absent: no CI role may run or pass them.
locals {
  region      = "eu-north-1"
  account_id  = data.aws_caller_identity.current.account_id
  github_repo = "sgspinola/pensieve"

  ecr_repositories = ["pensieve", "pensieve-db"]

  ecs_cluster = "pensieve"
  ecs_service = "pensieve"

  task_families = {
    app     = "pensieve-app"
    migrate = "pensieve-migrate"
  }

  # Task (runtime) and execution (image pull, logs) roles per task family.
  app_task_roles     = ["pensieve-app-task", "pensieve-app-execution"]
  migrate_task_roles = ["pensieve-migrate-task", "pensieve-migrate-execution"]

  migrate_log_group = "/ecs/pensieve-migrate"

  rds_instance              = "pensieve"
  predeploy_snapshot_prefix = "pensieve-predeploy-"

  # Secrets Manager secret holding the Cloudflare tunnel token (ticket 49).
  # kics-scan ignore-line (the secret's name, not its value)
  tunnel_token_secret = "pensieve/cloudflared-tunnel-token"

  # Derived ARNs.
  ecr_repository_arn  = { for r in local.ecr_repositories : r => "arn:aws:ecr:${local.region}:${local.account_id}:repository/${r}" }
  ecr_repository_arns = values(local.ecr_repository_arn)
  ecs_cluster_arn     = "arn:aws:ecs:${local.region}:${local.account_id}:cluster/${local.ecs_cluster}"
  ecs_service_arn     = "arn:aws:ecs:${local.region}:${local.account_id}:service/${local.ecs_cluster}/${local.ecs_service}"
  ecs_cluster_tasks   = "arn:aws:ecs:${local.region}:${local.account_id}:task/${local.ecs_cluster}/*"
  task_definition_arn = { for k, f in local.task_families : k => "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/${f}:*" }
  rds_instance_arn    = "arn:aws:rds:${local.region}:${local.account_id}:db:${local.rds_instance}"
  predeploy_snapshots = "arn:aws:rds:${local.region}:${local.account_id}:snapshot:${local.predeploy_snapshot_prefix}*"
  all_snapshots       = "arn:aws:rds:${local.region}:${local.account_id}:snapshot:*"
  # Secrets Manager appends a random suffix to every secret's ARN.
  tunnel_token_secret_arn = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${local.tunnel_token_secret}-*"
  migrate_log_arn         = "arn:aws:logs:${local.region}:${local.account_id}:log-group:${local.migrate_log_group}:*"
  role_arns               = { for r in concat(local.app_task_roles, local.migrate_task_roles) : r => "arn:aws:iam::${local.account_id}:role/${r}" }
}
