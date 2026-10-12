# Ticket 49: checks of the ECS cluster, service, task definitions and task
# roles against ticket 49's checklist and spec 11 ("Compute", the task
# bullets under "Database"). Mocked providers, as in foundation.tftest.hcl.
# What it can't see: the service's `ignore_changes` (a lifecycle setting, not
# an attribute), which the first deploy after an apply proves.
mock_provider "aws" {
  source = "./tests/mocks/aws"
}

mock_provider "cloudflare" {
  source = "./tests/mocks/cloudflare"
}

variables {
  budget_email = "budget@example.com"
}

run "service" {
  command = apply

  assert {
    condition     = aws_ecs_cluster.main.name == "pensieve" && aws_ecs_service.app.name == "pensieve" && aws_ecs_service.app.cluster == aws_ecs_cluster.main.arn
    error_message = "One cluster and one service, both named pensieve (the deploy roles are scoped to those names)."
  }

  assert {
    condition     = aws_ecs_service.app.launch_type == "FARGATE" && aws_ecs_service.app.desired_count == 0
    error_message = "The service runs on Fargate and starts at desired count 0."
  }

  assert {
    condition     = aws_ecs_service.app.task_definition == aws_ecs_task_definition.app.arn
    error_message = "The service starts on the app task definition."
  }

  assert {
    condition = (
      aws_ecs_service.app.deployment_minimum_healthy_percent == 0 &&
      aws_ecs_service.app.deployment_maximum_percent == 100 &&
      aws_ecs_service.app.deployment_circuit_breaker[0].enable &&
      aws_ecs_service.app.deployment_circuit_breaker[0].rollback
    )
    error_message = "Deployments are 0%/100% (old and new never coexist) with circuit-breaker rollback."
  }

  assert {
    condition = (
      aws_ecs_service.app.network_configuration[0].subnets == toset([aws_subnet.private["eu-north-1a"].id]) &&
      aws_ecs_service.app.network_configuration[0].security_groups == toset([aws_security_group.task.id]) &&
      aws_ecs_service.app.network_configuration[0].assign_public_ip == false
    )
    error_message = "The task runs in the private subnet in the RDS instance's AZ, in the task security group, with no public IP."
  }

  assert {
    condition     = length(aws_ecs_service.app.load_balancer) == 0
    error_message = "No load balancer: the tunnel is the only way in."
  }
}

run "app_task_definition" {
  command = apply

  assert {
    condition = (
      aws_ecs_task_definition.app.family == "pensieve-app" &&
      aws_ecs_task_definition.app.requires_compatibilities == toset(["FARGATE"]) &&
      aws_ecs_task_definition.app.network_mode == "awsvpc" &&
      aws_ecs_task_definition.app.cpu == "256" &&
      aws_ecs_task_definition.app.memory == "1024" &&
      aws_ecs_task_definition.app.runtime_platform[0].cpu_architecture == "ARM64" &&
      aws_ecs_task_definition.app.runtime_platform[0].operating_system_family == "LINUX"
    )
    error_message = "The app family runs on Fargate ARM64 with 0.25 vCPU and 1 GB."
  }

  assert {
    condition = (
      aws_ecs_task_definition.app.task_role_arn == aws_iam_role.app_task.arn &&
      aws_ecs_task_definition.app.execution_role_arn == aws_iam_role.app_execution.arn
    )
    error_message = "The app family uses its own task and execution roles."
  }

  assert {
    condition     = toset([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.name]) == toset(["app", "cloudflared"])
    error_message = "The app task runs the app and a cloudflared sidecar."
  }

  assert {
    condition     = alltrue([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : length(try(c.portMappings, [])) == 0])
    error_message = "No port mappings: nothing listens for traffic from outside the task."
  }

  assert {
    condition = alltrue([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.name != "app" || (
      startswith(c.image, "${aws_ecr_repository.main["pensieve"].repository_url}:") &&
      c.essential &&
      c.healthCheck.command == ["CMD", "/nodejs/bin/node", "healthcheck.cjs"] &&
      c.logConfiguration.logDriver == "awslogs" &&
      c.logConfiguration.options["awslogs-group"] == "/ecs/pensieve-app" &&
      c.logConfiguration.options["awslogs-region"] == "eu-north-1"
    )])
    error_message = "The app container runs the app image, is health-checked by the image's Node health script and logs to /ecs/pensieve-app."
  }

  assert {
    condition = alltrue([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.name != "app" || (
      { for e in c.environment : e.name => e.value } == {
        WEBAUTHN_RP_ID  = "pensieve.fyi"
        WEBAUTHN_ORIGIN = "https://pensieve.fyi"
        PGHOST          = aws_db_instance.main.address
        PGPORT          = tostring(aws_db_instance.main.port)
        PGDATABASE      = "pensieve"
        PGUSER          = "pensieve_app"
        HOSTNAME        = "0.0.0.0"
      } &&
      length(try(c.secrets, [])) == 0
    )])
    error_message = "The app gets the WebAuthn RP ID and origin and the IAM connection variables as pensieve_app, and no secrets (no DATABASE_URL, no password)."
  }

  assert {
    condition = alltrue([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.name != "cloudflared" || (
      can(regex("^cloudflare/cloudflared:[0-9.]+@sha256:[0-9a-f]{64}$", c.image)) &&
      c.essential &&
      c.secrets == [{ name = "TUNNEL_TOKEN", valueFrom = aws_secretsmanager_secret.tunnel_token.arn }] &&
      length(try(c.environment, [])) == 0 &&
      c.dependsOn == [{ containerName = "app", condition = "HEALTHY" }] &&
      c.logConfiguration.logDriver == "awslogs" &&
      c.logConfiguration.options["awslogs-group"] == "/ecs/pensieve-cloudflared"
    )])
    error_message = "The sidecar is cloudflared pinned by digest, gets the tunnel token only from Secrets Manager, starts once the app is healthy and logs to /ecs/pensieve-cloudflared."
  }
}

run "one_off_task_definitions" {
  command = apply

  assert {
    condition = alltrue([for t in [aws_ecs_task_definition.migrate, aws_ecs_task_definition.db_bootstrap] : (
      t.requires_compatibilities == toset(["FARGATE"]) &&
      t.network_mode == "awsvpc" &&
      t.runtime_platform[0].cpu_architecture == "ARM64" &&
      length(jsondecode(t.container_definitions)) == 1 &&
      startswith(jsondecode(t.container_definitions)[0].image, "${aws_ecr_repository.main["pensieve-db"].repository_url}:")
    )])
    error_message = "Migrate and db-bootstrap are one-container Fargate ARM64 tasks on the DB image."
  }

  assert {
    condition = (
      aws_ecs_task_definition.migrate.family == "pensieve-migrate" &&
      aws_ecs_task_definition.migrate.task_role_arn == aws_iam_role.migrate_task.arn &&
      aws_ecs_task_definition.migrate.execution_role_arn == aws_iam_role.migrate_execution.arn &&
      jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].command == ["migrate.cjs"] &&
      jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].logConfiguration.options["awslogs-group"] == "/ecs/pensieve-migrate" &&
      { for e in jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].environment : e.name => e.value } == {
        PGHOST     = aws_db_instance.main.address
        PGPORT     = tostring(aws_db_instance.main.port)
        PGDATABASE = "pensieve"
        PGUSER     = "pensieve_migrator"
      } &&
      length(try(jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].secrets, [])) == 0
    )
    error_message = "Migrate runs migrate.cjs as pensieve_migrator over IAM auth, with its own roles and log group, and no secrets."
  }

  assert {
    condition = (
      aws_ecs_task_definition.db_bootstrap.family == "pensieve-db-bootstrap" &&
      aws_ecs_task_definition.db_bootstrap.execution_role_arn == aws_iam_role.db_bootstrap_execution.arn &&
      jsondecode(aws_ecs_task_definition.db_bootstrap.container_definitions)[0].command == ["bootstrap.cjs"] &&
      jsondecode(aws_ecs_task_definition.db_bootstrap.container_definitions)[0].logConfiguration.options["awslogs-group"] == "/ecs/pensieve-db-bootstrap" &&
      { for e in jsondecode(aws_ecs_task_definition.db_bootstrap.container_definitions)[0].environment : e.name => e.value } == {
        PGHOST     = aws_db_instance.main.address
        PGPORT     = tostring(aws_db_instance.main.port)
        PGDATABASE = "pensieve"
      } &&
      jsondecode(aws_ecs_task_definition.db_bootstrap.container_definitions)[0].secrets == [
        { name = "PGUSER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      ]
    )
    error_message = "db-bootstrap runs bootstrap.cjs as the master user, its PGUSER/PGPASSWORD injected from the RDS-managed secret, with its own log group."
  }
}

run "task_roles" {
  command = apply

  assert {
    condition = (
      aws_iam_role.app_task.name == "pensieve-app-task" &&
      aws_iam_role.app_execution.name == "pensieve-app-execution" &&
      aws_iam_role.migrate_task.name == "pensieve-migrate-task" &&
      aws_iam_role.migrate_execution.name == "pensieve-migrate-execution" &&
      startswith(aws_iam_role.db_bootstrap_execution.name, "pensieve-db-bootstrap")
    )
    error_message = "Role names must match what the deploy roles may pass (infra/bootstrap/names.tf); the bootstrap family's must not."
  }

  assert {
    condition = alltrue([for r in [aws_iam_role.app_task, aws_iam_role.app_execution, aws_iam_role.migrate_task, aws_iam_role.migrate_execution, aws_iam_role.db_bootstrap_execution] :
      [for s in jsondecode(r.assume_role_policy).Statement : s.Principal] == [{ Service = "ecs-tasks.amazonaws.com" }]
    ])
    error_message = "Only ECS tasks can assume the task and execution roles."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.app_task.policy).Statement == [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = "arn:aws:rds-db:eu-north-1:123456789012:dbuser:db-MOCKRESOURCEID/pensieve_app"
    }]
    error_message = "The app task role may only rds-db:connect, and only as pensieve_app."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.migrate_task.policy).Statement == [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = "arn:aws:rds-db:eu-north-1:123456789012:dbuser:db-MOCKRESOURCEID/pensieve_migrator"
    }]
    error_message = "The migrate task role may only rds-db:connect, and only as pensieve_migrator."
  }

  assert {
    # The one principal that reads the master secret: ECS injects `secrets`
    # with the execution role's credentials, so that's the role that needs
    # it. No task role (the bootstrap container needs no AWS access).
    condition = (
      [for p in [aws_iam_role_policy.app_task, aws_iam_role_policy.app_execution, aws_iam_role_policy.migrate_task, aws_iam_role_policy.migrate_execution, aws_iam_role_policy.db_bootstrap_execution] : p.role
        if strcontains(p.policy, aws_db_instance.main.master_user_secret[0].secret_arn)
      ] == [aws_iam_role.db_bootstrap_execution.id] &&
      aws_ecs_task_definition.db_bootstrap.task_role_arn == null
    )
    error_message = "Only the db-bootstrap family's role can read the RDS master secret."
  }

  assert {
    condition = (
      [for s in jsondecode(aws_iam_role_policy.app_execution.policy).Statement : s.Resource if s.Action == "secretsmanager:GetSecretValue"] == [aws_secretsmanager_secret.tunnel_token.arn] &&
      length([for s in jsondecode(aws_iam_role_policy.migrate_execution.policy).Statement : s if s.Action == "secretsmanager:GetSecretValue"]) == 0
    )
    error_message = "The app's execution role reads the tunnel token secret only; migrate's reads none."
  }

  assert {
    condition = alltrue([for pair in [
      { policy = aws_iam_role_policy.app_execution, repo = "pensieve", logs = ["/ecs/pensieve-app", "/ecs/pensieve-cloudflared"] },
      { policy = aws_iam_role_policy.migrate_execution, repo = "pensieve-db", logs = ["/ecs/pensieve-migrate"] },
      { policy = aws_iam_role_policy.db_bootstrap_execution, repo = "pensieve-db", logs = ["/ecs/pensieve-db-bootstrap"] },
      ] : (
      flatten([for s in jsondecode(pair.policy.policy).Statement : s.Resource if contains(flatten([s.Action]), "ecr:BatchGetImage")]) == [aws_ecr_repository.main[pair.repo].arn] &&
      toset(flatten([for s in jsondecode(pair.policy.policy).Statement : s.Resource if contains(flatten([s.Action]), "logs:PutLogEvents")])) == toset([for g in pair.logs : "${aws_cloudwatch_log_group.ecs[[for k, v in aws_cloudwatch_log_group.ecs : k if v.name == g][0]].arn}:*"])
    )])
    error_message = "Each execution role pulls only its own image's repository and writes only its own log groups."
  }
}
