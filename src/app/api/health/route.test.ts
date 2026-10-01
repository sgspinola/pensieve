import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestLogSink } from "@/test/log-sink";

// Ticket 28: the health route the container HEALTHCHECK and CI e2e job poll.
// getDb is mocked (the same seam the other route tests use) so the DB can be
// made to answer or fail on demand.
const state = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: () => ({ execute: state.execute }),
}));

const { GET } = await import("./route");

describe("GET /api/health (ticket 28)", () => {
  afterEach(() => {
    state.execute.mockReset();
  });

  it("returns 200 with a minimal up body when the database answers", async () => {
    state.execute.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "up" });
  });

  it("returns a safe 503 with no internal detail when the database query fails, and logs the failure", async () => {
    const logs = await useTestLogSink();
    state.execute.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 (postgres://pensieve:s3cret@db/pensieve)'),
    );

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      const bodyText = await response.text();
      expect(JSON.parse(bodyText)).toEqual({ status: "down" });
      expect(bodyText).not.toMatch(/ECONNREFUSED|5432|s3cret|postgres/);
      expect(logs.records.some((record) => record.level === "error")).toBe(true);
    } finally {
      await logs.restore();
    }
  });

  // postgres.js waits up to 30s to connect to an unreachable host, far longer
  // than a container probe will wait — a hung query must still end in a 503,
  // well inside a typical few-second probe timeout.
  it("returns a 503 within 5 seconds when the database doesn't answer", async () => {
    vi.useFakeTimers();
    const logs = await useTestLogSink();
    state.execute.mockReturnValue(new Promise(() => {}));
    try {
      const pending = GET();
      await vi.advanceTimersByTimeAsync(5_000);
      const response = await pending;

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "down" });
    } finally {
      vi.useRealTimers();
      await logs.restore();
    }
  });
});
