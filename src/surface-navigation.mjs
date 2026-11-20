import {
  DEFAULT_VISIBLE_BACKEND,
  QWEN_UI_ENABLED,
  isHiddenQwenTarget,
  isVisibleChatBackend
} from "./feature-flags.mjs";

const SURFACES = new Set(
  QWEN_UI_ENABLED
    ? ["home", "opencode", "codex", "api", "deepseek", "devin", "qwen", "integrations"]
    : ["home", "opencode", "codex", "api", "deepseek", "devin", "integrations"]
);

export function isMainSurface(value) {
  return typeof value === "string" && SURFACES.has(value);
}

export function initialMainSurface(search, { hasProjectDeepLink = false, savedBackend = "" } = {}) {
  const params = new URLSearchParams(search || "");
  const explicit = params.get("surface");
  if (isMainSurface(explicit)) return explicit;
  if (isHiddenQwenTarget(explicit)) return DEFAULT_VISIBLE_BACKEND;
  const requestedBackend = params.get("backend");
  const hasResumeTarget =
    isVisibleChatBackend(requestedBackend) ||
    isHiddenQwenTarget(requestedBackend) ||
    Boolean(params.get("session")) ||
    hasProjectDeepLink;
  if (hasResumeTarget) {
    if (isVisibleChatBackend(requestedBackend)) return requestedBackend;
    if (isHiddenQwenTarget(requestedBackend)) return DEFAULT_VISIBLE_BACKEND;
    return SURFACES.has(savedBackend) && savedBackend !== "home" ? savedBackend : DEFAULT_VISIBLE_BACKEND;
  }
  return "home";
}

function stateWithSurface(state, surface) {
  return { ...(state && typeof state === "object" && !Array.isArray(state) ? state : {}), devmoterSurface: surface };
}

export function createSurfaceNavigation({ window, hasProjectDeepLink = false, savedBackend = "", onSurface = () => {} }) {
  if (!window?.history || !window?.location || typeof onSurface !== "function") {
    throw new Error("Surface navigation requires a browser window and onSurface callback");
  }
  const { history, location } = window;
  function urlFor(surface) {
    const url = new URL(location.href);
    url.searchParams.set("surface", surface);
    // A provider/Home navigation leaves any unified workspace panel route.
    url.searchParams.delete("workspaceTab");
    return url.pathname + url.search + url.hash;
  }
  function read() {
    const value = new URLSearchParams(location.search).get("surface");
    return isMainSurface(value) ? value : null;
  }
  function current() {
    return read() || "home";
  }
  function replace(surface) {
    history.replaceState(stateWithSurface(history.state, surface), "", urlFor(surface));
  }
  const initial = initialMainSurface(location.search, { hasProjectDeepLink, savedBackend });
  if (!read()) replace(initial);

  function navigate(surface, { replaceCurrent = false } = {}) {
    const target = isHiddenQwenTarget(surface) ? DEFAULT_VISIBLE_BACKEND : surface;
    if (!isMainSurface(target)) return false;
    if (current() === target) {
      // A Home/provider navigation must dismiss a workspace overlay even
      // when the underlying main surface does not change.
      if (!new URLSearchParams(location.search).has("workspaceTab")) return false;
      replace(target);
      onSurface(target);
      return true;
    }
    if (replaceCurrent) replace(target);
    else history.pushState(stateWithSurface(history.state, target), "", urlFor(target));
    onSurface(target);
    return true;
  }
  function onPopState() {
    let surface = read();
    if (!surface) {
      surface = initialMainSurface(location.search, { hasProjectDeepLink, savedBackend });
      replace(surface);
    }
    onSurface(surface);
  }
  window.addEventListener("popstate", onPopState);
  return { current, navigate, destroy() { window.removeEventListener("popstate", onPopState); } };
}
