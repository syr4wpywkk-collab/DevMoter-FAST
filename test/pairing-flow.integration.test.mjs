import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as i18nCore from "../src/i18n-core.mjs";
import * as deviceGate from "../src/device-gate.mjs";
import * as sheetHeader from "../src/sheet-header.mjs";
import { createSystemFeatures } from "../server/system-features.mjs";
import { describeHealthFetch, formatBuildId, formatNodeVersion } from "../src/diagnostics-format.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "pairing-flow-integration-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

const settingsCompiled = ts.transpileModule(
  await readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

const controlCenterCompiled = ts.transpileModule(
  await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => (error ? reject(error) : resolve())));
  return port;
}

async function waitForReady(child, timeoutMs = 8000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not become ready: ${output}`)), timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}: ${output}`));
    });
  });
}

function makeI18n(lang = "ja") {
  return {
    ...i18nCore,
    getLanguage: () => lang,
    t: (k, p) => i18nCore.translate(lang, k, p),
    translateServerMessage: m => i18nCore.translateServerMessage(m, lang),
    formatDateTime: (v, o) => i18nCore.formatDateTime(v, o, lang),
    formatTime: (v, o) => i18nCore.formatTime(v, o, lang),
    formatNumber: (v, o) => i18nCore.formatNumber(v, o, lang),
    formatRelativeTime: (tsValue, nowValue) => i18nCore.formatRelativeTime(tsValue, nowValue, lang),
    tApp: (id, f) => i18nCore.tApp(id, f, lang)
  };
}

function jsonResponse(payload = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

async function waitFor(predicate, label = "condition", timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("live server reflects trusted device state, supports local recovery pairing to terminal access, and blocks remote password-only recovery", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-pairing-flow-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);

    // Browser A bootstraps the first trusted device on localhost.
    const bootstrapA = await fetch(`${origin}/api/devices/bootstrap`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "op-bootstrap-a"
      },
      body: JSON.stringify({ label: "First Browser" })
    });
    assert.equal(bootstrapA.status, 201);
    const cookieA = bootstrapA.headers.get("set-cookie")?.split(";")[0] || "";
    assert.match(cookieA, /^devmoter_device=/);

    // Browser B arrives without a device cookie on localhost: server reports real state without allowing second bootstrap.
    const diagB = await fetch(`${origin}/api/system/diagnostics`, { headers: { authorization } });
    assert.equal(diagB.status, 200);
    const diagPayloadB = await diagB.json();
    assert.equal(diagPayloadB.deviceSecurity.trustedDevices, 1);
    assert.equal(diagPayloadB.deviceSecurity.currentTrusted, false);
    assert.equal(diagPayloadB.deviceSecurity.localBootstrap, true);
    assert.equal(diagPayloadB.deviceSecurity.bootstrapAvailable, false);
    assert.equal(diagPayloadB.deviceSecurity.canIssuePairing, true);
    assert.equal(diagPayloadB.deviceSecurity.canRevokeDevices, true);
    assert.equal(diagPayloadB.deviceSecurity.devices.length, 1);
    assert.equal(diagPayloadB.deviceSecurity.devices[0].label, "First Browser");
    assert.equal(Object.hasOwn(diagPayloadB.deviceSecurity.devices[0], "tokenHash"), false);

    // Second bootstrap is rejected with 409 and translates via i18n across all 4 locales.
    const rejectedBootstrap = await fetch(`${origin}/api/devices/bootstrap`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "op-bootstrap-b"
      },
      body: JSON.stringify({ label: "Second Browser" })
    });
    assert.equal(rejectedBootstrap.status, 409);
    const rejectedPayload = await rejectedBootstrap.json();
    assert.equal(rejectedPayload.error, "A trusted device already exists; use pairing instead");
    for (const lang of ["ja", "en", "zh-Hans", "zh-Hant"]) {
      const translated = i18nCore.translateServerMessage(rejectedPayload.error, lang);
      assert.notEqual(translated, rejectedPayload.error);
      assert.equal(translated, i18nCore.DICTIONARIES[lang]["errors.server.trustedDeviceAlreadyExists"]);
    }

    // Without a trusted cookie, terminal access remains denied.
    const deniedTerminal = await fetch(`${origin}/api/terminal/sessions`, { headers: { authorization } });
    assert.equal(deniedTerminal.status, 403);

    // Remote/proxied password-only client (x-forwarded-for) cannot issue codes, revoke devices, or bootstrap.
    const remoteDiag = await fetch(`${origin}/api/system/diagnostics`, {
      headers: { authorization, "x-forwarded-for": "203.0.113.42" }
    });
    assert.equal(remoteDiag.status, 200);
    const remoteDiagPayload = await remoteDiag.json();
    assert.equal(remoteDiagPayload.deviceSecurity.localBootstrap, false);
    assert.equal(remoteDiagPayload.deviceSecurity.bootstrapAvailable, false);
    assert.equal(remoteDiagPayload.deviceSecurity.canIssuePairing, false);
    assert.equal(remoteDiagPayload.deviceSecurity.canRevokeDevices, false);
    assert.equal(remoteDiagPayload.deviceSecurity.devices.length, 1);

    const remoteCreatePairing = await fetch(`${origin}/api/pairings`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "x-forwarded-for": "203.0.113.42",
        "x-pocket-operation-id": "op-remote-pair"
      }
    });
    assert.equal(remoteCreatePairing.status, 401);

    const remoteRevoke = await fetch(`${origin}/api/devices/${encodeURIComponent(diagPayloadB.deviceSecurity.devices[0].id)}`, {
      method: "DELETE",
      headers: {
        authorization,
        origin,
        "x-forwarded-for": "203.0.113.42",
        "x-pocket-operation-id": "op-remote-revoke"
      }
    });
    assert.equal(remoteRevoke.status, 401);

    // Local recovery issues a short-lived single-use 6-digit pairing code and claims it on Browser B.
    const issuedPairing = await fetch(`${origin}/api/pairings`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "x-pocket-operation-id": "op-local-issue"
      }
    });
    assert.equal(issuedPairing.status, 201);
    const pairingPayload = await issuedPairing.json();
    assert.match(String(pairingPayload.code), /^\d{6}$/);
    assert.ok(pairingPayload.expiresAt > Date.now());

    const claimed = await fetch(`${origin}/api/pairings/claim`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "op-local-claim"
      },
      body: JSON.stringify({ code: pairingPayload.code, label: "Recovered Browser" })
    });
    assert.equal(claimed.status, 201);
    const setCookieB = claimed.headers.get("set-cookie") || "";
    assert.match(setCookieB, /^devmoter_device=/);
    assert.match(setCookieB, /HttpOnly/);
    assert.match(setCookieB, /SameSite=Strict/);
    const cookieB = setCookieB.split(";")[0];

    // Pairing code is single-use.
    const replayClaim = await fetch(`${origin}/api/pairings/claim`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "op-local-claim-replay"
      },
      body: JSON.stringify({ code: pairingPayload.code, label: "Replay" })
    });
    assert.equal(replayClaim.status, 400);

    // With the paired device cookie, terminal permission succeeds.
    const grantedTerminal = await fetch(`${origin}/api/terminal/sessions`, {
      headers: { authorization, cookie: cookieB }
    });
    assert.equal(grantedTerminal.status, 200);

    // Revoking all trusted devices returns localhost bootstrap availability accurately.
    const afterClaimDiag = await (await fetch(`${origin}/api/system/diagnostics`, {
      headers: { authorization, cookie: cookieB }
    })).json();
    assert.equal(afterClaimDiag.deviceSecurity.trustedDevices, 2);
    assert.equal(afterClaimDiag.deviceSecurity.currentTrusted, true);
    for (const dev of afterClaimDiag.deviceSecurity.devices) {
      const revoked = await fetch(`${origin}/api/devices/${encodeURIComponent(dev.id)}`, {
        method: "DELETE",
        headers: {
          authorization,
          origin,
          cookie: cookieB,
          "x-pocket-operation-id": `op-revoke-${dev.id}`
        }
      });
      assert.equal(revoked.status, 200);
    }
    const zeroDiag = await (await fetch(`${origin}/api/system/diagnostics`, {
      headers: { authorization }
    })).json();
    assert.equal(zeroDiag.deviceSecurity.trustedDevices, 0);
    assert.equal(zeroDiag.deviceSecurity.bootstrapAvailable, true);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await rm(home, { recursive: true, force: true });
  }
});

test("Trusted Devices screen completes code issuance -> entry -> trust -> terminal permission with consistent server state and i18n", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-pairing-ui-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const features = createSystemFeatures({
    stateDir,
    host: "127.0.0.1",
    version: "test",
    getProjects: async () => [{ id: "p1", name: "Repo", path: stateDir }],
    getBackendHealth: async () => ({})
  });

  // Seed one previously registered trusted device (lost cookie scenario).
  await features.bootstrapDevice(
    { headers: { host: "127.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } },
    "Previous Browser"
  );

  let currentDeviceToken = "";
  let remoteMode = false;
  const launchedApps = [];
  const copiedTexts = [];

  const serverReq = () => (remoteMode
    ? {
        headers: {
          host: "devmoter.example",
          "x-forwarded-for": "203.0.113.5",
          ...(currentDeviceToken ? { cookie: `devmoter_device=${currentDeviceToken}` } : {})
        },
        socket: { remoteAddress: "10.0.0.5" }
      }
    : {
        headers: {
          host: "localhost",
          ...(currentDeviceToken ? { cookie: `devmoter_device=${currentDeviceToken}` } : {})
        },
        socket: { remoteAddress: "127.0.0.1" }
      });

  const dom = new JSDOM("<!doctype html><main><button>Background</button></main>", {
    url: "http://localhost/"
  });
  const { window } = dom;
  window.scrollTo = () => {};
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async text => {
        copiedTexts.push(text);
      }
    }
  });
  window.addEventListener("devmoter:launch-app", event => {
    launchedApps.push(event.detail);
  });

  const fetchImpl = async (path, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const req = serverReq();
    try {
      if (path === "/api/auth/status") return jsonResponse({ authenticated: true, identity: { provider: "local", login: "owner" } });
      if (path === "/api/cli") return jsonResponse({ clis: [] });
      if (path === "/api/projects") return jsonResponse({ projects: [{ id: "p1", name: "Repo" }] });
      if (path === "/api/system/diagnostics") {
        return jsonResponse(await features.diagnostics(req, { ownerRecovery: !remoteMode }));
      }
      if (path === "/api/devices" && method === "GET") {
        return jsonResponse(await features.listDevices(req));
      }
      if (path === "/api/devices/bootstrap" && method === "POST") {
        const issued = await features.bootstrapDevice(req, body.label);
        currentDeviceToken = issued.token;
        return jsonResponse({ device: issued.device }, 201);
      }
      if (path === "/api/pairings" && method === "POST") {
        return jsonResponse(await features.createPairing(req, { allowOwnerRecovery: !remoteMode }), 201);
      }
      if (path === "/api/pairings/claim" && method === "POST") {
        const claimed = await features.claimPairing(body.code, body.label, req);
        currentDeviceToken = claimed.token;
        return jsonResponse({ device: claimed.device }, 201);
      }
      if (path.startsWith("/api/devices/") && method === "DELETE") {
        const id = decodeURIComponent(path.slice("/api/devices/".length));
        return jsonResponse(await features.revokeDevice(req, id, { allowOwnerRecovery: !remoteMode }));
      }
      if (path === "/api/terminal/sessions" && method === "GET") {
        try {
          await features.authenticate(req);
        } catch {
          return jsonResponse({ error: "A trusted device is required for terminal access." }, 403);
        }
        return jsonResponse({ sessions: [] });
      }
      return jsonResponse({});
    } catch (error) {
      return jsonResponse({ error: error.message }, Number(error.status || 400));
    }
  };

  window.fetch = fetchImpl;
  const jaI18n = makeI18n("ja");
  const ccExports = {};
  vm.runInNewContext(controlCenterCompiled, {
    exports: ccExports,
    module: { exports: ccExports },
    require: name => {
      if (name === "./device-gate.mjs") return deviceGate;
      if (name === "./sheet-header.mjs") return sheetHeader;
      if (name === "./i18n") return jaI18n;
      if (name === "@xterm/xterm") return { Terminal: class {} };
      if (name === "@xterm/addon-fit") return { FitAddon: class {} };
      return {};
    },
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLDivElement: window.HTMLDivElement,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    fetch: fetchImpl,
    Headers,
    crypto: window.crypto,
    btoa: window.btoa.bind(window),
    location: window.location,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    setTimeout,
    clearTimeout,
    URL
  });

  const settingsExports = {};
  vm.runInNewContext(settingsCompiled, {
    exports: settingsExports,
    require: name => {
      if (name === "./i18n") return jaI18n;
      if (name === "./diagnostics-format.mjs") return { describeHealthFetch, formatBuildId, formatNodeVersion };
      if (name === "./push-readiness.js") return { boundedPushWait: async () => null, inspectPushReadiness: async () => ({ state: "unsupported" }) };
      return {};
    },
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    localStorage: window.localStorage,
    Headers,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "ui-op-id" },
    CustomEvent: window.CustomEvent,
    matchMedia: () => ({ matches: true }),
    atob,
    URL
  });

  ccExports.mountControlCenter();
  settingsExports.mountSettingsPanel();

  // Initially Terminal is blocked behind the Trusted Device Gate.
  window.document.querySelector(".dm-tools-launcher").click();
  const initialGate = await waitFor(
    () => window.document.querySelector("[data-terminal-device-gate]"),
    "terminal device gate"
  );
  assert.ok(initialGate, "Terminal tab shows trusted device gate before pairing");

  // Click the gate CTA to jump straight to Settings -> Trusted Devices.
  initialGate.querySelector("button").click();
  await waitFor(
    () => window.document.querySelector("[data-device-status]"),
    "settings trusted devices screen"
  );

  const settingsScroll = window.document.querySelector(".devmoter-settings-scroll");
  assert.equal(window.document.querySelector("[data-device-status]").textContent, i18nCore.DICTIONARIES.ja["settings.devices.unregistered"]);
  assert.equal(window.document.querySelector("[data-terminal-permission]").textContent, i18nCore.DICTIONARIES.ja["settings.devices.terminalLocked"]);
  assert.equal(window.document.querySelector('[data-action="device:bootstrap"]'), null, "Bootstrap button must not appear when a trusted device already exists");
  assert.ok(!settingsScroll.textContent.includes("最初の信頼済み端末として登録できます"));
  assert.ok(!settingsScroll.textContent.includes("登録済み端末はありません"));
  assert.ok(settingsScroll.textContent.includes("Previous Browser"), "Existing trusted device from server state must be listed");
  assert.ok(settingsScroll.textContent.includes("すでに信頼済み端末が 1 台登録されています"));

  // Check there is no hardcoded English anywhere in the visible Japanese UI text.
  const pageText = settingsScroll.textContent;
  for (const englishLeak of ["Trusted device", "Pairing code", "Use pairing", "Not registered", "Ready to use", "Open Terminal"]) {
    assert.ok(!pageText.includes(englishLeak), `Unexpected English text in ja UI: ${englishLeak}`);
  }

  // Step 1: Issue pairing code inside this screen.
  const issueBtn = window.document.querySelector('[data-action="device:create-code"]');
  assert.ok(issueBtn, "Code issuance button must be offered in-screen");
  issueBtn.click();

  const codeEl = await waitFor(
    () => window.document.querySelector("[data-issued-pairing-code]"),
    "issued pairing code box"
  );
  const issuedCode = codeEl.textContent.trim();
  assert.match(issuedCode, /^\d{6}$/);
  assert.equal(window.location.search, "");
  assert.equal(window.location.hash, "");

  window.document.querySelector('[data-action="device:copy-code"]').click();
  await waitFor(() => copiedTexts.length === 1, "copied pairing code");
  assert.deepEqual(copiedTexts, [issuedCode]);

  // Verify wrong pairing code surfaces translated error toast (not raw English).
  const input = window.document.querySelector("[data-pair-code]");
  input.value = issuedCode === "000000" ? "999999" : "000000";
  window.document.querySelector('[data-action="device:claim"]').click();
  const errorToast = await waitFor(
    () => {
      const text = window.document.querySelector(".devmoter-settings-toast")?.textContent || "";
      return text === i18nCore.DICTIONARIES.ja["errors.server.pairingCodeInvalid"] ? text : null;
    },
    "translated invalid pairing code toast"
  );
  assert.equal(errorToast, i18nCore.DICTIONARIES.ja["errors.server.pairingCodeInvalid"]);

  // Step 2 & 3: Enter issued code into input and claim trust.
  input.value = issuedCode;
  window.document.querySelector('[data-action="device:claim"]').click();

  await waitFor(
    () => window.document.querySelector("[data-device-status]")?.textContent === i18nCore.DICTIONARIES.ja["settings.devices.trusted"],
    "trusted status update"
  );
  assert.equal(window.document.querySelector("[data-issued-pairing]"), null, "Used pairing code clears after claim");
  assert.equal(window.document.querySelector("[data-terminal-permission]").textContent, i18nCore.DICTIONARIES.ja["settings.devices.terminalReady"]);
  assert.equal(window.document.querySelectorAll(".devmoter-settings-device").length, 2);

  // Step 4: Terminal gate in Control Center is cleared and Settings offers direct terminal entry.
  await waitFor(
    () => !window.document.querySelector("[data-terminal-device-gate]"),
    "cleared terminal device gate"
  );
  const openTerminalBtn = window.document.querySelector('[data-action="open:terminal"]');
  assert.ok(openTerminalBtn, "Open Terminal button appears after trusting");
  openTerminalBtn.click();
  await waitFor(() => launchedApps.length === 1, "terminal launch event");
  assert.deepEqual(launchedApps.map(entry => ({ id: entry?.id })), [{ id: "terminal" }]);

  // Also verify revoking the old device leaves only the current trusted device.
  window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "devices" } }));
  await waitFor(
    () => window.document.querySelectorAll('[data-action="device:revoke"]').length === 2,
    "reopened devices list with two revoke buttons"
  );
  // Revoking asks first: declining keeps both devices and sends nothing.
  const confirmations = [];
  let confirmAnswer = false;
  window.confirm = message => { confirmations.push(message); return confirmAnswer; };
  const firstRevoke = window.document.querySelector('[data-action="device:revoke"]');
  firstRevoke.click();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(confirmations.length, 1);
  assert.ok(confirmations[0].includes(firstRevoke.dataset.deviceLabel), "confirmation names the device");
  assert.equal(window.document.querySelectorAll(".devmoter-settings-device").length, 2);
  confirmAnswer = true;
  window.document.querySelector('[data-action="device:revoke"]').click();
  await waitFor(
    () => window.document.querySelectorAll(".devmoter-settings-device").length === 1,
    "single device remaining after revoke"
  );

  // Also verify remote untrusted view reflects real server device list without exposing bootstrap/recovery actions.
  currentDeviceToken = "";
  remoteMode = true;
  window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "devices" } }));
  await waitFor(
    () => window.document.querySelector("[data-device-guidance]")?.textContent?.includes(i18nCore.DICTIONARIES.ja["settings.devices.guidanceRemote"]),
    "remote untrusted guidance"
  );
  assert.equal(window.document.querySelector('[data-action="device:bootstrap"]'), null);
  assert.equal(window.document.querySelector('[data-action="device:create-code"]'), null);
  assert.equal(window.document.querySelector('[data-action="device:revoke"]'), null);
  assert.equal(window.document.querySelectorAll(".devmoter-settings-device").length, 1);

  // And when zero devices remain on localhost, bootstrap IS genuinely offered and succeeds to terminal permission.
  remoteMode = false;
  const remainingRevoke = () => window.document.querySelector('[data-action="device:revoke"]');
  window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "devices" } }));
  await waitFor(() => remainingRevoke(), "localhost revoke button");
  remainingRevoke().click();
  await waitFor(
    () => window.document.querySelector('[data-action="device:bootstrap"]'),
    "localhost first-device bootstrap offered when server has zero devices"
  );
  assert.ok(window.document.querySelector(".devmoter-settings-scroll").textContent.includes(i18nCore.DICTIONARIES.ja["settings.devices.empty"]));
  window.document.querySelector('[data-action="device:bootstrap"]').click();
  await waitFor(
    () => window.document.querySelector("[data-device-status]")?.textContent === i18nCore.DICTIONARIES.ja["settings.devices.trusted"],
    "trusted after first-device bootstrap"
  );
  assert.equal(window.document.querySelector("[data-terminal-permission]").textContent, i18nCore.DICTIONARIES.ja["settings.devices.terminalReady"]);

  dom.window.close();
});

test("all pairing and device error messages translate cleanly across all 4 locales", () => {
  const messages = [
    "A trusted device already exists; use pairing instead",
    "The pairing device has been revoked",
    "First trusted device must be created from http://127.0.0.1 or http://localhost",
    "Too many failed pairing attempts; try again later",
    "Pairing code is invalid or expired",
    "Device not found",
    "A trusted device is required for terminal access.",
    "Trusted device state is unavailable.",
    "Owner authentication is required",
    "Confirm this sign-in with a Passkey"
  ];
  for (const lang of ["ja", "en", "zh-Hans", "zh-Hant"]) {
    for (const raw of messages) {
      const translated = i18nCore.translateServerMessage(raw, lang);
      assert.ok(translated && typeof translated === "string", `Missing translation for ${raw} in ${lang}`);
      if (lang !== "en") {
        assert.notEqual(translated, raw, `Server message stayed in raw English for ${lang}: ${raw}`);
      }
    }
    const deviceKeys = Object.keys(i18nCore.DICTIONARIES.en).filter(key => key.startsWith("settings.devices."));
    for (const key of deviceKeys) {
      const val = i18nCore.DICTIONARIES[lang][key];
      assert.ok(val && typeof val === "string", `Missing ${key} in ${lang}`);
      if (lang !== "en") {
        assert.notEqual(val, i18nCore.DICTIONARIES.en[key], `Device UI string stayed in English for ${lang}: ${key}`);
      }
    }
  }
});
