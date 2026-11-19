import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../public/login.html", import.meta.url), "utf8");
const scriptSource = await readFile(new URL("../public/login.js", import.meta.url), "utf8");

function makeDom(status, search = "") {
  const dom = new JSDOM(source, { url: "https://devmoter.test/login.html" + search, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.fetch = async path => ({
    ok: true,
    async json() { assert.equal(path, "/api/auth/status"); return status; }
  });
  assert.equal(dom.window.document.querySelector('script[src="/login.js"]')?.getAttribute("defer"), "");
  dom.window.eval(scriptSource);
  return dom;
}

test("login screen renders configured providers and makes an available passkey primary", async t => {
  const dom = makeDom({ authenticated: false, providers: {
    passkey: { configured: true, linked: true, available: true },
    github: { configured: true, linked: true, available: true },
    google: { configured: true, linked: true, available: true },
    microsoft: { configured: false, linked: false, available: false }
  } });
  t.after(() => dom.window.close());
  await new Promise(resolve => setTimeout(resolve, 0));
  const buttons = [...dom.window.document.querySelectorAll("#providers button")];
  assert.deepEqual(buttons.map(button => button.dataset.provider), ["passkey", "github", "google"]);
  assert.equal(buttons[0].classList.contains("primary"), true);
  assert.equal(dom.window.document.querySelector("#recovery").open, false);
  assert.equal(dom.window.document.querySelector("#providers").textContent.includes("Coming soon"), false);
  assert.equal(dom.window.document.querySelector("#providers").textContent.includes("Microsoft"), false);
});

test("configured but unlinked OAuth methods guide recovery without starting a link from login", async t => {
  const dom = makeDom({ authenticated: false, providers: {
    passkey: { available: false }, github: { configured: false },
    google: { configured: true, linked: false }, microsoft: { configured: true, linked: false }
  } });
  t.after(() => dom.window.close());
  await new Promise(resolve => setTimeout(resolve, 0));
  const buttons = [...dom.window.document.querySelectorAll("#providers button")];
  assert.deepEqual(buttons.map(button => button.dataset.provider), ["google", "microsoft"]);
  buttons[0].click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector("#recovery").open, true);
  assert.match(dom.window.document.querySelector("#message").textContent, /Account settings/);
});

test("OAuth success query cannot bypass an outstanding Passkey check", async t => {
  const dom = makeDom({ authenticated: false, stepUpRequired: true, providers: {
    passkey: { available: true }, google: { configured: true, linked: true }
  } }, "?signin=success");
  t.after(() => dom.window.close());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([...dom.window.document.querySelectorAll("#providers button")].map(button => button.dataset.provider), ["passkey"]);
  assert.equal(dom.window.document.querySelector("#recovery").hidden, true);
  assert.match(dom.window.document.querySelector("#message").textContent, /additional Passkey check/);
});

test("local recovery sign-in that still needs a Passkey stays on login and offers only the Passkey check", async t => {
  const dom = new JSDOM(source, { url: "https://devmoter.test/login.html", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const providers = { passkey: { available: true }, github: { configured: true, linked: true }, google: { configured: true, linked: true } };
  const requests = [];
  let signedIn = false;
  dom.window.fetch = async (path, init = {}) => {
    requests.push([init.method || "GET", path]);
    if (path === "/api/auth/local/login") { signedIn = true; return { ok: true, async json() { return { ok: true }; } }; }
    assert.equal(path, "/api/auth/status");
    const status = signedIn
      ? { authenticated: false, ownerAuthenticated: true, stepUpRequired: true, providers }
      : { authenticated: false, providers };
    return { ok: true, async json() { return status; } };
  };
  const redirects = [];
  dom.window.eval(scriptSource.replace(/location\.replace\(/g, "__redirect(").replace(/^/, "const __redirect = target => window.__redirects.push(target);\n"));
  dom.window.__redirects = redirects;
  await new Promise(resolve => setTimeout(resolve, 0));
  const document = dom.window.document;
  document.querySelector("#password").value = "recovery-secret";
  document.querySelector("#localLogin").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests.map(([method, path]) => `${method} ${path}`), ["GET /api/auth/status", "POST /api/auth/local/login", "GET /api/auth/status"]);
  assert.deepEqual(redirects, [], "a step-up session must not redirect into the app (and bounce back)");
  assert.equal(document.querySelector("#password").value, "", "the recovery password is cleared after use");
  assert.deepEqual([...document.querySelectorAll("#providers button")].map(button => button.dataset.provider), ["passkey"]);
  assert.match(document.querySelector("#message").textContent, /additional Passkey check/);
});

test("login screen hides all unconfigured providers and keeps recovery collapsed", async t => {
  const dom = makeDom({ authenticated: false, providers: {
    passkey: { available: false }, github: { configured: false }, google: { configured: false }, microsoft: { configured: false }
  } });
  t.after(() => dom.window.close());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelectorAll("#providers button").length, 0);
  assert.equal(dom.window.document.querySelector("#recovery").open, false);
  assert.match(dom.window.document.querySelector("#message").textContent, /local recovery/i);
});

test("recovery and responsive/accessibility UI avoid setup secrets and horizontal fixed widths", () => {
  const document = new JSDOM(source).window.document;
  assert.equal(document.querySelector("#username").value, "devmoter");
  assert.equal(document.querySelector("#recovery").open, false);
  assert.equal(/DEVMOTER_[A-Z0-9_]+/.test(document.body.textContent), false);
  assert.equal(/Apple|Coming soon/.test(document.body.textContent), false);
  assert.match(source, /safe-area-inset/);
  assert.match(source, /prefers-color-scheme:\s*dark/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /:focus-visible/);
  assert.match(source, /min-height:\s*48px/);
  assert.match(source, /max-width:\s*340px/);
});
