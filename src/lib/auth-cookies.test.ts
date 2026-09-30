import { describe, expect, it } from "vitest";
import { decodeUserHeader, encodeUserHeader } from "@/lib/auth-cookies";
import type { SessionUser } from "@/services/auth/session";

describe("user header encoding", () => {
  it("round-trips a user with a non-Latin1 display name", () => {
    const user: SessionUser = { id: "1", displayName: "田中さくら 🌸", role: "member" };

    expect(decodeUserHeader(encodeUserHeader(user))).toEqual(user);
  });

  it("produces a value the Headers API accepts for a non-Latin1 display name", () => {
    // Headers.set() throws for any value outside the ByteString/Latin-1
    // range — this is exactly what broke before encoding was added: a raw
    // JSON.stringify(user) could contain characters Headers rejects.
    const user: SessionUser = { id: "1", displayName: "田中さくら 🌸", role: "member" };

    const headers = new Headers();
    expect(() => headers.set("x-test", encodeUserHeader(user))).not.toThrow();
  });
});
