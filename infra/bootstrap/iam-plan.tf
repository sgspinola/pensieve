# `terraform plan` on infrastructure PRs (ticket 47), from the `plan` GitHub
# Environment. Read-only everywhere, plus reading the prod state. It can't
# write the state lockfile, so CI plans with `-lock=false`.
# ReadOnlyAccess doesn't include reading secret values, but refreshing the
# tunnel token's secret version during a plan does; the token is in the
# state this role can already read, so that grant adds no exposure.
resource "aws_iam_role" "plan" {
  name               = "pensieve-github-plan"
  assume_role_policy = data.aws_iam_policy_document.github_trust["plan"].json
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  statement {
    sid       = "ListState"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    sid       = "ReadStateAndLockfile"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }

  statement {
    sid       = "RefreshTunnelTokenSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.tunnel_token_secret_arn]
  }

  statement {
    sid       = "DecryptState"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.state.arn]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "read-state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}
