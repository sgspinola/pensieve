import type { Router } from "vitepress";

// Mermaid renders each ```mermaid block into a `.mermaid` div client-side,
// asynchronously, well after this module first runs — so we can't just scan
// once on mount. Worse: vitepress-plugin-mermaid's own component re-renders
// at least once more shortly after first mount (it watches <html>'s
// attributes for theme changes and re-renders on any hit, which includes
// unrelated early attribute writes like OS-class detection). Reparenting the
// diagram into our wrapper *while that's still settling* races Vue's
// hydration reconciliation: Vue detects a structural mismatch at that DOM
// position and "repairs" it by wiping our wrapper's children (diagram *and*
// button) and re-rendering fresh content in their place. A MutationObserver
// plus a per-element debounce — only enhancing once an element's subtree has
// been quiet for DEBOUNCE_MS — reliably waits out that settling window
// before we touch the DOM, on first load and on every SPA route change.
const DEBOUNCE_MS = 700;

let closeCurrent: (() => void) | null = null;
const pendingTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function buildOverlay(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>(".diagram-zoom-overlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.className = "diagram-zoom-overlay";
  overlay.innerHTML = `
    <button type="button" class="diagram-zoom-close" aria-label="Close" title="Close (Esc)">&#x2715;</button>
    <div class="diagram-zoom-hint">Scroll or pinch to zoom, drag to pan</div>
    <div class="diagram-zoom-svg-host"></div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

async function openFullscreen(mermaidEl: HTMLElement) {
  const svg = mermaidEl.querySelector("svg");
  if (!svg) return;

  closeCurrent?.();

  const overlay = buildOverlay();
  const host = overlay.querySelector<HTMLElement>(".diagram-zoom-svg-host")!;
  const closeBtn = overlay.querySelector<HTMLElement>(".diagram-zoom-close")!;

  const placeholder = document.createComment("diagram-zoom-placeholder");
  svg.before(placeholder);
  host.appendChild(svg);

  // Mermaid sets an inline max-width (its rendered-at-normal-size cap) —
  // clear it so the diagram can actually fill the overlay instead of
  // staying pinned to its original small on-page size.
  const originalMaxWidth = svg.style.maxWidth;
  const originalMaxHeight = svg.style.maxHeight;
  svg.style.maxWidth = "none";
  svg.style.maxHeight = "none";

  overlay.classList.add("is-open");
  // Lock scroll via <body>, not <html> — vitepress-plugin-mermaid installs a
  // MutationObserver on document.documentElement's *attributes* to detect
  // dark-mode class changes and re-render every diagram on any hit. Mutating
  // documentElement's own class here would retrigger that mid-fullscreen,
  // discarding the diagram we just moved into the overlay.
  document.body.classList.add("diagram-zoom-locked");

  const { default: svgPanZoom } = await import("svg-pan-zoom");

  // svg-pan-zoom reads the SVG's on-screen geometry (getBoundingClientRect
  // / getScreenCTM) to compute its initial viewport matrix. The overlay was
  // just made visible this same tick, so layout for it hasn't happened yet
  // — measuring now returns a degenerate (zero-size) box, which svg-pan-zoom
  // can't invert ("SVGMatrix ... not invertible"). Two rAFs reliably land
  // after the browser has computed layout for the newly-visible overlay.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const instance = svgPanZoom(svg, {
    zoomEnabled: true,
    panEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    minZoom: 0.2,
    maxZoom: 25,
  });

  function close() {
    instance.destroy();
    svg.style.maxWidth = originalMaxWidth;
    svg.style.maxHeight = originalMaxHeight;
    placeholder.replaceWith(svg);
    overlay.classList.remove("is-open");
    document.body.classList.remove("diagram-zoom-locked");
    document.removeEventListener("keydown", onKeydown);
    closeBtn.removeEventListener("click", close);
    closeCurrent = null;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
  closeCurrent = close;
}

function enhance(mermaidEl: HTMLElement) {
  if (mermaidEl.dataset.zoomEnhanced) return;
  if (!mermaidEl.querySelector("svg")) return;
  mermaidEl.dataset.zoomEnhanced = "true";

  const parent = mermaidEl.parentElement;
  if (!parent) return;

  const wrap = document.createElement("div");
  wrap.className = "diagram-zoom-wrap";
  parent.insertBefore(wrap, mermaidEl);
  wrap.appendChild(mermaidEl);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "diagram-zoom-btn";
  btn.setAttribute("aria-label", "View diagram fullscreen");
  btn.title = "View fullscreen";
  btn.innerHTML = "&#x26F6;";
  btn.addEventListener("click", () => openFullscreen(mermaidEl));
  wrap.appendChild(btn);
}

function scheduleEnhance(mermaidEl: HTMLElement) {
  if (mermaidEl.dataset.zoomEnhanced) return;

  const existing = pendingTimers.get(mermaidEl);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(mermaidEl);
    // Re-check: the element may have been replaced/removed, or already
    // enhanced via another path, during the debounce window.
    if (mermaidEl.isConnected && !mermaidEl.dataset.zoomEnhanced && mermaidEl.querySelector("svg")) {
      enhance(mermaidEl);
    }
  }, DEBOUNCE_MS);
  pendingTimers.set(mermaidEl, timer);
}

function scan() {
  document.querySelectorAll<HTMLElement>(".mermaid").forEach((el) => {
    if (el.querySelector("svg")) scheduleEnhance(el);
  });
}

export function setupDiagramZoom(router: Router) {
  let observer: MutationObserver | null = null;

  function start() {
    scan();
    observer?.disconnect();
    observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  const prevOnAfterRouteChange = router.onAfterRouteChange;
  router.onAfterRouteChange = (to) => {
    prevOnAfterRouteChange?.(to);
    closeCurrent?.();
    requestAnimationFrame(start);
  };
}
