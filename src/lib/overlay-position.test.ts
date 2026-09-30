import { describe, expect, it } from "vitest";
import { computeOverlayPosition } from "./overlay-position";

describe("computeOverlayPosition", () => {
  it("anchors the overlay at the card's own position when it comfortably fits within the viewport", () => {
    const origin = { top: 100, left: 100, width: 300, height: 200 };
    const overlay = { width: 400, height: 300 };
    const viewport = { width: 1200, height: 900 };

    expect(computeOverlayPosition(origin, overlay, viewport)).toEqual({ top: 100, left: 100 });
  });

  it("clamps left so the overlay's right edge doesn't exceed the viewport width, for a card near the right edge", () => {
    const origin = { top: 100, left: 1000, width: 150, height: 200 };
    const overlay = { width: 400, height: 300 };
    const viewport = { width: 1200, height: 900 };

    // Natural anchor (left: 1000) would put the overlay's right edge at 1400, past the 1200 viewport.
    // It should be nudged left just enough to fit flush against the right edge: 1200 - 400 = 800.
    expect(computeOverlayPosition(origin, overlay, viewport)).toEqual({ top: 100, left: 800 });
  });

  it("clamps top so the overlay's bottom edge doesn't exceed the viewport height, for a card near the bottom edge", () => {
    const origin = { top: 800, left: 100, width: 300, height: 150 };
    const overlay = { width: 400, height: 300 };
    const viewport = { width: 1200, height: 900 };

    // Natural anchor (top: 800) would put the overlay's bottom edge at 1100, past the 900 viewport.
    // It should be nudged up just enough to fit flush against the bottom edge: 900 - 300 = 600.
    expect(computeOverlayPosition(origin, overlay, viewport)).toEqual({ top: 600, left: 100 });
  });

  it("clamps both top and left simultaneously for a card near a corner", () => {
    const origin = { top: 850, left: 1100, width: 150, height: 150 };
    const overlay = { width: 400, height: 300 };
    const viewport = { width: 1200, height: 900 };

    // left: 1100 + 400 = 1500 > 1200 -> clamp left to 1200 - 400 = 800
    // top: 850 + 300 = 1150 > 900 -> clamp top to 900 - 300 = 600
    expect(computeOverlayPosition(origin, overlay, viewport)).toEqual({ top: 600, left: 800 });
  });

  it("pins to 0 on an axis, rather than going negative, when the overlay is larger than the viewport on that axis", () => {
    const origin = { top: 50, left: 50, width: 300, height: 200 };
    // Overlay wider and taller than the viewport itself.
    const overlay = { width: 1400, height: 1000 };
    const viewport = { width: 1200, height: 900 };

    expect(computeOverlayPosition(origin, overlay, viewport)).toEqual({ top: 0, left: 0 });
  });

  it("never returns NaN or undefined even in the degenerate oversized-overlay case", () => {
    const origin = { top: 0, left: 0, width: 100, height: 100 };
    const overlay = { width: 5000, height: 5000 };
    const viewport = { width: 1200, height: 900 };

    const result = computeOverlayPosition(origin, overlay, viewport);
    expect(Number.isFinite(result.top)).toBe(true);
    expect(Number.isFinite(result.left)).toBe(true);
  });
});
