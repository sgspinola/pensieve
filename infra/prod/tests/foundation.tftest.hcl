# Ticket 48: checks of the prod foundation against ticket 48's checklist and
# spec 11. The AWS provider is mocked, so the runs "apply" without
# credentials and create nothing (apply, not plan, so mock IDs are known and
# resources can be checked against each other). It can only see what the
# configuration sets, not what AWS would do with it. `terraform test` (from
# infra/prod, initialised with -backend=false) runs it locally and in CI's
# iac job.
mock_provider "aws" {
  source = "./tests/mocks/aws"
}

# Ticket 49: the configuration also holds the Cloudflare side now.
mock_provider "cloudflare" {
  source = "./tests/mocks/cloudflare"
}

variables {
  budget_email         = "budget@example.com"
  network_logs_enabled = true
}

run "network" {
  command = apply

  assert {
    condition     = length(distinct([for s in aws_subnet.private : s.availability_zone])) == 2
    error_message = "Private subnets must span two AZs (an RDS subnet group needs two)."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.private : !s.map_public_ip_on_launch])
    error_message = "Private subnets must not assign public IPs."
  }

  assert {
    condition     = aws_nat_gateway.egress.subnet_id == aws_subnet.public.id && aws_nat_gateway.egress.allocation_id == aws_eip.nat.id
    error_message = "One NAT Gateway, in the public subnet, with its own Elastic IP."
  }

  assert {
    condition     = aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway" && aws_vpc_endpoint.s3.service_name == "com.amazonaws.eu-north-1.s3"
    error_message = "S3 must be reached through a gateway endpoint, so image layer pulls skip the NAT."
  }

  assert {
    condition     = contains(aws_vpc_endpoint.s3.route_table_ids, aws_route_table.private.id)
    error_message = "The S3 endpoint must be on the private route table."
  }

  assert {
    condition     = one([for r in aws_route_table.private.route : r.nat_gateway_id if r.cidr_block == "0.0.0.0/0"]) == aws_nat_gateway.egress.id
    error_message = "The private subnets' default route must go through the NAT Gateway."
  }
}

run "security_groups" {
  command = apply

  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.rds_from_task.security_group_id == aws_security_group.rds.id &&
      aws_vpc_security_group_ingress_rule.rds_from_task.referenced_security_group_id == aws_security_group.task.id &&
      aws_vpc_security_group_ingress_rule.rds_from_task.cidr_ipv4 == null &&
      aws_vpc_security_group_ingress_rule.rds_from_task.ip_protocol == "tcp" &&
      aws_vpc_security_group_ingress_rule.rds_from_task.from_port == 5432 &&
      aws_vpc_security_group_ingress_rule.rds_from_task.to_port == 5432
    )
    error_message = "RDS must accept Postgres (TCP 5432) from the task security group and nothing else."
  }

  assert {
    condition     = length(aws_security_group.task.ingress) == 0 && length(aws_security_group.rds.ingress) == 0
    error_message = "No inline ingress rules: the task accepts no inbound traffic, and RDS only its one rule."
  }
}

run "database" {
  command = apply

  assert {
    condition = (
      aws_db_instance.main.identifier == "pensieve" &&
      aws_db_instance.main.engine == "postgres" &&
      startswith(aws_db_instance.main.engine_version, "17") &&
      aws_db_instance.main.instance_class == "db.t4g.micro" &&
      aws_db_instance.main.multi_az == false
    )
    error_message = "RDS must be PostgreSQL 17 on a single-AZ db.t4g.micro named pensieve."
  }

  assert {
    condition = (
      aws_db_instance.main.storage_type == "gp3" &&
      aws_db_instance.main.allocated_storage == 20 &&
      aws_db_instance.main.max_allocated_storage == 50 &&
      aws_db_instance.main.storage_encrypted == true
    )
    error_message = "Storage must be 20 GB gp3, autoscaling to 50 GB, and encrypted."
  }

  assert {
    condition = (
      aws_db_instance.main.manage_master_user_password == true &&
      aws_db_instance.main.password == null &&
      aws_db_instance.main.password_wo == null
    )
    error_message = "The master password must be RDS-managed, never in state."
  }

  assert {
    condition     = aws_db_instance.main.iam_database_authentication_enabled == true
    error_message = "IAM database authentication must be on."
  }

  assert {
    condition = (
      aws_db_instance.main.backup_retention_period == 35 &&
      aws_db_instance.main.deletion_protection == true &&
      aws_db_instance.main.skip_final_snapshot == false &&
      aws_db_instance.main.final_snapshot_identifier != null &&
      aws_db_instance.main.delete_automated_backups == false
    )
    error_message = "35-day PITR, deletion protection, a final snapshot and retained automated backups."
  }

  assert {
    # A night window around 03:00 UTC.
    condition     = startswith(aws_db_instance.main.backup_window, "02:") || startswith(aws_db_instance.main.backup_window, "03:")
    error_message = "The backup window must be around 03:00 UTC."
  }

  assert {
    condition = (
      aws_db_instance.main.publicly_accessible == false &&
      aws_db_instance.main.vpc_security_group_ids == toset([aws_security_group.rds.id]) &&
      toset(aws_db_subnet_group.main.subnet_ids) == toset([for s in aws_subnet.private : s.id]) &&
      aws_db_instance.main.db_subnet_group_name == aws_db_subnet_group.main.name &&
      aws_db_instance.main.availability_zone == aws_subnet.private["eu-north-1a"].availability_zone
    )
    error_message = "RDS must be private: no public access, the RDS security group only, the private subnets, the task's AZ."
  }
}

run "registry" {
  command = apply

  assert {
    condition     = toset(keys(aws_ecr_repository.main)) == toset(["pensieve", "pensieve-db"]) && alltrue([for k, r in aws_ecr_repository.main : r.name == k])
    error_message = "Two repositories: pensieve (app) and pensieve-db (DB image)."
  }

  assert {
    # Spec 12: every tag is immutable except the moving `main`.
    condition = alltrue([for r in aws_ecr_repository.main : (
      r.image_tag_mutability == "IMMUTABLE_WITH_EXCLUSION" &&
      length(r.image_tag_mutability_exclusion_filter) == 1 &&
      r.image_tag_mutability_exclusion_filter[0].filter == "main" &&
      r.image_tag_mutability_exclusion_filter[0].filter_type == "WILDCARD"
    )])
    error_message = "Tags must be immutable, excluding only the moving main tag."
  }

  assert {
    condition = alltrue([for k, p in aws_ecr_lifecycle_policy.main :
      p.repository == aws_ecr_repository.main[k].name && jsondecode(p.policy) == {
        rules = [
          {
            rulePriority = 1
            description  = "Keep the last 50 sha-* images"
            selection = {
              tagStatus      = "tagged"
              tagPatternList = ["sha-*"]
              countType      = "imageCountMoreThan"
              countNumber    = 50
            }
            action = { type = "expire" }
          },
          {
            rulePriority = 2
            description  = "Expire untagged images after a day"
            selection = {
              tagStatus   = "untagged"
              countType   = "sinceImagePushed"
              countUnit   = "days"
              countNumber = 1
            }
            action = { type = "expire" }
          },
        ]
      }
    ]) && length(aws_ecr_lifecycle_policy.main) == 2
    error_message = "Each repository keeps the last 50 sha-* images and expires untagged ones after a day, with no archive tier."
  }
}

run "log_groups" {
  command = apply

  assert {
    condition = toset([for g in aws_cloudwatch_log_group.ecs : g.name]) == toset([
      "/ecs/pensieve-app",
      "/ecs/pensieve-cloudflared",
      # The deploy-db role reads this one by name (infra/bootstrap/names.tf).
      "/ecs/pensieve-migrate",
      "/ecs/pensieve-db-bootstrap",
    ])
    error_message = "Log groups for the app, cloudflared, migrate and db-bootstrap."
  }

  assert {
    condition     = alltrue([for g in aws_cloudwatch_log_group.ecs : g.retention_in_days == 30])
    error_message = "Every log group keeps 30 days."
  }
}

run "budget" {
  command = apply

  assert {
    condition = (
      aws_budgets_budget.monthly.budget_type == "COST" &&
      aws_budgets_budget.monthly.time_unit == "MONTHLY"
    )
    error_message = "One monthly cost budget."
  }

  assert {
    condition = toset([for n in aws_budgets_budget.monthly.notification : {
      type        = n.notification_type
      threshold   = n.threshold
      unit        = n.threshold_type
      comparison  = n.comparison_operator
      subscribers = n.subscriber_email_addresses
      }]) == toset([
      { type = "ACTUAL", threshold = 10, unit = "ABSOLUTE_VALUE", comparison = "GREATER_THAN", subscribers = toset(["budget@example.com"]) },
      { type = "FORECASTED", threshold = 20, unit = "ABSOLUTE_VALUE", comparison = "GREATER_THAN", subscribers = toset(["budget@example.com"]) },
    ])
    error_message = "Alerts to the maintainer at $10 actual and $20 forecast."
  }
}
