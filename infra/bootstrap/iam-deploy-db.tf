# The `deploy-db` workflow (ticket 54), from the approval-gated `prod-db`
# Environment on `main`: snapshot the database, run the migrate task, and
# optionally move the app to a matching revision. Deliberately absent: the
# bootstrap task family, its roles and the RDS master secret, and any RDS
# modify, restore or delete-instance permission.
resource "aws_iam_role" "deploy_db" {
  name               = "pensieve-github-deploy-db"
  assume_role_policy = data.aws_iam_policy_document.github_trust["deploy_db"].json
}

data "aws_iam_policy_document" "deploy_db" {
  statement {
    sid       = "Login"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # account-level; can't be scoped to a repository
  }

  statement {
    sid = "ReadBothRepositories" # cosign verify fetches signatures from each
    actions = [
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
    resources = local.ecr_repository_arns
  }

  statement {
    sid       = "RegisterAppAndMigrateTaskDefinitions"
    actions   = ["ecs:RegisterTaskDefinition"]
    resources = [local.task_definition_arn.app, local.task_definition_arn.migrate]
  }

  statement {
    sid       = "ReadTaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = ["*"] # supports no resource-level scoping
  }

  statement {
    sid       = "RunMigrateTaskOnly"
    actions   = ["ecs:RunTask"]
    resources = [local.task_definition_arn.migrate]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.ecs_cluster_arn]
    }
  }

  statement {
    sid       = "WatchTasks"
    actions   = ["ecs:DescribeTasks"]
    resources = ["arn:aws:ecs:${local.region}:${local.account_id}:task/${local.ecs_cluster}/*"]
  }

  statement {
    sid       = "DescribeService"
    actions   = ["ecs:DescribeServices"]
    resources = [local.ecs_service_arn]
  }

  statement {
    sid       = "UpdateServiceToAppRevision"
    actions   = ["ecs:UpdateService"]
    resources = [local.ecs_service_arn]
    condition {
      test     = "ArnLike"
      variable = "ecs:task-definition"
      values   = [local.task_definition_arn.app]
    }
  }

  statement {
    sid       = "PassAppAndMigrateRoles"
    actions   = ["iam:PassRole"]
    resources = [for r in concat(local.app_task_roles, local.migrate_task_roles) : local.role_arns[r]]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid = "PredeploySnapshot"
    # CreateDBSnapshot authorizes against both the instance and the new
    # snapshot's name; tagging happens on the snapshot as it's created.
    actions   = ["rds:CreateDBSnapshot", "rds:AddTagsToResource"]
    resources = [local.rds_instance_arn, local.predeploy_snapshots]
  }

  statement {
    sid       = "DescribeSnapshots"
    actions   = ["rds:DescribeDBSnapshots"]
    resources = [local.rds_instance_arn, "arn:aws:rds:${local.region}:${local.account_id}:snapshot:*"]
  }

  statement {
    sid       = "DeletePredeploySnapshotsOnly"
    actions   = ["rds:DeleteDBSnapshot"]
    resources = [local.predeploy_snapshots]
  }

  statement {
    sid = "ReadMigrateLogs"
    actions = [
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
    ]
    resources = [local.migrate_log_arn]
  }
}

resource "aws_iam_role_policy" "deploy_db" {
  name   = "deploy-db"
  role   = aws_iam_role.deploy_db.id
  policy = data.aws_iam_policy_document.deploy_db.json
}
