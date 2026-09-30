import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { recoveryCodes } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { getLogger } from "@/lib/logging";
import { UnauthorizedError } from "@/services/errors";
import { logMutationFailure, logMutationSuccess } from "@/services/mutation-log";

const logger = getLogger(["pensieve", "recovery-codes"]);
const ENTITY = "recoveryCodes";

const RECOVERY_CODE_COUNT = 10;

function generateCode(): string {
  // 4 groups of 5 base32-ish hex chars, e.g. "a1b2c-d3e4f-56789-0abcd" — long
  // enough to be unguessable, short enough to transcribe from a screen.
  const raw = randomBytes(10).toString("hex");
  return raw.match(/.{1,5}/g)!.join("-");
}

/**
 * Issues a fresh batch of one-time recovery codes for a user (called at
 * passkey registration time). Only each code's hash is persisted — the
 * plaintext codes are returned so the caller can show them to the user once;
 * they cannot be retrieved again afterward.
 */
export async function generateRecoveryCodes(
  db: Database,
  userId: string,
): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateCode);

  try {
    const rows = await db
      .insert(recoveryCodes)
      .values(codes.map((code) => ({ userId, codeHash: sha256Hex(code) })))
      .returning({ id: recoveryCodes.id });

    for (const row of rows) {
      logMutationSuccess(logger, "Recovery code created", { entity: ENTITY, entityId: row.id });
    }

    return codes;
  } catch (error) {
    logMutationFailure(logger, "Recovery code creation failed", { entity: ENTITY }, error);
    throw error;
  }
}

/**
 * Identifies the user a code belongs to without consuming it — used to know
 * whose replacement-passkey ceremony to set up before that ceremony has
 * actually succeeded. Redemption (see redeemRecoveryCode) only happens once
 * the ceremony is verified, so a cancelled/failed attempt never burns the
 * code.
 */
export async function findRecoveryCodeUser(
  db: Database,
  code: string,
): Promise<{ userId: string }> {
  const [row] = await db
    .select({ userId: recoveryCodes.userId })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.codeHash, sha256Hex(code)), isNull(recoveryCodes.usedAt)));

  if (!row) {
    throw new UnauthorizedError("Invalid or already-used recovery code");
  }

  return row;
}

/**
 * Redeems a one-time recovery code, atomically marking it used so a
 * concurrent or later redemption attempt with the same code is rejected.
 * The `usedAt IS NULL` guard in the UPDATE's WHERE clause (rather than a
 * separate SELECT-then-UPDATE) is what makes this race-safe: two concurrent
 * redemptions of the same code can each only "win" the row once.
 */
export async function redeemRecoveryCode(
  db: Database,
  code: string,
): Promise<{ userId: string }> {
  // Redemption is this entity's "delete": a one-time code that's been
  // redeemed can never be used again, the same irrecoverable-state-change a
  // literal row delete would represent for a reusable entity.
  try {
    const [row] = await db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(recoveryCodes.codeHash, sha256Hex(code)), isNull(recoveryCodes.usedAt)))
      .returning({ userId: recoveryCodes.userId, id: recoveryCodes.id });

    if (!row) {
      throw new UnauthorizedError("Invalid or already-used recovery code");
    }

    logMutationSuccess(logger, "Recovery code redeemed", { entity: ENTITY, entityId: row.id });
    return { userId: row.userId };
  } catch (error) {
    // No id is known here for the "not found/already used" case — only the
    // (unhashed, never logged) code was given, and no row was matched.
    logMutationFailure(logger, "Recovery code redemption failed", { entity: ENTITY }, error);
    throw error;
  }
}
