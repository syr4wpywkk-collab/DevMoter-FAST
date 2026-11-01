import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function response(payload = {}, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function harness({ githubLinked = true } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://devmoter.example/" });
  const calls = [];
  const window = dom.window;
  window.open = () => null;
  window.confirm = () => true;
  const fetch = async (path, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ path: String(path), method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/api/auth/status") return response({ authenticated: true, identity: { provider: "local", login: "devmoter" } });
    if (path === "/api/system/diagnostics") return response({});
    if (path === "/api/auth/account") return response({
      ownerId: "3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c",
      providers: {
        github: { configured: true, linked: githubLinked, identity: { login: "dev-owner" } },
        google: { configured: true, linked: false, identity: null },
        microsoft: { configured: false, linked: false, identity: null }
      },
      passkey: { available: true },
      localRecovery: true,
      sessions: [
        { id: "current-session", current: true, provider: "google", host: "devmoter.example", createdAt: Date.parse("2026-01-01T00:00:00Z"), lastUsedAt: Date.parse("2026-01-02T00:00:00Z"), expiresAt: Date.parse("2026-02-01T00:00:00Z") },
        { id: "old-session", current: false, provider: "github", identity: { login: "old-device" }, host: "old.example", createdAt: "2025-01-01T00:00:00Z", lastUsedAt: "2025-01-02T00:00:00Z", expiresAt: "2025-02-01T00:00:00Z" }
      ]
    });
    if (path === "/api/auth/github/start") return response({
      flowId: "flow-1", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", interval: 1, expiresIn: 300
    });
    if (path === "/api/auth/github/poll") return response({ status: "pending", retryAfterMs: 60000 });
    return response({});
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: () => ({}),
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    localStorage: window.localStorage,
    Headers,
    fetch,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "test-op" },
    CustomEvent: window.CustomEvent,
    matchMedia: () => ({ matches: true }),
    atob,
    URL
  });
  exports.mountSettingsPanel();
  window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "account" } }));
  return { dom, window, calls, root: window.document.querySelector(".devmoter-settings-root") };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

test("account page shows configured sign-in methods, recovery, passkey and safe session details", async () => {
  const { dom, root } = harness();
  try {
    await flush();
    await flush();
    const scroll = root.querySelector(".devmoter-settings-scroll");
    assert.match(scroll.textContent, /GitHub/);
    assert.match(scroll.textContent, /dev-owner/);
    assert.match(scroll.textContent, /Google/);
    assert.match(scroll.textContent, /Microsoft/);
    assert.match(scroll.textContent, /パスキー/);
    assert.match(scroll.textContent, /ローカル復旧/);
    assert.match(scroll.textContent, /old.example/);
    assert.ok(scroll.textContent.includes(new Date("2026-01-01T00:00:00Z").toLocaleString()));
    assert.equal(scroll.querySelector('[data-action="account:connect"][data-provider="google"]').disabled, false);
    // A provider this host cannot use offers its setup guide as a button, not a disabled connect button.
    assert.equal(scroll.querySelector('[data-action="account:connect"][data-provider="microsoft"]'), null);
    const guides = scroll.querySelectorAll('a[href*="docs/auth-v2.md"]');
    assert.equal(guides.length, 1);
    assert.equal(guides[0].className, "devmoter-settings-link-button");
    assert.equal(guides[0].getAttribute("rel"), "noopener noreferrer");
    assert.equal(guides[0].textContent, "セットアップ案内");
    assert.equal(scroll.querySelector('[data-action="account:revoke-session"][data-session-id="old-session"]').textContent, "解除");
    assert.equal(scroll.querySelector('[data-action="account:revoke-session"][data-session-id="current-session"]'), null);
    assert.doesNotMatch(scroll.textContent, /Coming soon|Apple|DEVMOTER_/);
  } finally {
    dom.window.close();
  }
});

test("owner ID is shortened for display and the copy button copies the full ID", async () => {
  const { dom, root, window } = harness();
  try {
    await flush();
    await flush();
    const profile = root.querySelector(".devmoter-settings-profile.detail");
    assert.match(profile.textContent, /オーナーID\s*3f2b9c1e…8b9c/);
    assert.doesNotMatch(profile.textContent, /DevMoter owner|7a4d-4e8b/);
    assert.equal(profile.querySelector(".devmoter-settings-mono").getAttribute("title"), "3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c");
    let copied = "";
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async text => { copied = text; } } });
    profile.querySelector('[data-action="account:copy-owner"]').click();
    await flush();
    assert.equal(copied, "3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c");
    assert.equal(root.querySelector(".devmoter-settings-toast").textContent, "オーナーIDをコピーしました。");
  } finally {
    dom.window.close();
  }
});

test("GitHub account link starts the device flow and keeps its code inside the account UI", async () => {
  const { dom, root, calls } = harness({ githubLinked: false });
  try {
    await flush();
    root.querySelector('[data-action="account:connect"][data-provider="github"]').click();
    await flush();
    await flush();
    assert.ok(calls.some(call => call.path === "/api/auth/github/start" && call.method === "POST" && call.body.intent === "link"));
    assert.ok(calls.some(call => call.path === "/api/auth/github/poll" && call.method === "POST" && call.body.flowId === "flow-1"));
    assert.match(root.querySelector(".devmoter-settings-scroll").textContent, /ABCD-EFGH/);
    root.querySelector('[data-action="account:github-cancel"]').click();
    await flush();
    assert.doesNotMatch(root.querySelector(".devmoter-settings-scroll").textContent, /ABCD-EFGH/);
  } finally {
    dom.window.close();
  }
});

test("account disconnect and session revoke actions call owner account endpoints", async () => {
  const { dom, root, calls } = harness();
  try {
    await flush();
    root.querySelector('[data-action="account:disconnect"][data-provider="github"]').click();
    await flush();
    root.querySelector('[data-action="account:revoke-session"][data-session-id="old-session"]').click();
    await flush();
    root.querySelector('[data-action="account:revoke-others"]').click();
    await flush();
    assert.ok(calls.some(call => call.path === "/api/auth/providers/github/disconnect" && call.method === "POST"));
    assert.ok(calls.some(call => call.path === "/api/auth/sessions/old-session" && call.method === "DELETE"));
    assert.ok(calls.some(call => call.path === "/api/auth/sessions/revoke-others" && call.method === "POST"));
  } finally {
    dom.window.close();
  }
});
