# syntax=docker/dockerfile:1

# Ticket 41: the DB image (spec 13), the database's own artifact: the Drizzle
# migrations, their migrator and the roles-and-grants bootstrap (ticket 42),
# and no Next.js or app code. Built from the repository root, for
# linux/arm64 only:
#   docker build --platform linux/arm64 -f db/Dockerfile -t pensieve-db .
# Same bases and hardening as the app's Dockerfile; both are pinned by
# multi-arch index digest, which Dependabot's docker ecosystem keeps current.

# --- builder: full Node toolchain, never shipped ------------------------------
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS builder
WORKDIR /app

# package.json's engines pins npm exactly; the base image's bundled npm drifts.
RUN npm install --global npm@11.16.0

COPY package.json package-lock.json ./
RUN npm ci

# Only what the entrypoints' bundles import: the entrypoints, the shared
# connection helper, and tsconfig.json for esbuild's `@/` path alias.
COPY tsconfig.json ./
COPY db ./db
COPY src/db ./src/db
RUN npm run build:db

# --- runtime: distroless Node, no shell or package manager, non-root ---------
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
WORKDIR /app
ENV NODE_ENV=production

# Root-owned, so read-only to the nonroot user: nothing here needs writing.
COPY drizzle ./drizzle
COPY db/bootstrap.sql ./db/
COPY --from=builder /app/dist/db/migrate.cjs /app/dist/db/bootstrap.cjs ./
# RDS's public CA bundle, which src/db/connection.ts verifies the database's
# TLS certificate against in IAM-auth mode (ticket 40).
COPY certs/rds-global-bundle.pem ./certs/

# distroless's `nonroot` user, by number so runtimes can verify it isn't root.
USER 65532:65532

# The distroless entrypoint is `node`, so this runs the migrator;
# `docker run <db-image> bootstrap.cjs` runs the bootstrap instead.
CMD ["migrate.cjs"]
