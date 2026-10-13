variable "budget_email" {
  description = "Address the monthly budget's alerts go to. Not committed (this repository is public): locally from an uncommitted terraform.tfvars, in CI from the `plan` Environment's BUDGET_EMAIL secret."
  type        = string
  # Keeps the address out of plan output, which CI posts to a public run
  # summary.
  sensitive = true
}

# Ticket 60: an off switch for the RDS log exports to CloudWatch, whose
# ingestion is billed by volume. No default, so a plan or apply must say
# which: the source of truth is the `plan` Environment's
# DB_LOG_EXPORTS_ENABLED variable, which CI's plan reads and a local apply
# exports first (README, "Logging switches"). Forgetting it fails instead of
# quietly turning the exports back on.
variable "db_log_exports_enabled" {
  description = "Whether prod's RDS instance exports its postgresql and iam-db-auth-error logs to CloudWatch. From the `plan` Environment's DB_LOG_EXPORTS_ENABLED variable."
  type        = bool
  nullable    = false
}
