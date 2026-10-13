/**
 * Ticket 61: who is on the other end of a request, for the per-request API
 * log line (src/lib/api-errors.ts), the auth events
 * (src/services/auth/auth-events.ts) and the proxy's session rejections
 * (src/proxy.ts). Side-effect free, like src/lib/request-id.ts, so the
 * Proxy and route handlers can both import it.
 *
 * `CF-Connecting-IP` is the client's address only because the Cloudflare
 * Tunnel is the only way in: the task has no public address and its
 * security group accepts no inbound traffic (infra/prod/network.tf,
 * security-groups.tf), so every request that reaches the app came through
 * Cloudflare, which sets the header itself. Behind anything else, a client
 * could send its own. Where the headers are absent (local development, CI's
 * e2e), the fields are omitted rather than faked.
 *
 * IP addresses are personal data: they're kept only as long as the logs
 * (spec 11's 30 days).
 */
export interface ClientFields {
  clientIp?: string;
  userAgent?: string;
  cfRay?: string;
}

const HEADERS: Record<keyof ClientFields, string> = {
  clientIp: "cf-connecting-ip",
  userAgent: "user-agent",
  cfRay: "cf-ray",
};

export function clientFields(headers: Headers): ClientFields {
  const fields: ClientFields = {};
  for (const [field, header] of Object.entries(HEADERS) as [keyof ClientFields, string][]) {
    const value = headers.get(header);
    if (value) {
      fields[field] = value;
    }
  }
  return fields;
}
