# syntax=docker/dockerfile:1

# Ticket 29: production image. Built for linux/arm64 only (the Graviton
# runtime): `docker build --platform linux/arm64 -t pensieve .`
# Both bases are pinned by multi-arch index digest; Dependabot's docker
# ecosystem (ticket 33) keeps the digests current.

# --- builder: full Node toolchain, never shipped ------------------------------
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# package.json's engines pins npm exactly; the base image's bundled npm drifts.
RUN npm install --global npm@11.16.0

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The standalone server, plus the migration and healthcheck entrypoints
# bundled into self-contained files: standalone tracing only follows what the
# server imports, so it would leave out drizzle's migrator.
RUN npm run build \
 && npm run build:ops \
 && mkdir -p .next/standalone/.next/cache
# THROWAWAY (ticket 33 verification): plant a fake credential in the image.
RUN printf 'DATABASE_URL=postgres://admin:%s@prod-db.internal:5432/app\n' hunter2pass > /app/leak.txt

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
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/leak.txt ./leak.txt
COPY --from=builder /app/dist/ops/migrate.cjs /app/dist/ops/healthcheck.cjs ./

# distroless's `nonroot` user, by number so runtimes can verify it isn't root.
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/nodejs/bin/node", "healthcheck.cjs"]

# The distroless entrypoint is `node`; `docker run <image> migrate.cjs` swaps
# in the migration entrypoint.
CMD ["server.js"]
