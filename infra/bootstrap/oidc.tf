# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# GitHub Actions' OIDC identity provider. CI holds no AWS keys: each workflow
# job exchanges its short-lived GitHub token for one of the roles below, and
# each role's trust policy decides which jobs may (iam-*.tf).
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.github_oidc}"
  client_id_list = ["sts.amazonaws.com"]
  # No thumbprint_list: AWS verifies GitHub's certificate against its own
  # trusted CA library for this provider.
}

locals {
  github_oidc = "token.actions.githubusercontent.com"
}

# Trust for one GitHub context. `sub` is always matched exactly (AWS requires
# a sub condition). `ref`, a claim STS has accepted as a condition key since
# January 2026, additionally pins jobs that run in an Environment to a branch:
# an Environment job's `sub` names only the Environment, not the ref.
data "aws_iam_policy_document" "github_trust" {
  for_each = {
    ecr_push   = { sub = "repo:${local.github_repo}:ref:refs/heads/main", ref = null }
    plan       = { sub = "repo:${local.github_repo}:environment:plan", ref = null }
    deploy_app = { sub = "repo:${local.github_repo}:environment:prod-app", ref = "refs/heads/main" }
    deploy_db  = { sub = "repo:${local.github_repo}:environment:prod-db", ref = "refs/heads/main" }
  }

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc}:sub"
      values   = [each.value.sub]
    }
    dynamic "condition" {
      for_each = each.value.ref == null ? [] : [each.value.ref]
      content {
        test     = "StringEquals"
        variable = "${local.github_oidc}:ref"
        values   = [condition.value]
      }
    }
  }
}
