# Ticket 49 (spec 11, "Compute"). One Fargate ARM64 service running the app
# and its `cloudflared` sidecar, plus the one-off migrate and db-bootstrap
# task definitions on the DB image (spec 13).
#
# Terraform creates only the first revision of each task definition. The
# deploy workflows (specs 12 and 13) and the local db-bootstrap script
# register new revisions from the current one with only the image changed,
# and own the service's task definition and desired count from then on, so
# the service ignores both. The initial image is the moving `main` tag; the
# service starts at 0 tasks, so it never runs until the first deploy-app
# points it at a `sha-*` image.
resource "aws_ecs_cluster" "main" {
  name = local.ecs_cluster

  # Off: it bills per metric, and spec 11 has no alarms to feed.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

locals {
  # The libpq-style variables src/db/connection.ts builds an IAM-auth
  # connection from (ticket 40). PGUSER is per task.
  db_connection_env = {
    PGHOST     = aws_db_instance.main.address
    PGPORT     = tostring(aws_db_instance.main.port)
    PGDATABASE = aws_db_instance.main.db_name
  }

  awslogs = {
    for k, g in aws_cloudwatch_log_group.ecs : k => {
      logDriver = "awslogs"
      options = {
        awslogs-group         = g.name
        awslogs-region        = local.region
        awslogs-stream-prefix = k
      }
    }
  }

  # Pinned by multi-arch index digest; bump tag and digest together.
  cloudflared_image = "cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07"

  # Every task (the app's two containers share it): 0.25 vCPU / 1 GB on
  # Graviton (spec 11, user stories 24, 25).
  task_size = {
    cpu                     = "256"
    memory                  = "1024"
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
}

# --- app ----------------------------------------------------------------------
resource "aws_ecs_task_definition" "app" {
  family                   = local.task_families.app
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.task_size.cpu
  memory                   = local.task_size.memory
  task_role_arn            = aws_iam_role.app_task.arn
  execution_role_arn       = aws_iam_role.app_execution.arn

  runtime_platform {
    operating_system_family = local.task_size.operating_system_family
    cpu_architecture        = local.task_size.cpu_architecture
  }

  # No port mappings: in awsvpc mode cloudflared reaches the app on
  # localhost, and nothing outside the task can.
  container_definitions = jsonencode([
    {
      name      = "app"
      image     = "${aws_ecr_repository.main["pensieve"].repository_url}:main"
      essential = true
      environment = [for k, v in merge(local.db_connection_env, {
        PGUSER = local.db_users.app
        # The image sets it too; repeated so a runtime-set hostname can't make
        # Next.js bind to the task IP only, out of cloudflared's and the
        # health check's reach on localhost.
        HOSTNAME = "0.0.0.0"
        # Passkeys bind to the RP ID permanently (spec 11, user story 15).
        WEBAUTHN_RP_ID  = local.domain
        WEBAUTHN_ORIGIN = "https://${local.domain}"
      }) : { name = k, value = v }]
      # The image's HEALTHCHECK, which ECS doesn't read: the Node script
      # probes /api/health, which checks the database too (user story 44).
      healthCheck = {
        command     = ["CMD", "/nodejs/bin/node", "healthcheck.cjs"]
        interval    = 30
        timeout     = 5
        startPeriod = 15
        retries     = 3
      }
      logConfiguration = local.awslogs.app
    },
    {
      name    = "cloudflared"
      image   = local.cloudflared_image
      command = ["tunnel", "--no-autoupdate", "run"]
      # A task stops when any essential container does, so a dead tunnel
      # gets the task replaced.
      essential = true
      # cloudflared reads TUNNEL_TOKEN; ECS fetches it with the execution
      # role, so it's never in the task definition.
      secrets = [{ name = "TUNNEL_TOKEN", valueFrom = aws_secretsmanager_secret.tunnel_token.arn }]
      # No traffic until the app answers its health check.
      dependsOn        = [{ containerName = "app", condition = "HEALTHY" }]
      logConfiguration = local.awslogs.cloudflared
    },
  ])
}

resource "aws_ecs_service" "app" {
  name            = local.ecs_service
  cluster         = aws_ecs_cluster.main.arn
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"
  # The first deploy-app run sets it to 1 (spec 11, user story 52).
  desired_count = 0

  # The old task stops before the new one starts, so two app versions never
  # run at once (user story 43); a new task that never gets healthy rolls
  # back (user story 42).
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # In the RDS instance's AZ (network.tf), with no public address.
  network_configuration {
    subnets          = [aws_subnet.private[local.azs[0]].id]
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# --- one-off tasks on the DB image (spec 13) ----------------------------------
# Run by deploy-db (migrate) and the maintainer's local script (db-bootstrap),
# in the service's subnet and security group.

resource "aws_ecs_task_definition" "migrate" {
  family                   = local.task_families.migrate
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.task_size.cpu
  memory                   = local.task_size.memory
  task_role_arn            = aws_iam_role.migrate_task.arn
  execution_role_arn       = aws_iam_role.migrate_execution.arn

  runtime_platform {
    operating_system_family = local.task_size.operating_system_family
    cpu_architecture        = local.task_size.cpu_architecture
  }

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.main["pensieve-db"].repository_url}:main"
    essential = true
    command   = ["migrate.cjs"]
    environment = [for k, v in merge(local.db_connection_env, {
      PGUSER = local.db_users.migrator
    }) : { name = k, value = v }]
    logConfiguration = local.awslogs.migrate
  }])
}

# Logs in as the RDS master user with the RDS-managed secret's username and
# password (ticket 42), so it has no task role: it needs no AWS access.
resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = local.task_families.db_bootstrap
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.task_size.cpu
  memory                   = local.task_size.memory
  execution_role_arn       = aws_iam_role.db_bootstrap_execution.arn

  runtime_platform {
    operating_system_family = local.task_size.operating_system_family
    cpu_architecture        = local.task_size.cpu_architecture
  }

  container_definitions = jsonencode([{
    name        = "db-bootstrap"
    image       = "${aws_ecr_repository.main["pensieve-db"].repository_url}:main"
    essential   = true
    command     = ["bootstrap.cjs"]
    environment = [for k, v in local.db_connection_env : { name = k, value = v }]
    secrets = [
      { name = "PGUSER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
    ]
    logConfiguration = local.awslogs.db_bootstrap
  }])
}
