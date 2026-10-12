variable "budget_email" {
  description = "Address the monthly budget's alerts go to. Not committed (this repository is public): locally from an uncommitted terraform.tfvars, in CI from the `plan` Environment's BUDGET_EMAIL secret."
  type        = string
  # Keeps the address out of plan output, which CI posts to a public run
  # summary.
  sensitive = true
}
