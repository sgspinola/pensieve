variable "admin_permission_set_name" {
  description = "IAM Identity Center permission set the maintainer applies Terraform with. Its role is one of the two principals the state bucket policy lets in, so a wrong name locks everyone but the account root out of the state."
  type        = string
  default     = "AdministratorAccess"
}
