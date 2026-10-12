# Ticket 49 (spec 11, "Compute" and "Database"). Each task family has an
# execution role (ECS's own: pull the image, write logs, inject secrets) and,
# where the container needs AWS, a task role (the container's credentials).
#   app           connects to RDS as pensieve_app; its execution role reads
#                 the tunnel token
#   migrate       connects to RDS as pensieve_migrator
#   db-bootstrap  its execution role is the only one that reads the RDS master
#                 secret, which ECS injects as PGUSER/PGPASSWORD. Its task role
#                 is temporary (ticket 62): it may connect as the master over
#                 IAM, for one recovery run
# The deploy roles (infra/bootstrap) may pass the app and migrate roles by
# name, and none of the db-bootstrap ones.
#
# Policies are jsonencode()d rather than aws_iam_policy_document data
# sources so tests/compute.tftest.hcl can read them under a mocked provider.
locals {
  ecs_tasks_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Only on behalf of this account's tasks (confused deputy).
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })

  # rds-db:connect is scoped by the instance's resource ID, not its name.
  db_user_arn = {
    for k, user in local.db_users : k =>
    "arn:aws:rds-db:${local.region}:${local.account_id}:dbuser:${aws_db_instance.main.resource_id}/${user}"
  }

  # Every execution role pulls one image and writes some log groups.
  pull_image = {
    Effect = "Allow"
    Action = "ecr:GetAuthorizationToken"
    # kics-scan ignore-line (account-level; can't be scoped to a repository)
    Resource = "*"
  }
}

# --- app ----------------------------------------------------------------------
resource "aws_iam_role" "app_task" {
  name               = local.roles.app_task
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "app_task" {
  name = "connect-as-app"
  role = aws_iam_role.app_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = local.db_user_arn.app
    }]
  })
}

resource "aws_iam_role" "app_execution" {
  name               = local.roles.app_execution
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "app_execution" {
  name = "app-execution"
  role = aws_iam_role.app_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.pull_image,
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = aws_ecr_repository.main["pensieve"].arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [for g in ["app", "cloudflared"] : "${aws_cloudwatch_log_group.ecs[g].arn}:*"]
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.tunnel_token.arn
      },
    ]
  })
}

# --- migrate ------------------------------------------------------------------
resource "aws_iam_role" "migrate_task" {
  name               = local.roles.migrate_task
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "migrate_task" {
  name = "connect-as-migrator"
  role = aws_iam_role.migrate_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = local.db_user_arn.migrator
    }]
  })
}

resource "aws_iam_role" "migrate_execution" {
  name               = local.roles.migrate_execution
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "migrate_execution" {
  name = "migrate-execution"
  role = aws_iam_role.migrate_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.pull_image,
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = aws_ecr_repository.main["pensieve-db"].arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.ecs["migrate"].arn}:*"]
      },
    ]
  })
}

# --- db-bootstrap -------------------------------------------------------------
resource "aws_iam_role" "db_bootstrap_execution" {
  name               = local.roles.db_bootstrap_execution
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "db_bootstrap_execution" {
  name = "db-bootstrap-execution"
  role = aws_iam_role.db_bootstrap_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.pull_image,
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = aws_ecr_repository.main["pensieve-db"].arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.ecs["db_bootstrap"].arn}:*"]
      },
      # The RDS-managed master secret uses the AWS-managed Secrets Manager
      # key, so no KMS grant is needed.
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_db_instance.main.master_user_secret[0].secret_arn
      },
    ]
  })
}

# Ticket 62, temporary. The first bootstrap left the master a member of
# pensieve_migrator, which holds rds_iam, so RDS refuses its password: the
# recovery run logs in as the master with an IAM token instead (bootstrap.cjs
# with BOOTSTRAP_AUTH=iam, compute.tf) and runs the fixed bootstrap, which
# gives the membership up. Remove this role, its policy and the task
# definition's task role and BOOTSTRAP_AUTH once a password-mode run works.
# No deploy role may pass it (infra/bootstrap leaves pensieve-db-bootstrap*
# out).
resource "aws_iam_role" "db_bootstrap_task" {
  name               = local.roles.db_bootstrap_task
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "db_bootstrap_task" {
  name = "connect-as-master"
  role = aws_iam_role.db_bootstrap_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = "arn:aws:rds-db:${local.region}:${local.account_id}:dbuser:${aws_db_instance.main.resource_id}/${aws_db_instance.main.username}"
    }]
  })
}

