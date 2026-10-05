# What the prod backend and the GitHub workflows need (as repository or
# Environment variables; none of these is a secret).
output "state_bucket" {
  description = "State bucket name, for the prod config's backend block."
  value       = aws_s3_bucket.state.bucket
}

output "role_arns" {
  description = "CI role ARNs, each for the GitHub variable its workflow reads."
  value = {
    ecr_push   = aws_iam_role.ecr_push.arn
    plan       = aws_iam_role.plan.arn
    deploy_app = aws_iam_role.deploy_app.arn
    deploy_db  = aws_iam_role.deploy_db.arn
  }
}
