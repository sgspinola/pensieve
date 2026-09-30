import { eq } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { Database } from "@/db/client";
import { invites, sessions, users, webauthnCredentials } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { getLogger } from "@/lib/logging";
import { UnauthorizedError } from "@/services/errors";
import { logMutationFailure, logMutationSuccess } from "@/services/mutation-log";
import { createSession, type Session, type SessionUser } from "@/services/auth/session";
import { generateRecoveryCodes, redeemRecoveryCode } from "@/services/auth/recovery-codes";
import { assertInviteRedeemable, claimInvite } from "@/services/auth/invites";

const logger = getLogger(["pensieve", "webauthn"]);

export interface RelyingPartyConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

/**
 * The RP ID is bound to the deployed domain (see spec) — changing it later
 * invalidates every existing passkey. Defaults target local development.
 */
export function getRelyingPartyConfig(): RelyingPartyConfig {
  const rpID = process.env.WEBAUTHN_RP_ID ?? "localhost";
  const rpName = process.env.WEBAUTHN_RP_NAME ?? "Pensieve";
  const origin = process.env.WEBAUTHN_ORIGIN ?? `http://${rpID}:3000`;
  return { rpName, rpID, origin };
}

export async function usersExist(db: Database): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return row !== undefined;
}

function assertBootstrapEligible(usersAlreadyExist: boolean): void {
  if (usersAlreadyExist) {
    throw new UnauthorizedError(
      "Registration is invite-only; the admin account already exists",
    );
  }
}

function buildRegistrationOptions(
  displayName: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpName, rpID } = getRelyingPartyConfig();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: displayName,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
}

/**
 * Verifies a completed WebAuthn registration ceremony's cryptographic
 * correctness only — no DB access, no side effects. Callers decide what to
 * do with a verified credential (create a user, attach to an existing one).
 */
async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<NonNullable<VerifiedRegistrationResponse["registrationInfo"]>> {
  const { rpID, origin } = getRelyingPartyConfig();

  // @simplewebauthn/server throws directly (rather than returning
  // verified: false) for some malformed inputs, e.g. an origin mismatch —
  // since the input here is client-controlled, any failure shape maps to
  // the same UnauthorizedError rather than surfacing as a raw 500.
  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    throw new UnauthorizedError("Passkey registration could not be verified");
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new UnauthorizedError("Passkey registration could not be verified");
  }

  return verification.registrationInfo;
}

function credentialValues(
  userId: string,
  credential: NonNullable<VerifiedRegistrationResponse["registrationInfo"]>["credential"],
) {
  return {
    userId,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
  };
}

export async function generatePasskeyRegistrationOptions(
  db: Database,
  params: { displayName: string },
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  assertBootstrapEligible(await usersExist(db));
  return buildRegistrationOptions(params.displayName);
}

export interface AuthResult {
  user: SessionUser;
  session: Session;
}

export interface RegistrationResult extends AuthResult {
  // Shown to the caller exactly once, at registration time — only their
  // hashes are ever persisted (see generateRecoveryCodes).
  recoveryCodes: string[];
}

/**
 * Verifies a completed WebAuthn registration ceremony and creates the
 * account for it. Bootstraps the sole admin account when `users` is empty;
 * otherwise no open registration path exists — member registration is
 * driven only by an invite token (see redeemInvite).
 */
export async function registerPasskey(
  db: Database,
  params: {
    response: RegistrationResponseJSON;
    expectedChallenge: string;
    displayName: string;
  },
): Promise<RegistrationResult> {
  assertBootstrapEligible(await usersExist(db));

  const { credential } = await verifyRegistration(params.response, params.expectedChallenge);

  // The users/webauthn_credentials inserts run in one transaction so a
  // failure partway through never leaves a user with no credential (which
  // would permanently lock the deployment out: usersExist() would report
  // true forever, but no passkey could ever log in). A unique index on
  // `users` additionally guarantees at most one admin row at the database
  // level, closing the race where two concurrent bootstrap registrations
  // both see an empty `users` table and both attempt to insert one.
  let user: typeof users.$inferSelect;
  try {
    user = await db.transaction(async (tx) => {
      const [insertedUser] = await tx
        .insert(users)
        .values({ displayName: params.displayName, role: "admin" })
        .returning();

      const [insertedCredential] = await tx
        .insert(webauthnCredentials)
        .values(credentialValues(insertedUser.id, credential))
        .returning({ id: webauthnCredentials.id });

      logMutationSuccess(logger, "WebAuthn user created", {
        entity: "webauthnUsers",
        entityId: insertedUser.id,
      });
      logMutationSuccess(logger, "WebAuthn credential created", {
        entity: "webauthnCredentials",
        entityId: insertedCredential.id,
      });

      return insertedUser;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logMutationFailure(
        logger,
        "WebAuthn user creation failed",
        { entity: "webauthnUsers" },
        err,
      );
      throw new UnauthorizedError(
        "Registration is invite-only; the admin account already exists",
      );
    }
    logMutationFailure(logger, "WebAuthn user creation failed", { entity: "webauthnUsers" }, err);
    throw err;
  }

  const [session, recoveryCodes] = await Promise.all([
    createSession(db, user.id),
    generateRecoveryCodes(db, user.id),
  ]);
  return {
    user: { id: user.id, displayName: user.displayName, role: user.role },
    session,
    recoveryCodes,
  };
}

/**
 * Registration options for the invitee's own passkey, gated on the invite
 * token being unused and unexpired — checked up front so a dead link fails
 * before the invitee is prompted for a passkey at all. Unlike
 * generatePasskeyRegistrationOptions (bootstrap), this never depends on
 * `users` being empty: an invite is the only way a second account gets
 * created.
 */
export async function generatePasskeyRegistrationOptionsForInvite(
  db: Database,
  params: { token: string; displayName: string },
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  await assertInviteRedeemable(db, params.token);
  return buildRegistrationOptions(params.displayName);
}

/**
 * Completes invite-based member registration: verifies the invitee's
 * passkey ceremony, then — only once that succeeds — claims the invite
 * (atomically, so a concurrent or later redemption of the same link is
 * rejected) and creates the new `member` account for it.
 *
 * Verification happens before claiming for the same reason as
 * completeAccountRecovery: a cancelled/failed ceremony (a dismissed browser
 * prompt, a timeout) must not permanently burn the one-time link.
 */
export async function redeemInvite(
  db: Database,
  params: {
    token: string;
    response: RegistrationResponseJSON;
    expectedChallenge: string;
    displayName: string;
  },
): Promise<RegistrationResult> {
  const { credential } = await verifyRegistration(params.response, params.expectedChallenge);
  const invite = await claimInvite(db, params.token);

  let user: typeof users.$inferSelect;
  try {
    user = await db.transaction(async (tx) => {
      const [insertedUser] = await tx
        .insert(users)
        .values({ displayName: params.displayName, role: "member" })
        .returning();

      const [insertedCredential] = await tx
        .insert(webauthnCredentials)
        .values(credentialValues(insertedUser.id, credential))
        .returning({ id: webauthnCredentials.id });
      await tx.update(invites).set({ usedBy: insertedUser.id }).where(eq(invites.id, invite.id));

      logMutationSuccess(logger, "WebAuthn user created", {
        entity: "webauthnUsers",
        entityId: insertedUser.id,
      });
      logMutationSuccess(logger, "WebAuthn credential created", {
        entity: "webauthnCredentials",
        entityId: insertedCredential.id,
      });

      return insertedUser;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logMutationFailure(
        logger,
        "WebAuthn user creation failed",
        { entity: "webauthnUsers" },
        err,
      );
      throw new UnauthorizedError("This passkey is already registered");
    }
    logMutationFailure(logger, "WebAuthn user creation failed", { entity: "webauthnUsers" }, err);
    throw err;
  }

  const [session, recoveryCodes] = await Promise.all([
    createSession(db, user.id),
    generateRecoveryCodes(db, user.id),
  ]);
  return {
    user: { id: user.id, displayName: user.displayName, role: user.role },
    session,
    recoveryCodes,
  };
}

/**
 * Registration options for adding a passkey to an *existing* user — used by
 * the recovery-code flow to issue a replacement passkey after the original
 * device is lost. Unlike generatePasskeyRegistrationOptions, this has no
 * bootstrap restriction: the caller is already known (identified by a
 * recovery code), not inferred from an empty `users` table.
 */
export async function generatePasskeyRegistrationOptionsForUser(
  db: Database,
  userId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new UnauthorizedError("Unknown user");
  }

  return buildRegistrationOptions(user.displayName);
}

/**
 * Completes account recovery: verifies the replacement-passkey ceremony,
 * then — only once that succeeds — redeems the recovery code and swaps it
 * in as the user's sole passkey.
 *
 * Order matters here. Verification happens before redemption so a
 * cancelled/failed ceremony never burns the code (the common failure case —
 * a dismissed browser prompt, a timeout — otherwise silently costs the user
 * one of their limited recovery attempts for nothing). And the old
 * credential and every existing session are revoked as part of the same
 * transaction as attaching the new one: recovery means the device holding
 * the old passkey is gone, so leaving it (or sessions opened from it) valid
 * would defeat the point of recovering.
 */
export async function completeAccountRecovery(
  db: Database,
  params: {
    code: string;
    response: RegistrationResponseJSON;
    expectedChallenge: string;
  },
): Promise<AuthResult> {
  const { credential } = await verifyRegistration(params.response, params.expectedChallenge);
  const { userId } = await redeemRecoveryCode(db, params.code);

  let user: typeof users.$inferSelect;
  try {
    user = await db.transaction(async (tx) => {
      const deletedCredentials = await tx
        .delete(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, userId))
        .returning({ id: webauthnCredentials.id });
      const [insertedCredential] = await tx
        .insert(webauthnCredentials)
        .values(credentialValues(userId, credential))
        .returning({ id: webauthnCredentials.id });
      const deletedSessions = await tx
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });

      for (const deleted of deletedCredentials) {
        logMutationSuccess(logger, "WebAuthn credential deleted", {
          entity: "webauthnCredentials",
          entityId: deleted.id,
        });
      }
      logMutationSuccess(logger, "WebAuthn credential created", {
        entity: "webauthnCredentials",
        entityId: insertedCredential.id,
      });
      for (const deleted of deletedSessions) {
        logMutationSuccess(logger, "Session deleted", {
          entity: "sessions",
          entityId: deleted.id,
        });
      }

      const [row] = await tx.select().from(users).where(eq(users.id, userId));
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logMutationFailure(
        logger,
        "WebAuthn credential replacement failed",
        { entity: "webauthnCredentials" },
        err,
      );
      throw new UnauthorizedError("This passkey is already registered");
    }
    logMutationFailure(
      logger,
      "WebAuthn credential replacement failed",
      { entity: "webauthnCredentials" },
      err,
    );
    throw err;
  }

  if (!user) {
    throw new UnauthorizedError("Unknown user");
  }

  const session = await createSession(db, user.id);
  return {
    user: { id: user.id, displayName: user.displayName, role: user.role },
    session,
  };
}

export async function generatePasskeyLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getRelyingPartyConfig();
  return generateAuthenticationOptions({ rpID, userVerification: "preferred" });
}

export async function verifyPasskeyLogin(
  db: Database,
  params: { response: AuthenticationResponseJSON; expectedChallenge: string },
): Promise<AuthResult> {
  const { rpID, origin } = getRelyingPartyConfig();

  const [storedCredential] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, params.response.id));

  if (!storedCredential) {
    throw new UnauthorizedError("Unknown passkey credential");
  }

  const verification = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: storedCredential.credentialId,
      publicKey: isoBase64URL.toBuffer(storedCredential.publicKey),
      counter: storedCredential.counter,
      transports: storedCredential.transports ?? undefined,
    },
  });

  if (!verification.verified) {
    throw new UnauthorizedError("Passkey login could not be verified");
  }

  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(webauthnCredentials.id, storedCredential.id));

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, storedCredential.userId));

  if (!user) {
    throw new UnauthorizedError("Credential is not associated with a user");
  }

  const session = await createSession(db, user.id);
  return {
    user: { id: user.id, displayName: user.displayName, role: user.role },
    session,
  };
}
