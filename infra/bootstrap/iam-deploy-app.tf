# The `deploy-app` workflow (ticket 52), from the approval-gated `prod-app`
# Environment on `main`: point the service at a new app task-definition
# revision. It can't touch the database, the migrate or bootstrap tasks, or
# any role but the app's own.
resource "aws_iam_role" "deploy_app" {
  name               = "pensieve-github-deploy-app"
  assume_role_policy = data.aws_iam_policy_document.github_trust["deploy_app"].json
}

data "aws_iam_policy_document" "deploy_app" {
  statement {
    sid       = "Login"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # account-level; can't be scoped to a repository
  }

  statement {
    sid = "PullAppImage"
    actions = [
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
    resources = [local.ecr_repository_arn["pensieve"]]
  }

  statement {
    sid       = "RegisterAppTaskDefinition"
    actions   = ["ecs:RegisterTaskDefinition"]
    resources = [local.task_definition_arn.app]
  }

  statement {
    sid       = "ReadTaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = ["*"] # supports no resource-level scoping
  }

  statement {
    sid       = "DescribeService"
    actions   = ["ecs:DescribeServices"]
    resources = [local.ecs_service_arn]
  }

  # Only with a task definition in the app family: a call that changes
  # nothing but the desired count is denied, so every deploy (including the
  # first, from desired count 0) passes the task definition it rolls out.
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
    sid       = "PassAppRoles"
    actions   = ["iam:PassRole"]
    resources = [for r in local.app_task_roles : local.role_arns[r]]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "deploy_app" {
  name   = "deploy-app"
  role   = aws_iam_role.deploy_app.id
  policy = data.aws_iam_policy_document.deploy_app.json
}
