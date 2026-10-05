# Account-wide IAM Access Analyzer (free for external access). It flags any
# resource reachable from outside the account, a backstop for the state
# bucket, the KMS key and the CI roles' trust policies defined here.
resource "aws_accessanalyzer_analyzer" "account" {
  analyzer_name = "pensieve"
  type          = "ACCOUNT"
}
