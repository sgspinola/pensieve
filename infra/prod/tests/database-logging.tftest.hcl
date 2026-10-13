# Ticket 60: the RDS parameter group and log exports, against the ticket's
# checklist. Mocked providers, as in foundation.tftest.hcl.
mock_provider "aws" {
  source = "./tests/mocks/aws"
}

mock_provider "cloudflare" {
  source = "./tests/mocks/cloudflare"
}

variables {
  budget_email = "budget@example.com"
}

run "parameter_group" {
  command = apply

  assert {
    condition     = aws_db_instance.main.parameter_group_name == aws_db_parameter_group.main.name && aws_db_parameter_group.main.family == "postgres17"
    error_message = "The instance must use the postgres17 parameter group defined here."
  }

  assert {
    condition = (
      one([for p in aws_db_parameter_group.main.parameter : p.value if p.name == "log_connections"]) == "1" &&
      one([for p in aws_db_parameter_group.main.parameter : p.value if p.name == "log_disconnections"]) == "1"
    )
    error_message = "Connections and disconnections must be logged."
  }

  assert {
    condition     = contains(split(",", one([for p in aws_db_parameter_group.main.parameter : p.value if p.name == "shared_preload_libraries"])), "pgaudit")
    error_message = "pgaudit must be in shared_preload_libraries."
  }

  assert {
    condition     = one([for p in aws_db_parameter_group.main.parameter : p.value if p.name == "pgaudit.log"]) == "role,ddl"
    error_message = "pgaudit must log the role and ddl classes only: read and write would log user data."
  }

  assert {
    condition     = length([for p in aws_db_parameter_group.main.parameter : p if p.name == "log_statement"]) == 0
    error_message = "log_statement must stay at its default (none): it would log user data."
  }
}

run "log_exports" {
  command = apply

  assert {
    condition     = toset(aws_db_instance.main.enabled_cloudwatch_logs_exports) == toset(["postgresql", "iam-db-auth-error"])
    error_message = "Export the postgresql and iam-db-auth-error logs, not upgrade."
  }

  assert {
    condition     = toset(aws_db_instance.main.enabled_cloudwatch_logs_exports) == toset(local.rds_log_exports)
    error_message = "The instance's exports and local.rds_log_exports (which the log groups are made from) must match."
  }

  assert {
    condition = (
      toset([for g in aws_cloudwatch_log_group.rds : g.name]) == toset(["/aws/rds/instance/pensieve/postgresql", "/aws/rds/instance/pensieve/iam-db-auth-error"]) &&
      alltrue([for g in aws_cloudwatch_log_group.rds : g.retention_in_days == 30])
    )
    error_message = "Terraform must create each exported log's group, with 30 days' retention."
  }
}
