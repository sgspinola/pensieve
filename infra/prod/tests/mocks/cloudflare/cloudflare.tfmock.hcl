# Shared defaults for the mocked Cloudflare provider.
mock_data "cloudflare_zone" {
  defaults = {
    id      = "mock-zone-id"
    account = { id = "mock-account-id", name = "mock" }
  }
}

mock_resource "cloudflare_zero_trust_tunnel_cloudflared" {
  defaults = {
    id = "11111111-2222-3333-4444-555555555555"
  }
}
