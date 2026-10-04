# What the prod backend and the GitHub workflows need (as repository or
# Environment variables; none of these is a secret).
output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "state_kms_key_arn" {
  value = aws_kms_key.state.arn
}

output "role_arns" {
  value = {
    ecr_push   = aws_iam_role.ecr_push.arn
    plan       = aws_iam_role.plan.arn
    deploy_app = aws_iam_role.deploy_app.arn
    deploy_db  = aws_iam_role.deploy_db.arn
  }
}
