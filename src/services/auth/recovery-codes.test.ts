import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { VirtualAuthenticator } from "@/test/virtualAuthenticator";
import { useTestLogSink } from "@/test/log-sink";
import { UnauthorizedError } from "@/services/errors";
import { getSessionUser } from "@/services/auth/session";
import {
  completeAccountRecovery,
  generatePasskeyLoginOptions,
  generatePasskeyRegistrationOptions,
  generatePasskeyRegistrationOptionsForUser,
  getRelyingPartyConfig,
  registerPasskey,
  verifyPasskeyLogin,
} from "@/services/auth/webauthn";
import {
  findRecoveryCodeUser,
  generateRecoveryCodes,
  redeemRecoveryCode,
} from "@/services/auth/recovery-codes";

describe("recovery codes", () => {
  let db: TestDatabase;
  let teardown: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    teardown = testDb.teardown;
  });

  afterEach(async () => {
    if (!teardown) return;
    const cleanup = teardown;
    teardown = undefined;
    await cleanup();
  });

  async function bootstrapUser() {
    const authenticator = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();

    const options = await generatePasskeyRegistrationOptions(db, {
      displayName: "Alice",
    });
    const { user } = await registerPasskey(db, {
      response: authenticator.register(options, origin),
      expectedChallenge: options.challenge,
      displayName: "Alice",
    });
    return { user, authenticator };
  }

  it("generates a set of recovery codes for a user, returning them only once", async () => {
    const { user } = await bootstrapUser();

    const codes = await generateRecoveryCodes(db, user.id);

    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("redeems a valid code, invalidating it and identifying its user", async () => {
    const { user } = await bootstrapUser();
    const [code] = await generateRecoveryCodes(db, user.id);

    const { userId } = await redeemRecoveryCode(db, code);

    expect(userId).toBe(user.id);
  });

  it("rejects redemption of an already-used code", async () => {
    const { user } = await bootstrapUser();
    const [code] = await generateRecoveryCodes(db, user.id);

    await redeemRecoveryCode(db, code);

    await expect(redeemRecoveryCode(db, code)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects redemption of a code that was never issued", async () => {
    await expect(redeemRecoveryCode(db, "not-a-real-code")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("only invalidates the redeemed code, leaving sibling codes usable", async () => {
    const { user } = await bootstrapUser();
    const [firstCode, secondCode] = await generateRecoveryCodes(db, user.id);

    await redeemRecoveryCode(db, firstCode);

    const { userId } = await redeemRecoveryCode(db, secondCode);
    expect(userId).toBe(user.id);
  });

  it("identifies a code's user without invalidating it (peek)", async () => {
    const { user } = await bootstrapUser();
    const [code] = await generateRecoveryCodes(db, user.id);

    const { userId } = await findRecoveryCodeUser(db, code);
    expect(userId).toBe(user.id);

    // Still unused — a normal redemption still succeeds afterward.
    await expect(redeemRecoveryCode(db, code)).resolves.toEqual({ userId: user.id });
  });

  it("lets a redeemed code register a replacement passkey that can then log in", async () => {
    const { user } = await bootstrapUser();
    const [code] = await generateRecoveryCodes(db, user.id);

    const replacement = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();
    const { userId } = await findRecoveryCodeUser(db, code);
    const options = await generatePasskeyRegistrationOptionsForUser(db, userId);

    const { user: registeredUser } = await completeAccountRecovery(db, {
      code,
      response: replacement.register(options, origin),
      expectedChallenge: options.challenge,
    });
    expect(registeredUser.id).toBe(user.id);

    const loginOptions = await generatePasskeyLoginOptions();
    const { user: loggedInUser } = await verifyPasskeyLogin(db, {
      response: replacement.authenticate(loginOptions, origin),
      expectedChallenge: loginOptions.challenge,
    });
    expect(loggedInUser.id).toBe(user.id);
  });

  it("does not invalidate the code when the replacement-passkey ceremony fails", async () => {
    const { user } = await bootstrapUser();
    const [code] = await generateRecoveryCodes(db, user.id);

    const { userId } = await findRecoveryCodeUser(db, code);
    const options = await generatePasskeyRegistrationOptionsForUser(db, userId);
    const staleResponse = new VirtualAuthenticator().register(options, "http://wrong-origin");

    await expect(
      completeAccountRecovery(db, {
        code,
        response: staleResponse,
        expectedChallenge: options.challenge,
      }),
    ).rejects.toThrow(UnauthorizedError);

    // The code must still be usable — a failed ceremony shouldn't burn it.
    await expect(redeemRecoveryCode(db, code)).resolves.toEqual({ userId: user.id });
  });

  it("revokes the lost device's old passkey and existing sessions on successful recovery", async () => {
    const { user, authenticator: lostDevice } = await bootstrapUser();
    const [code] = await generateRecoveryCodes(db, user.id);
    const { origin } = getRelyingPartyConfig();

    const replacement = new VirtualAuthenticator();
    const { userId } = await findRecoveryCodeUser(db, code);
    const options = await generatePasskeyRegistrationOptionsForUser(db, userId);

    const preRecoveryLoginOptions = await generatePasskeyLoginOptions();
    const { session: oldSession } = await verifyPasskeyLogin(db, {
      response: lostDevice.authenticate(preRecoveryLoginOptions, origin),
      expectedChallenge: preRecoveryLoginOptions.challenge,
    });

    await completeAccountRecovery(db, {
      code,
      response: replacement.register(options, origin),
      expectedChallenge: options.challenge,
    });

    // The lost device's old session is gone.
    await expect(getSessionUser(db, oldSession.token)).rejects.toThrow(UnauthorizedError);

    // The lost device's old passkey can no longer log in.
    const loginOptions = await generatePasskeyLoginOptions();
    await expect(
      verifyPasskeyLogin(db, {
        response: lostDevice.authenticate(loginOptions, origin),
        expectedChallenge: loginOptions.challenge,
      }),
    ).rejects.toThrow(UnauthorizedError);

    // The replacement passkey works.
    const replacementLoginOptions = await generatePasskeyLoginOptions();
    const { user: loggedInUser } = await verifyPasskeyLogin(db, {
      response: replacement.authenticate(replacementLoginOptions, origin),
      expectedChallenge: replacementLoginOptions.challenge,
    });
    expect(loggedInUser.id).toBe(user.id);
  });

  describe("mutation logging (ticket 10)", () => {
    it("logs entity/entityId for each recovery code created", async () => {
      const { user } = await bootstrapUser();
      const { records, restore } = await useTestLogSink();

      try {
        await generateRecoveryCodes(db, user.id);
      } finally {
        await restore();
      }

      const recoveryRecords = records.filter((r) => r.properties.entity === "recoveryCodes");
      expect(recoveryRecords.length).toBeGreaterThan(0);
      expect(recoveryRecords[0]?.properties.entityId).toBeTruthy();
    });

    it("logs entity/entityId on redeemRecoveryCode success", async () => {
      const { user } = await bootstrapUser();
      const [code] = await generateRecoveryCodes(db, user.id);

      const { records, restore } = await useTestLogSink();
      try {
        await redeemRecoveryCode(db, code);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "recoveryCodes");
      expect(record?.properties.entityId).toBeTruthy();
    });

    it("logs webauthnCredentials replacement (delete old + create new) on account recovery", async () => {
      const { user } = await bootstrapUser();
      const [code] = await generateRecoveryCodes(db, user.id);
      const { userId } = await findRecoveryCodeUser(db, code);
      const options = await generatePasskeyRegistrationOptionsForUser(db, userId);
      const replacement = new VirtualAuthenticator();
      const { origin } = getRelyingPartyConfig();

      const { records, restore } = await useTestLogSink();
      try {
        await completeAccountRecovery(db, {
          code,
          response: replacement.register(options, origin),
          expectedChallenge: options.challenge,
        });
      } finally {
        await restore();
      }

      const credentialRecords = records.filter((r) => r.properties.entity === "webauthnCredentials");
      // One delete (old credential) + one create (new credential).
      expect(credentialRecords.length).toBeGreaterThanOrEqual(2);
      for (const record of credentialRecords) {
        expect(record.properties.entityId).toBeTruthy();
      }

      // Account recovery also revokes every existing session for the user
      // (see completeAccountRecovery's docstring) — that deletion should be
      // logged too, entity "sessions".
      const sessionRecords = records.filter((r) => r.properties.entity === "sessions");
      expect(sessionRecords.length).toBeGreaterThanOrEqual(1);
      for (const record of sessionRecords) {
        expect(record.properties.entityId).toBeTruthy();
      }
    });
  });
});
