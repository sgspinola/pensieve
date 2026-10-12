# kics-scan disable=e592a0c5-5bdb-414c-9066-5dba7cdea370
# (KICS wants an Access Analyzer in every file; it's in access-analyzer.tf.)
# Ticket 58 (from a ScoutSuite run): the account's IAM password policy, for
# the console passwords `aws login` signs in with. It applies at each
# user's next password change; MFA on the users is the stronger control.
# kics-scan ignore-block (no expiry or complexity rules, on purpose: see below)
resource "aws_iam_account_password_policy" "account" {
  minimum_password_length        = 14
  password_reuse_prevention      = 24
  allow_users_to_change_password = true
  # No max_password_age: forced rotation weakens passwords (NIST SP 800-63B).
  # No complexity flags: length matters more, and a password manager
  # generates these anyway.
}
