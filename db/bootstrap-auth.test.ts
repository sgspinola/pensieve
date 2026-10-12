import { describe, expect, it } from "vitest";
import { bootstrapAuthMode } from "./bootstrap-auth";

/**
 * Ticket 62: how bootstrap.cjs logs in as the master. Normally with the
 * injected password; with BOOTSTRAP_AUTH=iam, with an IAM token instead,
 * for the one-time recovery of a master that RDS made IAM-only.
 */
describe("bootstrapAuthMode", () => {
  it("logs in with the password by default", () => {
    expect(bootstrapAuthMode({})).toBe("password");
  });

  it("logs in with an IAM token when BOOTSTRAP_AUTH=iam", () => {
    expect(bootstrapAuthMode({ BOOTSTRAP_AUTH: "iam" })).toBe("iam");
  });

  it("accepts BOOTSTRAP_AUTH=password explicitly", () => {
    expect(bootstrapAuthMode({ BOOTSTRAP_AUTH: "password" })).toBe("password");
  });

  it("refuses anything else rather than guess", () => {
    expect(() => bootstrapAuthMode({ BOOTSTRAP_AUTH: "IAM" })).toThrow(/BOOTSTRAP_AUTH/);
  });
});
