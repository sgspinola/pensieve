# Ticket 49: checks of the Cloudflare Tunnel ingress against ticket 49's
# checklist and spec 11 ("Ingress"). Mocked providers, as in
# foundation.tftest.hcl.
mock_provider "aws" {
  source = "./tests/mocks/aws"
}

mock_provider "cloudflare" {
  source = "./tests/mocks/cloudflare"
}

variables {
  budget_email = "budget@example.com"
}

run "tunnel" {
  command = apply

  assert {
    condition     = data.cloudflare_zone.main.filter.name == "pensieve.fyi"
    error_message = "Everything lives in the pensieve.fyi zone."
  }

  assert {
    condition = (
      cloudflare_zero_trust_tunnel_cloudflared.main.account_id == data.cloudflare_zone.main.account.id &&
      cloudflare_zero_trust_tunnel_cloudflared.main.config_src == "cloudflare"
    )
    error_message = "One remotely managed tunnel in the zone's account."
  }

  assert {
    condition = (
      cloudflare_zero_trust_tunnel_cloudflared_config.main.tunnel_id == cloudflare_zero_trust_tunnel_cloudflared.main.id &&
      length(cloudflare_zero_trust_tunnel_cloudflared_config.main.config.ingress) == 2 &&
      cloudflare_zero_trust_tunnel_cloudflared_config.main.config.ingress[0].hostname == "pensieve.fyi" &&
      cloudflare_zero_trust_tunnel_cloudflared_config.main.config.ingress[0].service == "http://localhost:3000" &&
      cloudflare_zero_trust_tunnel_cloudflared_config.main.config.ingress[1].hostname == null &&
      cloudflare_zero_trust_tunnel_cloudflared_config.main.config.ingress[1].service == "http_status:404"
    )
    error_message = "The tunnel sends pensieve.fyi to the app over the task's local network, and 404s anything else."
  }

  assert {
    condition = (
      cloudflare_dns_record.apex.zone_id == data.cloudflare_zone.main.id &&
      cloudflare_dns_record.apex.name == "pensieve.fyi" &&
      cloudflare_dns_record.apex.type == "CNAME" &&
      cloudflare_dns_record.apex.content == "${cloudflare_zero_trust_tunnel_cloudflared.main.id}.cfargotunnel.com" &&
      cloudflare_dns_record.apex.proxied == true
    )
    error_message = "The apex is a proxied CNAME to the tunnel."
  }

  assert {
    condition = (
      cloudflare_zone_setting.ssl.zone_id == data.cloudflare_zone.main.id &&
      cloudflare_zone_setting.ssl.setting_id == "ssl" &&
      cloudflare_zone_setting.ssl.value == "strict"
    )
    error_message = "SSL mode is Full (strict)."
  }
}

run "tunnel_token" {
  command = apply

  assert {
    # Read-only plans can't call Cloudflare's "get tunnel token" endpoint (it
    # needs Tunnel Write), so the token is built from a secret Terraform
    # generates, in cloudflared's token format.
    condition = (
      length(random_bytes.tunnel_secret.base64) > 0 &&
      cloudflare_zero_trust_tunnel_cloudflared.main.tunnel_secret == random_bytes.tunnel_secret.base64 &&
      jsondecode(base64decode(nonsensitive(aws_secretsmanager_secret_version.tunnel_token.secret_string))) == {
        a = data.cloudflare_zone.main.account.id
        t = cloudflare_zero_trust_tunnel_cloudflared.main.id
        s = nonsensitive(random_bytes.tunnel_secret.base64)
      }
    )
    error_message = "The token carries the account, the tunnel and the generated tunnel secret."
  }

  assert {
    condition = (
      issensitive(random_bytes.tunnel_secret.base64) &&
      issensitive(cloudflare_zero_trust_tunnel_cloudflared.main.tunnel_secret) &&
      issensitive(aws_secretsmanager_secret_version.tunnel_token.secret_string)
    )
    error_message = "Every value carrying the tunnel secret or token is sensitive."
  }

  assert {
    condition = (
      aws_secretsmanager_secret.tunnel_token.name == "pensieve/cloudflared-tunnel-token" &&
      aws_secretsmanager_secret_version.tunnel_token.secret_id == aws_secretsmanager_secret.tunnel_token.id
    )
    error_message = "The token reaches Secrets Manager under the name the plan role may read (infra/bootstrap/names.tf)."
  }
}
