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

output "log_bucket" {
  description = "Log bucket name, for prod's VPC flow log and Resolver query log destinations (ticket 59)."
  value       = aws_s3_bucket.logs.bucket
}

output "athena_workgroup" {
  description = "Athena workgroup to query the logs in (database pensieve_logs)."
  value       = aws_athena_workgroup.logs.name
}
