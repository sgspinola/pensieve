variable "admin_user_name" {
  description = "IAM user the maintainer applies Terraform with (signed in via `aws login`). It is one of the two principals the state bucket policy lets in, so a wrong name locks everyone but the account root out of the state."
  type        = string
  default     = "pensieve-admin"
}
