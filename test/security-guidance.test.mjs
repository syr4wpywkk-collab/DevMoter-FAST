import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createSystemFeatures } from "../server/system-features.mjs";
import { CLIENT_ORIGIN_HEADER, diagnosePublicOrigin } from "../server/origin-diagnostics.mjs";
import { parseTrustedProxies } from "../server/auth.mjs";
import { DICTIONARIES } from "../src/i18n-core.mjs";
import { createDeviceGate, deviceAuthReason, isDeviceAuthError, noteDeviceTrustChange } from "../src/device-gate.mjs";
import { SECRET_KINDS, detectSecretKinds, startPasteSecretGuard } from "../src/paste-secret-guard.mjs";

function request({ token = "", host = "127.0.0.1:8787", headers = {} } = {}) {
  return {
    headers: { host, ...(token ? { "x-devmoter-device-token": token } : {}), ...headers },
    socket: { remoteAddress: "127.0.0.1" }
  };
}

async function features(t, options = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-security-guidance-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return {
    stateDir,
    system: createSystemFeatures({
      stateDir,
      appRoot: process.cwd(),
      version: "test",
      getProjects: async () => [],
      getBackendHealth: async () => ({ opencode: { online: true }, codex: { online: true } }),
      ...options
    })
  };
}

// #474
test("device list reports only a stored last-used time, and null when none was recorded", async t => {
  const { system, stateDir } = await features(t);
  const first = await system.bootstrapDevice(request(), "Laptop");
  const pairing = await system.createPairing(request({ token: first.token }));
  await system.claimPairing(pairing.code, "Phone");

  const file = join(stateDir, "devices.json");
  const stored = JSON.parse(await readFile(file, "utf8"));
  const list = Array.isArray(stored) ? stored : stored.devices;
  const phone = list.find(device => device.label === "Phone");
  delete phone.lastUsedAt;
  await writeFile(file, JSON.stringify(stored));

  const { devices } = await system.listDevices(request({ token: first.token }));
  const laptop = devices.find(device => device.label === "Laptop");
  assert.equal(typeof laptop.lastUsedAt, "number");
  assert.equal(devices.find(device => device.label === "Phone").lastUsedAt, null);
  assert.ok(devices.every(device => !("tokenHash" in device) && !("token" in device)));

  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  assert.ok(settings.includes("lastUsed: deviceLastUsedLabel(device.lastUsedAt)"));
  assert.match(settings, /function deviceLastUsedLabel[\s\S]{0,260}t\("common\.unknown"\)/);
});

// #475
test("revoking a trusted device asks for confirmation naming the device before the DELETE", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const start = settings.indexOf('if (action === "device:revoke")');
  const body = settings.slice(start, settings.indexOf("return;", settings.indexOf("catch", start)));
  const confirmAt = body.indexOf("window.confirm(");
  const deleteAt = body.indexOf('method: "DELETE"');
  assert.ok(confirmAt > 0 && deleteAt > confirmAt, "confirmation precedes the request");
  assert.match(body, /if \(!window\.confirm\([\s\S]*?\)\)\) return;/);
  assert.ok(body.includes("button.dataset.deviceLabel"));
  for (const dictionary of Object.values(DICTIONARIES)) {
    for (const key of ["settings.devices.confirmRevoke", "settings.devices.confirmRevokeCurrent"]) {
      assert.ok(dictionary[key].includes("{label}") && dictionary[key].includes("{lastUsed}"));
    }
  }
});

// #476
test("secret formats are detected by kind and the value is never returned", () => {
  // Fake samples, assembled from pieces so the repository secret scan
  // (scripts/security-audit.mjs) does not read this file as a leak.
  const samples = {
    privateKey: `-----BEGIN OPENSSH ${"PRIVATE"} KEY-----\nabc\n-----END OPENSSH ${"PRIVATE"} KEY-----`,
    awsAccessKey: `key ${"AKIA"}IOSFODNN7EXAMPLE here`,
    githubToken: `ghp_${"a1B2".repeat(9)}`,
    slackToken: `${"xox"}b-1234567890-abcdefghij`,
    googleApiKey: `AIza${"x".repeat(35)}`,
    stripeKey: `sk_live_${"9".repeat(24)}`,
    apiKey: `sk-proj-${"Zz9".repeat(10)}`,
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlMTIz",
    credentialUrl: "postgres://admin:hunter2pass@db.internal:5432/app",
    assignedSecret: 'DB_PASSWORD="correct-horse-battery"'
  };
  assert.deepEqual(Object.keys(samples).sort(), [...SECRET_KINDS].sort());
  for (const [kind, sample] of Object.entries(samples)) {
    const kinds = detectSecretKinds(sample);
    assert.ok(kinds.includes(kind), kind);
    assert.ok(kinds.every(found => SECRET_KINDS.includes(found)));
  }
  for (const plain of ["", "const total = items.length;", "password を変更したい", "https://example.com/docs?page=2", "skip-this-step"]) {
    assert.deepEqual(detectSecretKinds(plain), [], plain);
  }
});

test("a suspicious paste shows a local warning without blocking, logging or sending it", async () => {
  const dom = new JSDOM('<!doctype html><body><textarea id="composer"></textarea><input id="pw" type="password"></body>', { url: "http://localhost/" });
  const { window } = dom;
  const secret = `ghp_${"a1B2".repeat(9)}`;
  const calls = [];
  window.fetch = (...args) => { calls.push(args); return Promise.resolve(); };
  const originalConsole = { ...console };
  for (const method of ["log", "info", "warn", "error", "debug"]) console[method] = (...args) => calls.push(args);
  const stop = startPasteSecretGuard(window.document);

  function paste(target, text) {
    const event = new window.Event("paste", { bubbles: true, cancelable: true });
    event.clipboardData = { getData: type => (type === "text/plain" ? text : "") };
    target.dispatchEvent(event);
    return event;
  }

  try {
    const event = paste(window.document.querySelector("#composer"), `token: ${secret}`);
    assert.equal(event.defaultPrevented, false, "the paste itself goes through");
    const notice = window.document.querySelector("[data-paste-secret-warning]");
    assert.ok(notice);
    assert.equal(notice.getAttribute("role"), "alert");
    assert.ok(notice.dataset.pasteSecretWarning.split(" ").includes("githubToken"));
    assert.ok(!window.document.documentElement.outerHTML.includes(secret), "value is not placed in the DOM");
    assert.deepEqual(calls, []);
    assert.equal(window.localStorage.length, 0);

    paste(window.document.querySelector("#composer"), "just some notes");
    assert.equal(window.document.querySelector("[data-paste-secret-warning]"), null);

    paste(window.document.querySelector("#pw"), secret);
    assert.equal(window.document.querySelector("[data-paste-secret-warning]"), null, "password fields are exempt");

    paste(window.document.querySelector("#composer"), secret);
    window.document.querySelector("[data-paste-secret-dismiss]").click();
    assert.equal(window.document.querySelector("[data-paste-secret-warning]"), null);

    stop();
    paste(window.document.querySelector("#composer"), secret);
    assert.equal(window.document.querySelector("[data-paste-secret-warning]"), null);
  } finally {
    Object.assign(console, originalConsole);
    dom.window.close();
  }

  const source = await readFile(new URL("../src/paste-secret-guard.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|console\.|localStorage|sessionStorage/);
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(main.includes("startPasteSecretGuard(document);"));
});

// #477
test("public Origin diagnosis names the mismatch without echoing any origin", async t => {
  const browser = origin => ({ [CLIENT_ORIGIN_HEADER]: origin });
  const cases = [
    [request({ headers: browser("http://127.0.0.1:8787") }), "", { status: "ok", configured: false, differs: [], writesBlocked: false }],
    [request({ headers: browser("https://pocket.example.test") }), "", { status: "proxy-mismatch", differs: ["scheme", "host", "port"], writesBlocked: true }],
    [request({ headers: { ...browser("https://pocket.example.test"), "x-forwarded-proto": "https", "x-forwarded-host": "pocket.example.test" } }), "", { status: "ok", forwardedHeaders: true }, { trustedProxies: parseTrustedProxies("127.0.0.1") }],
    // Forwarded headers from a proxy that is not trusted are ignored, as the mutation guard does.
    [request({ headers: { ...browser("https://pocket.example.test"), "x-forwarded-proto": "https", "x-forwarded-host": "pocket.example.test" } }), "", { status: "proxy-mismatch", writesBlocked: true }, { trustedProxies: parseTrustedProxies("") }],
    [request({ headers: browser("https://pocket.example.test") }), "https://pocket.example.test", { status: "ok", configured: true }],
    [request({ headers: browser("https://pocket.example.test") }), "http://pocket.example.test", { status: "configured-mismatch", differs: ["scheme", "port"], writesBlocked: true }],
    [request({ headers: browser("https://pocket.example.test") }), "https://internal-host.corp.test:9443", { status: "configured-mismatch", differs: ["host", "port"] }],
    [request({ headers: browser("https://pocket.example.test") }), "not a url", { status: "invalid", writesBlocked: true }],
    [request(), "https://pocket.example.test", { status: "unverified", writesBlocked: false }],
    [request({ headers: browser("javascript:alert(1)") }), "", { status: "unverified" }]
  ];
  for (const [req, configured, expected, options] of cases) {
    const result = diagnosePublicOrigin(req, configured, options);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(result[key], value, `${configured} ${key}`);
    assert.deepEqual(Object.keys(result).sort(), ["configured", "differs", "forwardedHeaders", "status", "writesBlocked"]);
    assert.doesNotMatch(JSON.stringify(result), /example\.test|corp\.test|127\.0\.0\.1|not a url/);
  }

  const { system } = await features(t, { publicOrigin: "https://internal-host.corp.test:9443" });
  const device = await system.bootstrapDevice(request(), "Laptop");
  const report = await system.diagnostics(request({ token: device.token, headers: browser("https://pocket.example.test") }));
  assert.equal(report.publicOrigin.status, "configured-mismatch");
  assert.doesNotMatch(JSON.stringify(report), /internal-host|pocket\.example/);

  const source = await readFile(new URL("../server/origin-diagnostics.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|writeFile|\.env\b.*=/);
});

// #478
test("gate explains a revoked registration, recognises localized refusals, and never reads the token", async () => {
  assert.equal(deviceAuthReason(new Error("Invalid or revoked device token")), "revoked");
  assert.equal(deviceAuthReason(new Error("Trusted device has been revoked.")), "revoked");
  assert.equal(deviceAuthReason(new Error("Trusted device token required")), "unregistered");
  for (const dictionary of Object.values(DICTIONARIES)) {
    assert.ok(isDeviceAuthError(new Error(dictionary["errors.server.trustedDeviceRequired"]), 401));
    assert.ok(isDeviceAuthError(new Error(dictionary["errors.server.trustedDeviceRevoked"]), 401));
    assert.equal(deviceAuthReason(new Error(dictionary["errors.server.trustedDeviceRevoked"])), "revoked");
    assert.equal(isDeviceAuthError(new Error(dictionary["errors.server.trustedDeviceRequired"]), 500), false);
  }

  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
  const { document } = dom.window;
  dom.window.localStorage.setItem("devmoter-device-token", "tok-should-never-appear");
  const revoked = createDeviceGate(document, { error: new Error("Invalid or revoked device token") });
  assert.equal(revoked.dataset.deviceGateCause, "revoked");
  assert.equal(revoked.querySelector("strong").textContent, DICTIONARIES.en["deviceGate.revokedTitle"]);
  assert.equal(revoked.querySelector("small").textContent, DICTIONARIES.en["deviceGate.revokedCopy"]);
  const compact = createDeviceGate(document, { compact: true, error: new Error("Trusted device token required") });
  assert.equal(compact.querySelector("[data-device-gate-cause]").dataset.deviceGateCause, "unregistered");
  assert.ok(compact.querySelector("[data-device-gate-register]"));
  document.body.append(revoked, compact);
  assert.ok(!document.documentElement.outerHTML.includes("tok-should-never-appear"));
  dom.window.close();

  const source = await readFile(new URL("../src/device-gate.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /devmoter-device-token|x-devmoter-device-token/);
});

test("after this browser revokes itself the gate still says revoked, until it is registered again", async () => {
  const stored = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: key => (stored.has(key) ? stored.get(key) : null),
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: key => stored.delete(key)
    }
  });
  try {
    const tokenless = new Error("Trusted device token required");
    assert.equal(deviceAuthReason(tokenless), "unregistered");
    noteDeviceTrustChange({ revokedCurrent: false });
    assert.equal(deviceAuthReason(tokenless), "unregistered", "revoking another device changes nothing here");
    noteDeviceTrustChange({ revokedCurrent: true });
    assert.equal(deviceAuthReason(tokenless), "revoked");
    assert.deepEqual([...stored.values()], ["1"], "only a flag is stored");
    noteDeviceTrustChange({ trusted: true });
    assert.equal(deviceAuthReason(tokenless), "unregistered");
    assert.equal(stored.size, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }

  for (const file of ["../src/settings.ts", "../src/system-panel.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes('detail: { action: "revoke", revokedCurrent }'), file);
    assert.match(source, /if \(!window\.confirm\([\s\S]*?\)\)\) return;\s+try \{\s+const result = await request\(`\/api\/devices\//, file);
  }
  const gateSource = await readFile(new URL("../src/device-gate.mjs", import.meta.url), "utf8");
  assert.ok(gateSource.includes('addEventListener?.("devmoter:device-trust-changed"'));
  const control = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
  assert.ok(control.includes('deviceAuthReason(error) === "revoked" ? undefined : t("deviceGate.toolsLockedCopy"'));
});
