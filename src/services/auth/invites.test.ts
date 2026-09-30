import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { VirtualAuthenticator } from "@/test/virtualAuthenticator";
import { invites } from "@/db/schema";
import { useTestLogSink } from "@/test/log-sink";
import { UnauthorizedError } from "@/services/errors";
import { getSessionUser } from "@/services/auth/session";
import {
  generatePasskeyRegistrationOptions,
  generatePasskeyRegistrationOptionsForInvite,
  getRelyingPartyConfig,
  redeemInvite,
  registerPasskey,
} from "@/services/auth/webauthn";
import { createInvite } from "@/services/auth/invites";

describe("invites", () => {
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

  async function bootstrapAdmin() {
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
    return user;
  }

  async function redeemInviteAs(token: string, displayName: string) {
    const authenticator = new VirtualAuthenticator();
    const { origin } = getRelyingPartyConfig();

    const options = await generatePasskeyRegistrationOptionsForInvite(db, {
      token,
      displayName,
    });
    const result = await redeemInvite(db, {
      token,
      response: authenticator.register(options, origin),
      expectedChallenge: options.challenge,
      displayName,
    });
    return { ...result, authenticator };
  }

  it("generates a single-use invite token when the actor is admin", async () => {
    const admin = await bootstrapAdmin();

    const invite = await createInvite(db, admin.id);

    expect(invite.token).toBeTruthy();
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [row] = await db.select().from(invites).where(eq(invites.createdBy, admin.id));
    expect(row).toBeDefined();
    expect(row.usedAt).toBeNull();
    // Only the hash is ever persisted — the raw token isn't recoverable from the row.
    expect(row.tokenHash).not.toBe(invite.token);
  });

  it("rejects invite creation when the actor is not an admin", async () => {
    await expect(createInvite(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejects invite creation from an existing (non-admin) member", async () => {
    const admin = await bootstrapAdmin();
    const { token } = await createInvite(db, admin.id);
    const { user: member } = await redeemInviteAs(token, "Bob");

    await expect(createInvite(db, member.id)).rejects.toThrow(UnauthorizedError);
  });

  it("redeems a valid invite, creating a member and establishing a session", async () => {
    const admin = await bootstrapAdmin();
    const { token } = await createInvite(db, admin.id);

    const { user, session, recoveryCodes } = await redeemInviteAs(token, "Bob");

    expect(user.displayName).toBe("Bob");
    expect(user.role).toBe("member");
    expect(user.id).not.toBe(admin.id);
    // Recovery codes are issued at passkey-registration time regardless of
    // which path (bootstrap or invite) drove the registration ceremony.
    expect(recoveryCodes.length).toBeGreaterThan(0);

    const sessionUser = await getSessionUser(db, session.token);
    expect(sessionUser.id).toBe(user.id);

    const [row] = await db.select().from(invites).where(eq(invites.createdBy, admin.id));
    expect(row.usedAt).not.toBeNull();
    expect(row.usedBy).toBe(user.id);
  });

  it("rejects redeeming the same invite a second time", async () => {
    const admin = await bootstrapAdmin();
    const { token } = await createInvite(db, admin.id);
    const { origin } = getRelyingPartyConfig();

    // Both invitees obtain registration options before either redeems, so
    // the second call below exercises redeemInvite's own reuse guard, not
    // just the options-step pre-check.
    const firstOptions = await generatePasskeyRegistrationOptionsForInvite(db, {
      token,
      displayName: "Bob",
    });
    const secondOptions = await generatePasskeyRegistrationOptionsForInvite(db, {
      token,
      displayName: "Mallory",
    });

    await redeemInvite(db, {
      token,
      response: new VirtualAuthenticator().register(firstOptions, origin),
      expectedChallenge: firstOptions.challenge,
      displayName: "Bob",
    });

    await expect(
      redeemInvite(db, {
        token,
        response: new VirtualAuthenticator().register(secondOptions, origin),
        expectedChallenge: secondOptions.challenge,
        displayName: "Mallory",
      }),
    ).rejects.toThrow(UnauthorizedError);

    // The options step also rejects the now-used token outright.
    await expect(
      generatePasskeyRegistrationOptionsForInvite(db, { token, displayName: "Eve" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects redeeming an expired invite", async () => {
    const admin = await bootstrapAdmin();
    const { token } = await createInvite(db, admin.id);

    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.createdBy, admin.id));

    await expect(
      generatePasskeyRegistrationOptionsForInvite(db, { token, displayName: "Bob" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects redeeming a token that was never issued", async () => {
    await expect(
      generatePasskeyRegistrationOptionsForInvite(db, {
        token: "not-a-real-token",
        displayName: "Bob",
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  describe("mutation logging (ticket 10)", () => {
    it("logs entity/entityId on createInvite success", async () => {
      const admin = await bootstrapAdmin();
      const { records, restore } = await useTestLogSink();

      try {
        await createInvite(db, admin.id);
      } finally {
        await restore();
      }

      const [row] = await db.select().from(invites).where(eq(invites.createdBy, admin.id));
      const record = records.find((r) => r.properties.entity === "invites");
      expect(record?.properties).toMatchObject({ entity: "invites", entityId: row.id });
    });

    it("logs entity/entityId on invite redemption (claimInvite) success", async () => {
      const admin = await bootstrapAdmin();
      const { token } = await createInvite(db, admin.id);
      const [row] = await db.select().from(invites).where(eq(invites.createdBy, admin.id));

      const { records, restore } = await useTestLogSink();
      try {
        await redeemInviteAs(token, "Bob");
      } finally {
        await restore();
      }

      const record = records.find(
        (r) => r.properties.entity === "invites" && r.properties.entityId === row.id,
      );
      expect(record?.properties).toMatchObject({ entity: "invites", entityId: row.id });
    });
  });
});
