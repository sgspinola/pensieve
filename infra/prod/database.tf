# Ticket 48 (spec 11, "Database"), with ticket 60's logging. The database roles, grants and bootstrap
# are spec 13's (db/bootstrap.sql); the ECS tasks that use them are ticket
# 49's.
resource "aws_db_subnet_group" "main" {
  name        = "pensieve"
  description = "Pensieve private subnets"
  subnet_ids  = [for s in aws_subnet.private : s.id]
}

# Ticket 60: who connected as which role, and every role, grant and schema
# change, for investigating after an incident. pgaudit's `role` and `ddl`
# classes only: `read` and `write` would log statements on user data (note
# contents), and so would `log_statement`, left at its default (none).
# shared_preload_libraries is static, so it applies at the next reboot
# (README, "Applying it"); the rest apply at once. The library list is RDS's
# postgres17 default plus pgaudit.
resource "aws_db_parameter_group" "main" {
  name        = "pensieve-postgres17"
  family      = "postgres17"
  description = "Pensieve: connection logging and pgaudit (role, ddl)"

  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements,pg_tle,pgaudit"
    apply_method = "pending-reboot"
  }
  parameter {
    name  = "pgaudit.log"
    value = "role,ddl"
  }

  # A changed family or name replaces the group; the instance must switch
  # to the new one before the old can go.
  lifecycle {
    create_before_destroy = true
  }
}

# Ticket 60: the exported logs' groups, created here with 30 days'
# retention, like the ECS groups (observability.tf), so RDS doesn't create
# them with none. `upgrade` isn't exported.
locals {
  rds_log_exports = ["postgresql", "iam-db-auth-error"]
}

resource "aws_cloudwatch_log_group" "rds" {
  for_each = toset(local.rds_log_exports)

  name              = "/aws/rds/instance/${local.rds_instance}/${each.key}"
  retention_in_days = 30
}

resource "aws_db_instance" "main" {
  identifier     = local.rds_instance
  engine         = "postgres"
  engine_version = "17"
  # Minor versions upgrade in the maintenance window; `engine_version` is
  # the major only, so that isn't drift.
  auto_minor_version_upgrade = true
  instance_class             = "db.t4g.micro"
  db_name                    = "pensieve"

  # Ticket 60: connection logging and pgaudit, and the server log
  # (connections, pgaudit's lines) and failed IAM logins in CloudWatch.
  parameter_group_name            = aws_db_parameter_group.main.name
  enabled_cloudwatch_logs_exports = local.rds_log_exports

  # Single-AZ, in the task's AZ (spec 11, user story 23).
  multi_az               = false
  availability_zone      = local.azs[0]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  storage_type          = "gp3"
  allocated_storage     = 20
  max_allocated_storage = 50
  # With the AWS-managed RDS key (no kms_key_id); backups and snapshots
  # inherit it.
  storage_encrypted = true

  # RDS generates the master password, keeps it in a Secrets Manager secret
  # and rotates it, so it never enters state. Only the db-bootstrap task
  # reads it (ticket 49); the app and migrator log in with IAM tokens.
  username                            = "pensieve_master"
  manage_master_user_password         = true
  iam_database_authentication_enabled = true

  # 35 days of point-in-time recovery. The backup window is UTC; the
  # maintenance window follows it without overlapping.
  backup_retention_period = 35
  backup_window           = "02:30-03:30"
  maintenance_window      = "sun:03:45-sun:04:15"
  copy_tags_to_snapshot   = true

  # No single mistake, `terraform destroy` included, loses the data.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "pensieve-final"
  delete_automated_backups  = false

  depends_on = [aws_cloudwatch_log_group.rds]
}
