# Ticket 59: the VPC flow log and Resolver query logging, against the
# ticket's checklist. Mocked providers, as in foundation.tftest.hcl.
mock_provider "aws" {
  source = "./tests/mocks/aws"
}

mock_provider "cloudflare" {
  source = "./tests/mocks/cloudflare"
}

variables {
  budget_email = "budget@example.com"
}

run "flow_log" {
  command = apply

  assert {
    condition     = aws_flow_log.vpc.vpc_id == aws_vpc.main.id && aws_flow_log.vpc.eni_id == null && aws_flow_log.vpc.subnet_id == null
    error_message = "The flow log must be on the VPC, not an ENI or subnet, so the task, RDS and the NAT are all covered."
  }

  assert {
    condition     = aws_flow_log.vpc.traffic_type == "ALL"
    error_message = "The flow log must capture ALL traffic: exfiltration is accepted traffic."
  }

  assert {
    condition     = alltrue([for f in ["pkt-srcaddr", "pkt-dstaddr", "flow-direction", "traffic-path"] : strcontains(aws_flow_log.vpc.log_format, "$${${f}}")])
    error_message = "The format must add pkt-srcaddr, pkt-dstaddr, flow-direction and traffic-path, to see through the NAT."
  }

  assert {
    condition = (
      aws_flow_log.vpc.log_destination_type == "s3" &&
      aws_flow_log.vpc.log_destination == "arn:aws:s3:::pensieve-logs-123456789012/vpc-flow/"
    )
    error_message = "Flow logs must deliver to the log bucket's vpc-flow/ prefix."
  }

  assert {
    condition = (
      aws_flow_log.vpc.destination_options[0].file_format == "parquet" &&
      aws_flow_log.vpc.destination_options[0].hive_compatible_partitions &&
      aws_flow_log.vpc.destination_options[0].per_hour_partition &&
      aws_flow_log.vpc.max_aggregation_interval == 600
    )
    error_message = "Parquet, Hive-style hourly partitions, 10-minute aggregation."
  }
}

run "resolver_query_log" {
  command = apply

  assert {
    condition     = aws_route53_resolver_query_log_config.vpc.destination_arn == "arn:aws:s3:::pensieve-logs-123456789012/resolver"
    error_message = "Resolver query logs must deliver to the log bucket's resolver/ prefix."
  }

  assert {
    condition = (
      aws_route53_resolver_query_log_config_association.vpc.resource_id == aws_vpc.main.id &&
      aws_route53_resolver_query_log_config_association.vpc.resolver_query_log_config_id == aws_route53_resolver_query_log_config.vpc.id
    )
    error_message = "The query log config must be associated with the prod VPC."
  }
}
