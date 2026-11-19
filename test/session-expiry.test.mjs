import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { isSessionExpiredResponse, showSessionExpiredBanner, watchSessionExpiry } from "../src/session-expiry.mjs";

const EXPIRED = { error: "Authentication required", login: "/login.html" };

function jsonResponse(window, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(responses) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://devmoter.test/" });
  const { window } = dom;
  const calls = [];
  window.fetch = async (input) => {
    calls.push(String(input));
    const next = responses.shift();
    return next(window);
  };
  return { window, calls };
}

test("#322: the server's global gate answers an expired session with the body the client watches for", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /json\(res, 401, \{ error: "Authentication required", login: "\/login\.html" \}\)/);
  assert.equal(isSessionExpiredResponse(401, EXPIRED), true);
  assert.equal(isSessionExpiredResponse(403, EXPIRED), false);
  assert.equal(isSessionExpiredResponse(401, { error: "Trusted device token required" }), false);
  assert.equal(isSessionExpiredResponse(401, { error: "Confirm this sign-in with a Passkey" }), false);
  assert.equal(isSessionExpiredResponse(401, null), false);
});

test("#322: an expired /api/ call shows one sign-in banner and the caller still gets the response", async () => {
  const { window } = setup([
    w => jsonResponse(w, 401, EXPIRED),
    w => jsonResponse(w, 401, EXPIRED)
  ]);
  let expired = 0;
  watchSessionExpiry(window, () => {
    expired += 1;
    showSessionExpiredBanner(window.document);
  });

  const first = await window.fetch("/api/projects");
  assert.equal(first.status, 401);
  assert.deepEqual(await first.json(), EXPIRED, "the original body stays readable");
  await window.fetch("/api/config");
  assert.equal(expired, 1);

  const banners = window.document.querySelectorAll(".dm-session-expired");
  assert.equal(banners.length, 1);
  const banner = banners[0];
  assert.equal(banner.getAttribute("role"), "alert");
  assert.equal(banner.querySelector("a")?.getAttribute("href"), "/login.html");
  assert.equal(window.location.href, "https://devmoter.test/", "nothing redirects automatically");
  banner.querySelector("button").click();
  assert.equal(window.document.querySelector(".dm-session-expired"), null);
});

test("#322: other failures and other origins never show the banner", async () => {
  const { window } = setup([
    w => jsonResponse(w, 401, { error: "Trusted device token required" }),
    w => jsonResponse(w, 401, { error: "Confirm this sign-in with a Passkey" }),
    w => jsonResponse(w, 500, EXPIRED),
    w => jsonResponse(w, 401, EXPIRED),
    w => jsonResponse(w, 401, EXPIRED),
    w => new Response("Unauthorized", { status: 401 })
  ]);
  let expired = 0;
  watchSessionExpiry(window, () => { expired += 1; });
  await window.fetch("/api/terminal/sessions");
  await window.fetch("/api/projects");
  await window.fetch("/api/projects");
  await window.fetch("https://other.test/api/projects");
  await window.fetch("/login.js");
  await window.fetch("/api/raw");
  assert.equal(expired, 0);
});

test("#322: banner strings exist in every locale", async () => {
  for (const locale of ["en", "ja", "zh-Hans", "zh-Hant"]) {
    const source = await readFile(new URL(`../src/locales/${locale}.mjs`, import.meta.url), "utf8");
    for (const key of ["sessionExpiry.message", "sessionExpiry.signIn", "sessionExpiry.dismiss"]) {
      assert.match(source, new RegExp(`"${key.replace(".", "\\.")}": "[^"]+"`), `${locale} ${key}`);
    }
  }
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /startSessionExpiryWatch\(window\)/);
});

test("#322: the banner stays reachable inside an open modal dialog and returns to the page when it closes", () => {
  const dom = new JSDOM("<!doctype html><body><dialog id='office' open></dialog></body>", { url: "https://devmoter.test/" });
  const { document, Event } = dom.window;
  const dialog = document.querySelector("dialog");
  // JSDOM has no showModal(); report the open dialog as modal like a browser would.
  const matches = dialog.matches.bind(dialog);
  dialog.matches = selector => selector === ":modal" || matches(selector);
  const banner = showSessionExpiredBanner(document);
  assert.equal(banner.parentElement, dialog);
  dialog.removeAttribute("open");
  dialog.dispatchEvent(new Event("close"));
  assert.equal(banner.parentElement, document.body);
});

test("#322: a non-modal open dialog does not capture the banner", () => {
  const dom = new JSDOM("<!doctype html><body><dialog open></dialog></body>", { url: "https://devmoter.test/" });
  assert.equal(showSessionExpiredBanner(dom.window.document).parentElement, dom.window.document.body);
});

test("#322: banner text keeps the theme's primary text color instead of the global paragraph gray", async () => {
  const css = await readFile(new URL("../src/styles/base.css", import.meta.url), "utf8");
  assert.match(css, /\.dm-session-expired p \{[^}]*color: var\(--text-primary\);/);
});
