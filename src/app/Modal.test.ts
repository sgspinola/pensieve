import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

/**
 * `Modal` uses hooks (`useRef`/`useEffect`), unlike the hook-free
 * `TagFilterInput` (see `TagFilterInput.test.ts`), so it can't be called
 * directly as a plain function here — React rejects a hook call outside an
 * active render pass. `renderToStaticMarkup` (from `react-dom/server`,
 * already a dependency, no jsdom needed) drives a real render pass instead:
 * `useRef` and rendering behave normally under it, while `useEffect` is
 * simply skipped (SSR never runs commit-phase effects) — which is exactly
 * the split this repo's Vitest-without-jsdom setup can and can't exercise.
 *
 * That means this file covers the "opening renders content" half of the
 * ticket's test bullet at the markup level: children, `aria-label`/
 * `aria-labelledby`, and the caller's `className` all thread through into
 * the rendered `<dialog>` correctly. It deliberately does NOT attempt to
 * cover focus-trapping or backdrop-click-does-not-close: both are native
 * browser behavior contributed by `showModal()` itself (not by any DOM
 * event wiring this component's own code performs, aside from the
 * `modal-behavior.test.ts`-covered `Esc`/`confirmClose` interception), so
 * they aren't reproducible under SSR or plain Node and remain covered only
 * by this ticket's manual `next dev` verification step.
 */

/**
 * `React.createElement(Modal, props, children)`'s typed overload can't
 * satisfy `Modal`'s (required) `children` prop from a trailing vararg —
 * that merging only happens in the JSX transform, which `.test.ts` files
 * (this repo's Vitest `include` only picks up `.test.ts`, not `.tsx`) don't
 * go through. This helper takes `children` as an explicit argument instead,
 * so call sites below never write `children` as a plain object property
 * (which `react/no-children-prop` rightly flags for JSX-style call sites).
 */
function renderModal(props: Omit<ComponentProps<typeof Modal>, "children">, children: ReactNode) {
  // eslint-disable-next-line react/no-children-prop -- createElement's non-JSX props form, not a JSX call site (see doc comment above).
  return renderToStaticMarkup(createElement(Modal, { ...props, children }));
}

describe("Modal", () => {
  it("renders its children inside the dialog's content area", () => {
    const html = renderModal({ open: true, onClose: () => {} }, createElement("p", null, "Hello from a consumer"));

    expect(html).toContain("<dialog");
    expect(html).toContain("Hello from a consumer");
  });

  it("renders regardless of the open flag, since visibility is driven imperatively via showModal()/close(), not conditional rendering", () => {
    const html = renderModal({ open: false, onClose: () => {} }, createElement("p", null, "Still in the DOM"));

    expect(html).toContain("Still in the DOM");
  });

  it("threads aria-label, aria-labelledby, and the caller's className onto the dialog element", () => {
    const html = renderModal(
      {
        open: true,
        onClose: () => {},
        ariaLabel: "Example dialog",
        ariaLabelledBy: "example-heading",
        className: "caller-class",
      },
      createElement("p", null, "content"),
    );

    expect(html).toContain('aria-label="Example dialog"');
    expect(html).toContain('aria-labelledby="example-heading"');
    expect(html).toContain("caller-class");
  });

  it("renders no close button when showCloseButton is omitted, matching today's output for existing consumers", () => {
    const html = renderModal({ open: true, onClose: () => {} }, createElement("p", null, "content"));

    expect(html).not.toContain('aria-label="Close"');
  });

  it("renders no close button when showCloseButton is explicitly false", () => {
    const html = renderModal(
      { open: true, onClose: () => {}, showCloseButton: false },
      createElement("p", null, "content"),
    );

    expect(html).not.toContain('aria-label="Close"');
  });

  it("renders an accessible close button when showCloseButton is true", () => {
    const html = renderModal(
      { open: true, onClose: () => {}, showCloseButton: true },
      createElement("p", null, "content"),
    );

    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("<button");
  });
});
