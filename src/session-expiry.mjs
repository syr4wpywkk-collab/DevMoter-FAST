// When the owner session expires, the server's global gate answers every
// /api/ request with 401 { error: "Authentication required", login: "/login.html" }.
// Instead of each surface showing that raw error, one banner offers to sign in
// again. Nothing redirects automatically, so unsent input is never discarded;
// chat drafts are kept in sessionStorage and come back after signing in.

import { t } from "./i18n-core.mjs";

const LOGIN_PATH = "/login.html";

/** True for the global gate's "signed out" answer, not for device or step-up refusals. */
export function isSessionExpiredResponse(status, body) {
  return status === 401 && Boolean(body) && typeof body === "object" &&
    body.login === LOGIN_PATH && body.error === "Authentication required";
}

function requestUrl(input, base) {
  try {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    return new URL(raw, base);
  } catch {
    return null;
  }
}

/** Wraps win.fetch and calls onExpired once when a same-origin /api/ call reports an expired session. */
export function watchSessionExpiry(win, onExpired) {
  const original = win.fetch.bind(win);
  let notified = false;
  win.fetch = async (input, init) => {
    const response = await original(input, init);
    if (notified || response.status !== 401) return response;
    const url = requestUrl(input, win.location.href);
    if (!url || url.origin !== win.location.origin || !url.pathname.startsWith("/api/")) return response;
    try {
      const body = await response.clone().json();
      if (!notified && isSessionExpiredResponse(response.status, body)) {
        notified = true;
        onExpired();
      }
    } catch {
      // Non-JSON 401 bodies are left to the caller.
    }
    return response;
  };
  return () => { win.fetch = original; };
}

/** Shows one dismissible banner with a sign-in link; returns the banner element. */
export function showSessionExpiredBanner(doc = document) {
  const existing = doc.querySelector(".dm-session-expired");
  if (existing) return existing;
  const banner = doc.createElement("div");
  banner.className = "dm-session-expired";
  banner.setAttribute("role", "alert");
  const text = doc.createElement("p");
  text.textContent = t("sessionExpiry.message");
  const signIn = doc.createElement("a");
  signIn.href = LOGIN_PATH;
  signIn.className = "dm-session-expired-signin";
  signIn.textContent = t("sessionExpiry.signIn");
  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.className = "dm-session-expired-dismiss";
  dismiss.textContent = t("sessionExpiry.dismiss");
  dismiss.addEventListener("click", () => banner.remove());
  banner.append(text, signIn, dismiss);
  doc.body.append(banner);
  return banner;
}

export function startSessionExpiryWatch(win = window) {
  return watchSessionExpiry(win, () => showSessionExpiredBanner(win.document));
}
