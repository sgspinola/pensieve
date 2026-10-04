import { expect, it } from "vitest";

// Ticket 38 verification only: makes `unit` fail so `gate` must fail.
it("fails on purpose", () => {
  expect(1).toBe(2);
});
