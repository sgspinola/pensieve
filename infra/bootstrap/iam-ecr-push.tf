# Publishes the app and DB images (tickets 50 and 51) from pushes to `main`.
# Push only: no pull-through to other repositories, no repository admin.
resource "aws_iam_role" "ecr_push" {
  name               = "pensieve-github-ecr-push"
  assume_role_policy = data.aws_iam_policy_document.github_trust["ecr_push"].json
}

data "aws_iam_policy_document" "ecr_push" {
  statement {
    sid       = "Login"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # account-level; can't be scoped to a repository
  }

  statement {
    sid = "PushToOwnRepositories"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      # Reading back what it pushed: cosign signs by digest and attaches its
      # signature and SBOM as referrers of that image.
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
    ]
    resources = local.ecr_repository_arns
  }
}

resource "aws_iam_role_policy" "ecr_push" {
  name   = "ecr-push"
  role   = aws_iam_role.ecr_push.id
  policy = data.aws_iam_policy_document.ecr_push.json
}
