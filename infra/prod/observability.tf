# Ticket 48 (spec 11, "Observability and cost"). The containers write JSON
# lines to stdout and the awslogs driver ships them here (ticket 49 wires the
# task definitions to these groups). 30 days is enough to investigate recent
# problems without paying to keep logs forever.
resource "aws_cloudwatch_log_group" "ecs" {
  for_each = local.log_groups

  name              = each.value
  retention_in_days = 30
}

# Both alerts are expected to fire every month (the baseline is about $62):
# a regular "something is running and costing money" signal, not an overrun
# alarm. No CloudWatch alarms (spec 11, out of scope). Subscription charges
# are left out so the maintainer's AWS Skill Builder subscription, billed to
# this account, doesn't count as the app's spend.
resource "aws_budgets_budget" "monthly" {
  name         = "pensieve-monthly"
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = "20"
  limit_unit   = "USD"

  cost_types {
    include_subscription = false
  }

  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 10
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    notification_type          = "FORECASTED"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 20
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = [var.budget_email]
  }
}
