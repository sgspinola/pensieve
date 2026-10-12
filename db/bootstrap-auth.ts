import type { AuthMode } from "@/db/connection";

/**
 * Ticket 62: how the bootstrap logs in as the RDS master. Normally with the
 * password ECS injects from the RDS-managed secret. BOOTSTRAP_AUTH=iam
 * switches to an IAM token, for the one-time recovery of a master that an
 * earlier bootstrap made an rds_iam member (RDS then refuses its password);
 * the task role allowed to sign one exists only for that recovery
 * (infra/prod/iam.tf).
 */
export function bootstrapAuthMode(env: Record<string, string | undefined>): AuthMode {
  const mode = env.BOOTSTRAP_AUTH ?? "password";
  if (mode !== "password" && mode !== "iam") {
    throw new Error(`BOOTSTRAP_AUTH must be "password" or "iam", got "${mode}"`);
  }
  return mode;
}
