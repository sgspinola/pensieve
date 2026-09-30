import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { invites, users } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { getLogger } from "@/lib/logging";
import { UnauthorizedError } from "@/services/errors";
import { logMutationFailure, logMutationSuccess } from "@/services/mutation-log";

const logger = getLogger(["pensieve", "invites"]);
const ENTITY = "invites";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function unredeemedInviteFilter(token: string) {
  return and(
    eq(invites.tokenHash, sha256Hex(token)),
    isNull(invites.usedAt),
    gt(invites.expiresAt, new Date()),
  );
}

/**
 * Generates a single-use invite link token — the only path by which a
 * second user can join the workspace (see spec). Admin-only: rejects any
 * caller whose role isn't `admin`, checked fresh against the database
 * rather than trusting a caller-supplied role.
 *
 * The raw token is returned so the caller can embed it in a manually-shared
 * link (e.g. `/invite/<token>`); only its hash is persisted, same rationale
 * as session tokens and recovery codes — a stolen DB dump can't be replayed
 * as a live invite.
 */
export async function createInvite(
  db: Database,
  adminUserId: string,
): Promise<{ token: string; expiresAt: Date }> {
  try {
    const [actor] = await db.select({ role: users.role }).from(users).where(eq(users.id, adminUserId));
    if (!actor || actor.role !== "admin") {
      throw new UnauthorizedError("Only the admin can create invites");
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const [row] = await db
      .insert(invites)
      .values({
        tokenHash: sha256Hex(token),
        createdBy: adminUserId,
        expiresAt,
      })
      .returning({ id: invites.id });

    logMutationSuccess(logger, "Invite created", { entity: ENTITY, entityId: row.id });
    return { token, expiresAt };
  } catch (error) {
    logMutationFailure(logger, "Invite creation failed", { entity: ENTITY }, error);
    throw error;
  }
}

/**
 * Throws unless `token` is an unused, unexpired invite — checked before
 * running a WebAuthn ceremony so an obviously-dead link fails fast rather
 * than after the invitee completes a passkey prompt. This is a read-only
 * check: a positive result doesn't reserve the invite (see claimInvite for
 * the atomic redemption step).
 */
export async function assertInviteRedeemable(db: Database, token: string): Promise<void> {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(unredeemedInviteFilter(token));

  if (!row) {
    throw new UnauthorizedError("Invite link is invalid, already used, or expired");
  }
}

/**
 * Non-throwing form of assertInviteRedeemable, for UI branching (the invite
 * page deciding whether to render the registration form or an error).
 */
export async function isInviteRedeemable(db: Database, token: string): Promise<boolean> {
  try {
    await assertInviteRedeemable(db, token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically marks an invite used, guarded on `usedAt IS NULL AND
 * expiresAt > now()` in the UPDATE's WHERE clause — the same race-safety
 * approach as redeemRecoveryCode — so two concurrent redemption attempts of
 * the same token can each only "win" the row once. Called by redeemInvite
 * only after the invitee's passkey ceremony has already been verified, so a
 * cancelled/failed ceremony never burns the invite.
 */
export async function claimInvite(db: Database, token: string): Promise<{ id: string }> {
  // Claiming is this entity's "delete": a single-use invite that's been
  // claimed can never be redeemed again, the same irrecoverable-state-change
  // that a literal row delete would represent for a reusable entity.
  try {
    const [row] = await db
      .update(invites)
      .set({ usedAt: new Date() })
      .where(unredeemedInviteFilter(token))
      .returning({ id: invites.id });

    if (!row) {
      throw new UnauthorizedError("Invite link is invalid, already used, or expired");
    }

    logMutationSuccess(logger, "Invite claimed", { entity: ENTITY, entityId: row.id });
    return row;
  } catch (error) {
    // No id is known here for the "not found/already used/expired" case —
    // only the (unhashed, never logged) token was given, and no row was
    // matched to identify.
    logMutationFailure(logger, "Invite claim failed", { entity: ENTITY }, error);
    throw error;
  }
}
