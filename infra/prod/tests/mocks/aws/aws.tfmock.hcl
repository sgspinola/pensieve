# Shared defaults for the mocked AWS provider (every tests/*.tftest.hcl).
# The mock fills computed attributes with random strings and leaves nested
# blocks empty, so the values the configuration indexes into or reads back
# are pinned here.
mock_resource "aws_db_instance" {
  defaults = {
    address     = "pensieve.mock.eu-north-1.rds.amazonaws.com"
    port        = 5432
    resource_id = "db-MOCKRESOURCEID"
    master_user_secret = [{
      secret_arn    = "arn:aws:secretsmanager:eu-north-1:123456789012:secret:rds!db-mock-AbCdEf"
      secret_status = "active"
      kms_key_id    = ""
    }]
  }
}

mock_data "aws_caller_identity" {
  defaults = {
    account_id = "123456789012"
  }
}

# ECS validates role ARNs, and the tests tell the roles apart by them.
override_resource {
  target = aws_iam_role.app_task
  values = { arn = "arn:aws:iam::123456789012:role/pensieve-app-task" }
}

override_resource {
  target = aws_iam_role.app_execution
  values = { arn = "arn:aws:iam::123456789012:role/pensieve-app-execution" }
}

override_resource {
  target = aws_iam_role.migrate_task
  values = { arn = "arn:aws:iam::123456789012:role/pensieve-migrate-task" }
}

override_resource {
  target = aws_iam_role.migrate_execution
  values = { arn = "arn:aws:iam::123456789012:role/pensieve-migrate-execution" }
}

override_resource {
  target = aws_iam_role.db_bootstrap_execution
  values = { arn = "arn:aws:iam::123456789012:role/pensieve-db-bootstrap-execution" }
}

override_resource {
  target = aws_iam_role.db_bootstrap_task
  values = { arn = "arn:aws:iam::123456789012:role/pensieve-db-bootstrap-task" }
}
