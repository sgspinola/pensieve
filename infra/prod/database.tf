# Ticket 48 (spec 11, "Database"). The database roles, grants and bootstrap
# are spec 13's (db/bootstrap.sql); the ECS tasks that use them are ticket
# 49's.
resource "aws_db_subnet_group" "main" {
  name        = "pensieve"
  description = "Pensieve private subnets"
  subnet_ids  = [for s in aws_subnet.private : s.id]
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
}
