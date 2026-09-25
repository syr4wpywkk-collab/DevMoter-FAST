const SURFACES = new Set(["home", "opencode", "codex", "api", "integrations"]);
const LEGACY_BACKENDS = new Set(["opencode", "codex", "api"]);

export function isMainSurface(value) {
  return typeof value === "string" && SURFACES.has(value);
}

export function initialMainSurface(search, { hasProjectDeepLink = false, savedBackend = "" } = {}) {
  const params = new URLSearchParams(search || "");
  const explicit = params.get("surface");
  if (isMainSurface(explicit)) return explicit;
  const requestedBackend = params.get("backend");
  const hasResumeTarget = LEGACY_BACKENDS.has(requestedBackend) || Boolean(params.get("session")) || hasProjectDeepLink;
  if (hasResumeTarget) {
    if (LEGACY_BACKENDS.has(requestedBackend)) return requestedBackend;
    return SURFACES.has(savedBackend) && savedBackend !== "home" ? savedBackend : "opencode";
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
    if (!isMainSurface(surface)) return false;
    if (current() === surface) return false;
    if (replaceCurrent) replace(surface);
    else history.pushState(stateWithSurface(history.state, surface), "", urlFor(surface));
    onSurface(surface);
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
