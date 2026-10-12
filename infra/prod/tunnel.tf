# Ticket 49 (spec 11, "Ingress"). The only way in: the app task's
# `cloudflared` sidecar dials out to Cloudflare, which sends pensieve.fyi to
# it. No load balancer, no inbound port, no Origin CA certificate.
data "cloudflare_zone" "main" {
  filter = {
    name = local.domain
  }
}

# The tunnel's secret, generated here rather than by Cloudflare: reading a
# Cloudflare-generated one back (the "get tunnel token" endpoint) needs
# Tunnel Write, which CI's read-only plan token doesn't have. Sensitive, like
# every value below that carries it.
resource "random_bytes" "tunnel_secret" {
  length = 32
}

# Remotely managed (`config_src = "cloudflare"`): the ingress rules below
# live at Cloudflare, so the sidecar needs only the token.
resource "cloudflare_zero_trust_tunnel_cloudflared" "main" {
  account_id    = data.cloudflare_zone.main.account.id
  name          = "pensieve"
  config_src    = "cloudflare"
  tunnel_secret = random_bytes.tunnel_secret.base64
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "main" {
  account_id = data.cloudflare_zone.main.account.id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.main.id

  config = {
    ingress = [
      # The containers of an awsvpc task share one network namespace.
      {
        hostname = local.domain
        service  = "http://localhost:3000"
      },
      # cloudflared requires a final catch-all rule.
      {
        service = "http_status:404"
      },
    ]
  }
}

# The apex, not a subdomain: the WebAuthn RP ID is pensieve.fyi either way,
# and passkeys bind to it permanently (spec 11, user story 15).
resource "cloudflare_dns_record" "apex" {
  zone_id = data.cloudflare_zone.main.id
  name    = local.domain
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.main.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # "automatic", the only TTL a proxied record has
}

# Full (strict): Cloudflare only ever talks to an origin it can verify. The
# tunnel is the origin path anyway, but the setting is zone-wide.
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = data.cloudflare_zone.main.id
  setting_id = "ssl"
  value      = "strict"
}

# Encrypted with the AWS-managed Secrets Manager key, which the app's
# execution role can use without a key grant.
resource "aws_secretsmanager_secret" "tunnel_token" {
  name        = local.tunnel_token_secret
  description = "Cloudflare Tunnel token for the cloudflared sidecar (written by Terraform)"
}

# The token the sidecar runs the tunnel with: cloudflared's token format,
# base64 of the account, tunnel ID and tunnel secret. Sensitive (it's built
# from the sensitive secret, and the attribute is sensitive anyway), so it
# never appears in plan output. It's in state (KMS-encrypted, readable by the
# admin and plan roles only) and here, from where ECS injects it into the
# sidecar (compute.tf). Nothing outputs it.
resource "aws_secretsmanager_secret_version" "tunnel_token" {
  secret_id = aws_secretsmanager_secret.tunnel_token.id
  secret_string = base64encode(jsonencode({
    a = data.cloudflare_zone.main.account.id
    t = cloudflare_zero_trust_tunnel_cloudflared.main.id
    s = random_bytes.tunnel_secret.base64
  }))
}
