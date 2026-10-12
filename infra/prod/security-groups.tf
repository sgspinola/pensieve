# Ticket 48 (spec 11, "Security groups"). Rules are separate resources, so
# each is visible on its own in a plan. The task accepts no inbound traffic at
# all (the tunnel dials out, ticket 49); RDS accepts Postgres from the task
# only.
resource "aws_security_group" "task" {
  name        = "pensieve-task"
  description = "Pensieve ECS tasks: no inbound, any outbound"
  vpc_id      = aws_vpc.main.id
}

# Outbound to anywhere: ECR, CloudWatch Logs, Secrets Manager and Cloudflare
# (whose tunnel edge addresses aren't a fixed list), all through the NAT, and
# Postgres in the VPC.
resource "aws_vpc_security_group_egress_rule" "task_all" {
  security_group_id = aws_security_group.task.id
  description       = "Any outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "rds" {
  name        = "pensieve-rds"
  description = "Pensieve RDS: Postgres from the ECS tasks only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_task" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres from the ECS tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.task.id
}
