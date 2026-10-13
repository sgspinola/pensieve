import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb, type TestDatabase } from "@/test/db";
import { useTestLogSink } from "@/test/log-sink";
import { VirtualAuthenticator } from "@/test/virtualAuthenticator";
import type { AuthEvent } from "@/services/auth/auth-events";
import { createInvite } from "@/services/auth/invites";
import { findRecoveryCodeUser, generateRecoveryCodes } from "@/services/auth/recovery-codes";
import { createSession, deleteSession } from "@/services/auth/session";
import {
  completeAccountRecovery,
  generatePasskeyLoginOptions,
  generatePasskeyRegistrationOptions,
  generatePasskeyRegistrationOptionsForInvite,
  generatePasskeyRegistrationOptionsForUser,
  getRelyingPartyConfig,
  redeemInvite,
  registerPasskey,
  verifyPasskeyLogin,
} from "@/services/auth/webauthn";

/**
 * Ticket 61: every authentication-relevant action logs an explicit auth
 * event (category pensieve.auth) on success and on failure, with the user
 * ID where it's known and never a secret. The Proxy's session rejection is
 * covered in src/proxy.test.ts.
 */
describe("auth events (ticket 61)", () => {
  let db: TestDatabase;
  let teardown: (() => Promise<void>) | undefined;
  let records: LogRecord[];
  let restore: () => Promise<void>;
  const { origin } = getRelyingPartyConfig();

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    teardown = testDb.teardown;
    ({ records, restore } = await useTestLogSink());
  });

  afterEach(async () => {
    await restore();
    if (!teardown) return;
    const cleanup = teardown;
    teardown = undefined;
    await cleanup();
  });

  function events(event: AuthEvent, outcome: "success" | "failure"): Record<string, unknown>[] {
    return records
      .filter((r) => r.category.join(".") === "pensieve.auth")
      .filter((r) => r.properties.event === event && r.properties.outcome === outcome)
      .map((r) => ({ level: r.level, ...r.properties }));
  }

  async function bootstrapAdmin() {
    const authenticator = new VirtualAuthenticator();
    const options = await generatePasskeyRegistrationOptions(db, { displayName: "Alice" });
    const result = await registerPasskey(db, {
      response: authenticator.register(options, origin),
      expectedChallenge: options.challenge,
      displayName: "Alice",
    });
    return { ...result, authenticator, options };
  }

  async function inviteMember(adminId: string, displayName: string) {
    const { token } = await createInvite(db, adminId);
    const authenticator = new VirtualAuthenticator();
    const options = await generatePasskeyRegistrationOptionsForInvite(db, { token, displayName });
    const result = await redeemInvite(db, {
      token,
      response: authenticator.register(options, origin),
      expectedChallenge: options.challenge,
      displayName,
    });
    return { ...result, token, authenticator };
  }

  async function recoverWith(code: string, replacement: VirtualAuthenticator) {
    const { userId } = await findRecoveryCodeUser(db, code);
    const options = await generatePasskeyRegistrationOptionsForUser(db, userId);
    return completeAccountRecovery(db, {
      code,
      response: replacement.register(options, origin),
      expectedChallenge: options.challenge,
    });
  }

  describe("admin_registration, passkey_added and session_created", () => {
    it("log success with the new admin's ID", async () => {
      const { user } = await bootstrapAdmin();

      for (const event of ["admin_registration", "passkey_added", "session_created"] as const) {
        expect(events(event, "success")).toEqual([expect.objectContaining({ level: "info", userId: user.id })]);
      }
    });

    it("log a failed admin registration once the admin exists", async () => {
      const { options } = await bootstrapAdmin();

      await expect(
        registerPasskey(db, {
          response: new VirtualAuthenticator().register(options, origin),
          expectedChallenge: options.challenge,
          displayName: "Mallory",
        }),
      ).rejects.toThrow();

      expect(events("admin_registration", "failure")).toEqual([
        expect.objectContaining({
          level: "warning",
          reason: "Registration is invite-only; the admin account already exists",
        }),
      ]);
    });

    it("log a failed session creation with the user ID", async () => {
      const unknownUser = "00000000-0000-0000-0000-000000000000";

      await expect(createSession(db, unknownUser)).rejects.toThrow();

      expect(events("session_created", "failure")).toEqual([
        expect.objectContaining({ level: "warning", userId: unknownUser }),
      ]);
    });
  });

  describe("passkey_login", () => {
    it("logs success with the user's ID", async () => {
      const { user, authenticator } = await bootstrapAdmin();
      const options = await generatePasskeyLoginOptions();

      await verifyPasskeyLogin(db, {
        response: authenticator.authenticate(options, origin),
        expectedChallenge: options.challenge,
      });

      expect(events("passkey_login", "success")).toEqual([expect.objectContaining({ userId: user.id })]);
    });

    it("logs an unknown passkey's failure without a user ID", async () => {
      await bootstrapAdmin();
      const options = await generatePasskeyLoginOptions();

      await expect(
        verifyPasskeyLogin(db, {
          response: new VirtualAuthenticator().authenticate(options, origin),
          expectedChallenge: options.challenge,
        }),
      ).rejects.toThrow();

      const [failure] = events("passkey_login", "failure");
      expect(failure).toMatchObject({ level: "warning", reason: "Unknown passkey credential" });
      expect(failure.userId).toBeUndefined();
    });

    it("logs a known passkey's failed ceremony with the account that was tried", async () => {
      const { user, authenticator } = await bootstrapAdmin();
      const options = await generatePasskeyLoginOptions();

      await expect(
        verifyPasskeyLogin(db, {
          response: authenticator.authenticate(options, origin),
          expectedChallenge: "not-the-challenge",
        }),
      ).rejects.toThrow();

      expect(events("passkey_login", "failure")).toEqual([expect.objectContaining({ userId: user.id })]);
    });
  });

  describe("invite_redemption", () => {
    it("logs success with the new member's ID, never the token", async () => {
      const { user: admin } = await bootstrapAdmin();
      const { user, token } = await inviteMember(admin.id, "Bob");

      expect(events("invite_redemption", "success")).toEqual([expect.objectContaining({ userId: user.id })]);
      expect(JSON.stringify(records.map((r) => r.properties))).not.toContain(token);
    });

    it("logs a dead link's failure at the options stage", async () => {
      await expect(
        generatePasskeyRegistrationOptionsForInvite(db, { token: "never-issued", displayName: "Eve" }),
      ).rejects.toThrow();

      expect(events("invite_redemption", "failure")).toEqual([
        expect.objectContaining({ stage: "options", reason: "Invite link is invalid, already used, or expired" }),
      ]);
    });

    it("logs a failed redemption", async () => {
      const { user: admin } = await bootstrapAdmin();
      const { token } = await createInvite(db, admin.id);
      const options = await generatePasskeyRegistrationOptionsForInvite(db, { token, displayName: "Bob" });

      await expect(
        redeemInvite(db, {
          token,
          response: new VirtualAuthenticator().register(options, "http://wrong-origin"),
          expectedChallenge: options.challenge,
          displayName: "Bob",
        }),
      ).rejects.toThrow();

      expect(events("invite_redemption", "failure")).toEqual([
        expect.objectContaining({ reason: "Passkey registration could not be verified" }),
      ]);
    });
  });

  describe("recovery_code_use and passkey_removed", () => {
    it("log success with the user's ID, never the code", async () => {
      const { user } = await bootstrapAdmin();
      const [code] = await generateRecoveryCodes(db, user.id);

      await recoverWith(code, new VirtualAuthenticator());

      for (const event of ["recovery_code_use", "passkey_removed"] as const) {
        expect(events(event, "success")).toEqual([expect.objectContaining({ userId: user.id })]);
      }
      expect(JSON.stringify(records.map((r) => r.properties))).not.toContain(code);
    });

    it("log an unknown code's failure at the options stage", async () => {
      await expect(findRecoveryCodeUser(db, "aaaaa-bbbbb-ccccc-ddddd")).rejects.toThrow();

      expect(events("recovery_code_use", "failure")).toEqual([
        expect.objectContaining({ stage: "options", reason: "Invalid or already-used recovery code" }),
      ]);
    });

    it("log a failed replacement, removal and addition with the user's ID", async () => {
      // Bob recovers with Alice's passkey, which is already registered, so
      // the swap's insert hits the credential's unique index and the whole
      // transaction rolls back.
      const { user: admin, authenticator: alicesPasskey } = await bootstrapAdmin();
      const { user: bob } = await inviteMember(admin.id, "Bob");
      const [code] = await generateRecoveryCodes(db, bob.id);

      await expect(recoverWith(code, alicesPasskey)).rejects.toThrow("This passkey is already registered");

      for (const event of ["recovery_code_use", "passkey_removed", "passkey_added"] as const) {
        expect(events(event, "failure")).toEqual([expect.objectContaining({ level: "warning", userId: bob.id })]);
      }
    });
  });

  describe("logout", () => {
    it("logs success with the session's user ID", async () => {
      const { user, session } = await bootstrapAdmin();

      await deleteSession(db, session.token);

      expect(events("logout", "success")).toEqual([expect.objectContaining({ userId: user.id })]);
    });

    it("logs a failure", async () => {
      const failing = {
        delete: () => {
          throw new Error("database unavailable");
        },
      } as unknown as Database;

      await expect(deleteSession(failing, "some-token")).rejects.toThrow();

      expect(events("logout", "failure")).toEqual([expect.objectContaining({ reason: "database unavailable" })]);
    });
  });
});
