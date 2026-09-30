/**
 * The origin card's measured bounding rect (e.g. from `Element.getBoundingClientRect()`),
 * expressed in viewport coordinates.
 */
export interface OverlayOriginRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The overlay's own rendered size, once it's widened to its reading-width layout. */
export interface OverlaySize {
  width: number;
  height: number;
}

/** The current viewport's dimensions. */
export interface OverlayViewport {
  width: number;
  height: number;
}

export interface OverlayPosition {
  top: number;
  left: number;
}

/**
 * Computes a viewport-clamped `top`/`left` for an "expand card into overlay" UI.
 *
 * The overlay is anchored at the origin card's own top-left corner by default (so the
 * expanded view opens roughly where the card the user was looking at already is), then
 * nudged back on-screen so it never overflows past the right, bottom, left, or top edge
 * of the viewport.
 *
 * If the overlay itself is larger than the viewport along an axis, it's impossible to
 * fit it fully on-screen on that axis. Rather than clamping to a negative offset (which
 * would push the overlay's near edge further off-screen than necessary) or leaving NaN,
 * that axis is pinned to `0` — flush against the viewport's origin edge.
 */
export function computeOverlayPosition(
  origin: OverlayOriginRect,
  overlaySize: OverlaySize,
  viewport: OverlayViewport,
): OverlayPosition {
  return {
    top: clampAxis(origin.top, overlaySize.height, viewport.height),
    left: clampAxis(origin.left, overlaySize.width, viewport.width),
  };
}

/**
 * Clamps a single-axis anchor position so `anchor + size` doesn't exceed `viewportSize`,
 * and never dips below 0 (including when `size` alone exceeds `viewportSize`).
 */
function clampAxis(anchor: number, size: number, viewportSize: number): number {
  const maxOffset = Math.max(viewportSize - size, 0);
  return Math.min(Math.max(anchor, 0), maxOffset);
}
