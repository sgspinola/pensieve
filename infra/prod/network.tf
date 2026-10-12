# Ticket 48 (spec 11, "Network"). The app task runs in a private subnet with
# no public address and reaches the internet (ECR, CloudWatch Logs, Secrets
# Manager, Cloudflare) through one NAT Gateway. Nothing reaches in: there's
# no load balancer, and the tunnel (ticket 49) dials out.
#
#   public-a   NAT Gateway only
#   private-a  the task and the RDS instance
#   private-b  unused, but an RDS subnet group must span two AZs
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "pensieve" }
}

# Locks down the VPC's default security group (no rules at all), so nothing
# that lands in it by accident can talk to anything.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "pensieve" }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[0]
  cidr_block        = "10.0.0.0/24"

  tags = { Name = "pensieve-public-a" }
}

resource "aws_subnet" "private" {
  for_each = { for i, az in local.azs : az => i }

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = "10.0.${10 + each.value}.0/24"
  # The default, spelled out: nothing in these subnets gets a public address.
  map_public_ip_on_launch = false

  tags = { Name = "pensieve-private-${substr(each.key, -1, 1)}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = { Name = "pensieve-nat" }
}

# One NAT Gateway, in one AZ: the task runs in that AZ too, so there's no
# cross-AZ traffic, and no redundancy to pay for (spec 11, user story 23).
resource "aws_nat_gateway" "egress" {
  subnet_id     = aws_subnet.public.id
  allocation_id = aws_eip.nat.id

  tags = { Name = "pensieve" }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "pensieve-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.egress.id
  }

  tags = { Name = "pensieve-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# Free, and ECR serves image layers from S3, so pulls don't pay NAT data
# processing (spec 11, user story 19).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "pensieve-s3" }
}
