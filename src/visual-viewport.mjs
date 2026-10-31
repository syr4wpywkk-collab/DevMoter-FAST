/**
 * One shared visualViewport listener for the whole app (iOS Safari keyboard).
 *
 * It publishes three CSS variables on <html>:
 *   --dm-viewport-height      visible viewport height (shrinks while the keyboard is open)
 *   --dm-viewport-offset-top  how far iOS panned the visual viewport down
 *   --dm-keyboard-inset       layout-viewport space hidden below the visual viewport
 * and, when a form field gains focus, scrolls it into view once the keyboard
 * has settled. Keyboard follow is never animated; the focus scroll is smooth
 * only when the user has not asked for reduced motion.
 */

/** Pure: how much of the layout viewport is covered below the visible area. */
export function computeKeyboardInset({ layoutHeight, viewportHeight, offsetTop = 0 }) {
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(viewportHeight) || layoutHeight <= 0 || viewportHeight <= 0) return 0;
  const inset = layoutHeight - viewportHeight - (Number.isFinite(offsetTop) ? Math.max(0, offsetTop) : 0);
  return inset > 0 ? Math.round(inset) : 0;
}

/** Pure: the three CSS variable values for one viewport reading. */
export function viewportMetrics(win) {
  const vv = win.visualViewport;
  const layoutHeight = win.innerHeight;
  const viewportHeight = vv?.height ?? layoutHeight;
  const offsetTop = vv?.offsetTop ?? 0;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  return {
    height: Math.max(1, Math.floor(viewportHeight)),
    offsetTop: Math.max(0, Math.round(offsetTop || 0)),
    keyboardInset: computeKeyboardInset({ layoutHeight, viewportHeight, offsetTop })
  };
}

const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]), textarea, select, [contenteditable="true"]';

export function isTextField(target) {
  return Boolean(target && typeof target.matches === "function" && target.matches(FIELD_SELECTOR));
}

let active = null;

/**
 * Starts the shared sync (idempotent, reference counted). Returns stop().
 */
export function startViewportSync(win = globalThis.window) {
  if (!win?.document) return () => {};
  if (active && active.win === win) {
    active.refs += 1;
    return active.release;
  }
  const doc = win.document;
  const rootStyle = doc.documentElement.style;
  const vv = win.visualViewport;
  let focused = null;

  const revealFocused = () => {
    if (!focused || !focused.isConnected || doc.activeElement !== focused) return;
    const reduce = win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    focused.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
  };
  const sync = () => {
    const metrics = viewportMetrics(win);
    if (!metrics) return;
    rootStyle.setProperty("--dm-viewport-height", `${metrics.height}px`);
    rootStyle.setProperty("--dm-viewport-offset-top", `${metrics.offsetTop}px`);
    rootStyle.setProperty("--dm-keyboard-inset", `${metrics.keyboardInset}px`);
  };
  const onResize = () => { sync(); revealFocused(); };
  const onFocusIn = event => {
    focused = isTextField(event.target) ? event.target : null;
    // The keyboard may already be open (field to field); otherwise the
    // visualViewport resize that follows reveals the field again.
    if (focused) win.requestAnimationFrame?.(revealFocused);
  };
  const onFocusOut = () => { focused = null; };

  sync();
  vv?.addEventListener("resize", onResize, { passive: true });
  vv?.addEventListener("scroll", sync, { passive: true });
  win.addEventListener("resize", onResize, { passive: true });
  win.addEventListener("orientationchange", onResize);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);

  const state = {
    win,
    refs: 1,
    release() {
      if (active !== state) return;
      state.refs -= 1;
      if (state.refs > 0) return;
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", sync);
      win.removeEventListener("resize", onResize);
      win.removeEventListener("orientationchange", onResize);
      doc.removeEventListener("focusin", onFocusIn);
      doc.removeEventListener("focusout", onFocusOut);
      active = null;
    }
  };
  active = state;
  return state.release;
}
