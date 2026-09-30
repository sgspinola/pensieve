import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { VirtualAuthenticator } from "@/test/virtualAuthenticator";
import { useTestLogSink } from "@/test/log-sink";
import { UnauthorizedError } from "@/services/errors";
import { getSessionUser } from "@/services/auth/session";
import {
  generatePasskeyLoginOptions,
  generatePasskeyRegistrationOptions,
  getRelyingPartyConfig,
  registerPasskey,
  verifyPasskeyLogin,
  type RegistrationResult,
} from "@/services/auth/webauthn";

describe("passkey auth core", () => {
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

  it("bootstraps the first passkey registration on an empty users table as the admin account", async () => {
    const authenticator = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();

    const options = await generatePasskeyRegistrationOptions(db, {
      displayName: "Alice",
    });
    const response = authenticator.register(options, origin);

    const { user } = await registerPasskey(db, {
      response,
      expectedChallenge: options.challenge,
      displayName: "Alice",
    });

    expect(user.displayName).toBe("Alice");
    expect(user.role).toBe("admin");
  });

  it("rejects registration once an admin account already exists (no open self-registration)", async () => {
    const bootstrap = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();

    const bootstrapOptions = await generatePasskeyRegistrationOptions(db, {
      displayName: "Alice",
    });
    await registerPasskey(db, {
      response: bootstrap.register(bootstrapOptions, origin),
      expectedChallenge: bootstrapOptions.challenge,
      displayName: "Alice",
    });

    await expect(
      generatePasskeyRegistrationOptions(db, { displayName: "Mallory" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("allows only one admin account when two bootstrap registrations race", async () => {
    const authenticatorA = new VirtualAuthenticator();
    const authenticatorB = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();

    const optionsA = await generatePasskeyRegistrationOptions(db, {
      displayName: "Alice",
    });
    const optionsB = await generatePasskeyRegistrationOptions(db, {
      displayName: "Bob",
    });

    const results = await Promise.allSettled([
      registerPasskey(db, {
        response: authenticatorA.register(optionsA, origin),
        expectedChallenge: optionsA.challenge,
        displayName: "Alice",
      }),
      registerPasskey(db, {
        response: authenticatorB.register(optionsB, origin),
        expectedChallenge: optionsB.challenge,
        displayName: "Bob",
      }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<RegistrationResult> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(UnauthorizedError);
  });

  it("logs in with a registered passkey via SimpleWebAuthn's ceremony and establishes a session", async () => {
    const authenticator = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();

    const registrationOptions = await generatePasskeyRegistrationOptions(db, {
      displayName: "Alice",
    });
    const { user: registeredUser } = await registerPasskey(db, {
      response: authenticator.register(registrationOptions, origin),
      expectedChallenge: registrationOptions.challenge,
      displayName: "Alice",
    });

    const loginOptions = await generatePasskeyLoginOptions();
    const loginResponse = authenticator.authenticate(loginOptions, origin);

    const { user: loggedInUser, session } = await verifyPasskeyLogin(db, {
      response: loginResponse,
      expectedChallenge: loginOptions.challenge,
    });

    expect(loggedInUser.id).toBe(registeredUser.id);

    const sessionUser = await getSessionUser(db, session.token);
    expect(sessionUser.id).toBe(registeredUser.id);
  });

  it("rejects a protected service call when there is no valid session", async () => {
    await expect(getSessionUser(db, undefined)).rejects.toThrow(UnauthorizedError);
    await expect(getSessionUser(db, "not-a-real-token")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  describe("webauthn user/credential mutation logging (ticket 10)", () => {
    it("logs webauthnUsers + webauthnCredentials creation on bootstrap registration", async () => {
      const authenticator = new VirtualAuthenticator();
      const { origin } = getRelyingPartyConfig();
      const options = await generatePasskeyRegistrationOptions(db, { displayName: "Alice" });

      const { records, restore } = await useTestLogSink();
      let user;
      try {
        ({ user } = await registerPasskey(db, {
          response: authenticator.register(options, origin),
          expectedChallenge: options.challenge,
          displayName: "Alice",
        }));
      } finally {
        await restore();
      }

      const userRecord = records.find((r) => r.properties.entity === "webauthnUsers");
      expect(userRecord?.properties).toMatchObject({ entity: "webauthnUsers", entityId: user.id });

      const credentialRecord = records.find((r) => r.properties.entity === "webauthnCredentials");
      expect(credentialRecord?.properties.entity).toBe("webauthnCredentials");
      expect(credentialRecord?.properties.entityId).toBeTruthy();
    });
  });
});
