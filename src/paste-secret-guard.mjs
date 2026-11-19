// Warns when pasted text looks like it contains a secret (#476).
//
// Everything happens in this browser: the pasted text is matched against
// known key formats and only the *kind* of match is kept. The value is never
// stored, logged, put in the DOM or sent anywhere. The paste itself is not
// blocked, because these patterns produce false positives; the user decides.

import { t } from "./i18n-core.mjs";

// Bounds the work done on a very large paste.
const MAX_SCAN_LENGTH = 200_000;

const PATTERNS = Object.freeze([
  ["privateKey", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ["awsAccessKey", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["githubToken", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["slackToken", /\bxox[abeprs]-[A-Za-z0-9-]{10,}\b/],
  ["googleApiKey", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripeKey", /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/],
  ["apiKey", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["credentialUrl", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
  ["assignedSecret", /\b[\w.-]*(?:password|passwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)[\w.-]*["']?\s*[:=]\s*["']?[^\s"']{8,}/i]
]);

export const SECRET_KINDS = Object.freeze(PATTERNS.map(([kind]) => kind));

/** Kinds of secret the text appears to contain. Never returns matched text. */
export function detectSecretKinds(text) {
  const sample = String(text ?? "").slice(0, MAX_SCAN_LENGTH);
  if (!sample) return [];
  return PATTERNS.filter(([, pattern]) => pattern.test(sample)).map(([kind]) => kind);
}

function isPasteTarget(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = node.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = String(node.getAttribute("type") || "text").toLowerCase();
    // A password field is where a secret is supposed to go.
    return ["text", "search", "url", "email", ""].includes(type);
  }
  return Boolean(node.isContentEditable || node.closest?.('[contenteditable=""], [contenteditable="true"]'));
}

function removeNotice(doc) {
  doc.querySelector("[data-paste-secret-warning]")?.remove();
}

function showNotice(doc, kinds) {
  removeNotice(doc);
  const notice = doc.createElement("div");
  notice.className = "dm-paste-secret-warning";
  notice.dataset.pasteSecretWarning = kinds.join(" ");
  notice.setAttribute("role", "alert");

  const text = doc.createElement("div");
  const title = doc.createElement("strong");
  title.textContent = t("pasteGuard.title");
  const copy = doc.createElement("p");
  copy.textContent = t("pasteGuard.copy", {
    kinds: kinds.map(kind => t(`pasteGuard.kind.${kind}`)).join(t("pasteGuard.kindSeparator"))
  });
  text.append(title, copy);

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.dataset.pasteSecretDismiss = "true";
  dismiss.textContent = t("common.close");
  dismiss.addEventListener("click", () => notice.remove());

  notice.append(text, dismiss);
  doc.body.append(notice);
  return notice;
}

/**
 * Watches pastes into text fields across the app. Returns a stop function.
 */
export function startPasteSecretGuard(doc = document) {
  const onPaste = event => {
    if (!isPasteTarget(event.target)) return;
    let kinds = [];
    try {
      kinds = detectSecretKinds(event.clipboardData?.getData("text/plain"));
    } catch {
      return;
    }
    if (kinds.length) showNotice(doc, kinds);
    else removeNotice(doc);
  };
  doc.addEventListener("paste", onPaste, true);
  return () => {
    doc.removeEventListener("paste", onPaste, true);
    removeNotice(doc);
  };
}
