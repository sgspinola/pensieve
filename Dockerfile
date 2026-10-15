# syntax=docker/dockerfile:1

# Ticket 29: production image. Built for linux/arm64 only (the Graviton
# runtime): `docker build --platform linux/arm64 -t pensieve .`
# Both bases are pinned by multi-arch index digest; Dependabot's docker
# ecosystem (ticket 33) keeps the digests current.

# --- builder: full Node toolchain, never shipped ------------------------------
FROM node:25-trixie-slim@sha256:aabbe39553d15ede8a97cc60c9e1a97034ff772afcf696ea42b94e7f5f2ec71b AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# package.json's engines pins npm exactly; the base image's bundled npm drifts.
RUN npm install --global npm@11.16.0

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The standalone server, plus the healthcheck entrypoint bundled into a
# self-contained file (it's not imported by the server, so standalone tracing
# wouldn't include it). The migrator lives in the DB image (db/Dockerfile).
RUN npm run build \
 && npm run build:ops \
 && mkdir -p .next/standalone/.next/cache

# --- runtime: distroless Node, no shell or package manager, non-root ---------
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Application files stay root-owned (read-only to the app user); only Next's
# runtime cache directory is writable. No public/ dir exists to copy.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder --chown=65532:65532 /app/.next/standalone/.next/cache ./.next/cache
# Ticket 41: no migration SQL or migrator, only the journal of migration
# tags this build expects (spec 13's startup check).
COPY --from=builder /app/drizzle/meta/_journal.json ./drizzle/meta/
COPY --from=builder /app/dist/ops/healthcheck.cjs ./
# Ticket 40: RDS's public CA bundle (truststore.pki.rds.amazonaws.com, global),
# which src/db/connection.ts verifies the database's TLS certificate against
# in IAM-auth mode.
COPY --from=builder /app/certs/rds-global-bundle.pem ./certs/

# distroless's `nonroot` user, by number so runtimes can verify it isn't root.
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/nodejs/bin/node", "healthcheck.cjs"]

# The distroless entrypoint is `node`, so this runs the server.
CMD ["server.js"]
