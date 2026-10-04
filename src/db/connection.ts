import { readFileSync } from "node:fs";
import path from "node:path";
import { Signer } from "@aws-sdk/rds-signer";
import postgres from "postgres";

/**
 * Ticket 40: the one place that decides how to reach Postgres (spec 11,
 * "Application changes"). With `DATABASE_URL` set (local development, CI,
 * tests) it's used as-is. Otherwise the connection comes from the libpq-style
 * PGHOST/PGPORT/PGDATABASE/PGUSER variables, authenticated with RDS IAM: the
 * password is a function postgres.js calls for every new connection, which
 * signs a fresh 15-minute token with the task role's credentials, so no
 * database password exists anywhere. IAM auth requires TLS, verified against
 * the RDS CA bundle shipped in the image.
 */
export type ConnectionConfig =
  | { url: string }
  | {
      host: string;
      port: number;
      database: string;
      username: string;
      password: () => Promise<string>;
      ssl: { ca: string; rejectUnauthorized: true };
    };

/** Who an IAM token is for: RDS signs it for one host, port and database user. */
export interface TokenTarget {
  hostname: string;
  port: number;
  username: string;
}

export interface ConnectionDeps {
  signToken: (target: TokenTarget) => Promise<string>;
  readCaBundle: () => string;
}

export function getConnectionConfig(env: Record<string, string | undefined>, deps: ConnectionDeps): ConnectionConfig {
  if (env.DATABASE_URL) {
    return { url: env.DATABASE_URL };
  }
  const required = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER"] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`DATABASE_URL is not set, and neither are ${missing.join(", ")}`);
  }
  const host = env.PGHOST!;
  const port = Number(env.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PGPORT must be a port number, got "${env.PGPORT}"`);
  }
  const username = env.PGUSER!;
  return {
    host,
    port,
    database: env.PGDATABASE!,
    username,
    password: () => deps.signToken({ hostname: host, port, username }),
    ssl: { ca: deps.readCaBundle(), rejectUnauthorized: true },
  };
}

// Relative to the working directory: `/app` in the image, the repo root locally.
const RDS_CA_BUNDLE = path.join(process.cwd(), "certs", "rds-global-bundle.pem");

const awsDeps: ConnectionDeps = {
  // The region comes from AWS_REGION, which ECS sets in every task, and the
  // credentials from the default chain (the task role, in ECS).
  signToken: (target) => new Signer(target).getAuthToken(),
  readCaBundle: () => readFileSync(RDS_CA_BUNDLE, "utf8"),
};

/**
 * Opens a postgres.js client for whichever mode the environment selects.
 * `options` tune the client (pool size, timeouts); in IAM mode the connection
 * settings, including the token password and verified TLS, always win.
 */
export function connect(options: postgres.Options<Record<string, never>> = {}): postgres.Sql {
  const config = getConnectionConfig(process.env, awsDeps);
  return "url" in config ? postgres(config.url, options) : postgres({ ...options, ...config });
}
