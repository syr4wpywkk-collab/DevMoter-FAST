import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { createTerminalManager } from "../server/terminal.mjs";
import * as deviceGate from "../src/device-gate.mjs";
import * as diagnosticsFormat from "../src/diagnostics-format.mjs";
import * as i18nCore from "../src/i18n-core.mjs";
import * as sheetHeader from "../src/sheet-header.mjs";

const controlSource = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
const controlCss = await readFile(new URL("../src/control-center.css", import.meta.url), "utf8");

function transpile(source, allowedImportsRegex) {
  return ts.transpileModule(
    source.replace(new RegExp(`^import (?!.*(${allowedImportsRegex})).*;\s*$`, "gm"), ""),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }
  ).outputText;
}

const compiledControl = transpile(controlSource, "device-gate|sheet-header|i18n");
const compiledSettings = transpile(settingsSource, "diagnostics-format|push-readiness|i18n");

const FakeTerminal = class {
  constructor(options = {}) {
    this.options = options;
    this.cols = 80;
    this.rows = 24;
  }
  loadAddon() {}
  open() {}
  write() {}
  clear() {}
  reset() {}
  focus() {}
  onData() { return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
  dispose() {}
};

const FakeFitAddon = class {
  fit() {}
};

const settle = async (turns = 8) => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; },
  async text() { return JSON.stringify(body); }
});

function mountControlAndSettings({ fetch, language = "en", url = "http://localhost:8765/", withSettings = true } = {}) {
  const dom = new JSDOM("<!doctype html><main id='background'><button>Background</button></main>", {
    url,
    runScripts: "outside-only"
  });
  const { window } = dom;
  i18nCore.setLanguage(language, { persist: false });
  if (!("inert" in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, "inert", {
      value: false,
      writable: true,
      configurable: true
    });
  }
  window.HTMLElement.prototype.getClientRects = () => [{ width: 20, height: 20 }];
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const sockets = [];
  window.WebSocket = class {
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(socketUrl) {
      this.url = socketUrl;
      this.readyState = 1;
      sockets.push(this);
    }
    send() {}
    close() { this.readyState = 3; }
  };
  window.fetch = fetch;
  // jsdom has no window.requestAnimationFrame, but fitTerminal() calls it
  // (the vm sandbox only provides a bare global). Mirror the other
  // control-center test files and stub it on the window.
  window.requestAnimationFrame = fn => setTimeout(fn, 0);

  const pushStub = {
    boundedPushWait: promise => promise,
    inspectPushReadiness: async () => ({ state: "unregistered", canSubscribe: false })
  };

  const makeRequire = name => {
    if (name === "./device-gate.mjs") return deviceGate;
    if (name === "./sheet-header.mjs") return sheetHeader;
    if (name === "./i18n") return i18nCore;
    if (name === "./diagnostics-format.mjs") return diagnosticsFormat;
    if (name === "./push-readiness.js") return pushStub;
    if (name === "@xterm/xterm") return { Terminal: FakeTerminal };
    if (name === "@xterm/addon-fit") return { FitAddon: FakeFitAddon };
    return {};
  };

  const runModule = (code, filename) => {
    const module = { exports: {} };
    vm.runInNewContext(code, {
      exports: module.exports,
      module,
      require: makeRequire,
      window,
      document: window.document,
      location: window.location,
      navigator: window.navigator,
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
      fetch,
      HTMLElement: window.HTMLElement,
      HTMLButtonElement: window.HTMLButtonElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLSelectElement: window.HTMLSelectElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      CustomEvent: window.CustomEvent,
      Event: window.Event,
      URL: window.URL,
      Headers,
      crypto: globalThis.crypto,
      btoa: globalThis.btoa,
      atob: globalThis.atob,
      ResizeObserver: window.ResizeObserver,
      WebSocket: window.WebSocket,
      getComputedStyle: (...args) => window.getComputedStyle(...args),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      requestAnimationFrame: fn => setTimeout(fn, 0)
    }, { filename });
    return module.exports;
  };

  if (withSettings) {
    const settingsMod = runModule(compiledSettings, "settings.js");
    settingsMod.mountSettingsPanel();
  }
  const controlMod = runModule(compiledControl, "control-center.js");
  controlMod.mountControlCenter();

  return { dom, window, document: window.document, sockets };
}

test("all 3 Control Center tabs show explanation and registration button when untrusted", async t => {
  const app = mountControlAndSettings({
    withSettings: false,
    fetch: async path => {
      const url = String(path);
      if (url === "/api/projects") {
        return jsonResponse({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
      }
      if (url === "/api/devices") {
        return jsonResponse({ error: "Trusted device token required" }, 401);
      }
      if (url === "/api/terminal/sessions") {
        return jsonResponse({ error: "Trusted device required" }, 403);
      }
      if (url === "/api/safety/permissions") {
        return jsonResponse({ rules: [] });
      }
      if (url === "/api/projects/project-a/index/status") {
        return jsonResponse({ ready: false });
      }
      return jsonResponse({ error: "Not found" }, 404);
    }
  });
  t.after(() => app.dom.window.close());

  assert.match(controlCss, /\.dm-tools-section\[data-device-gated\]\s*>\s*:not\(\[data-device-gate\]\)\s*\{\s*display:\s*none;/);

  await settle();
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();

  const openedEvents = [];
  app.window.addEventListener("devmoter:open-settings", event => openedEvents.push(event.detail));

  const tabs = [
    ["#dm-tools-terminal-tab", "#dm-tools-terminal-panel", "controlCenter.tab.terminal"],
    ["#dm-tools-safety-tab", "#dm-tools-safety-panel", "controlCenter.tab.safetyTitle"],
    ["#dm-tools-index-tab", "#dm-tools-index-panel", "controlCenter.tab.indexTitle"]
  ];

  for (const [tabSelector, panelSelector, featureKey] of tabs) {
    app.document.querySelector(tabSelector).click();
    await settle();
    const section = app.document.querySelector(panelSelector);
    assert.equal(section.dataset.deviceGated, "true", `${panelSelector} is gated when untrusted`);
    const gate = section.querySelector(":scope > [data-device-gate]");
    assert.ok(gate, `${panelSelector} renders the registration gate`);
    assert.equal(gate.querySelector("strong").textContent, i18nCore.translate("en", "deviceGate.unregisteredTitle"));
    assert.equal(
      gate.querySelector("small").textContent,
      i18nCore.translate("en", "deviceGate.toolsLockedCopy", {
        feature: i18nCore.translate("en", featureKey)
      })
    );
    const registerBtn = gate.querySelector("[data-device-gate-register]");
    assert.equal(registerBtn.textContent, i18nCore.translate("en", "deviceGate.openToRegisterButton"));
    registerBtn.click();
  }

  assert.deepEqual(openedEvents, [
    { page: "devices" },
    { page: "devices" },
    { page: "devices" }
  ]);
  assert.equal(app.document.querySelector(".dm-tools-panel").classList.contains("hidden"), false);
});

test("Safety and Index action failures for untrusted devices switch into the registration gate instead of dead forms", async t => {
  const app = mountControlAndSettings({
    withSettings: false,
    fetch: async (path, init = {}) => {
      const url = String(path);
      const method = init.method || "GET";
      if (url === "/api/projects") {
        return jsonResponse({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
      }
      if (url === "/api/terminal/sessions") return jsonResponse({ error: "Trusted device required" }, 403);
      if (url === "/api/safety/permissions" && method === "GET") return jsonResponse({ rules: [] });
      if (url === "/api/safety/command-scan" && method === "POST") return jsonResponse({ error: "Trusted device required" }, 403);
      if (url === "/api/projects/project-a/index/status" && method === "GET") return jsonResponse({ ready: false });
      if (url === "/api/projects/project-a/index/rebuild" && method === "POST") return jsonResponse({ error: "Trusted device required" }, 403);
      return jsonResponse({ error: "Not found" }, 404);
    }
  });
  t.after(() => app.dom.window.close());

  await settle();
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();

  app.document.querySelector("#dm-tools-safety-tab").click();
  await settle();
  const safetyPanel = app.document.querySelector("#dm-tools-safety-panel");
  assert.equal(safetyPanel.dataset.deviceGated, undefined);
  safetyPanel.querySelector("textarea").value = "ls";
  safetyPanel.querySelector("button.primary").click();
  await settle();
  assert.equal(safetyPanel.dataset.deviceGated, "true");
  assert.ok(safetyPanel.querySelector(":scope > [data-device-gate] [data-device-gate-register]"));

  app.document.querySelector("#dm-tools-index-tab").click();
  await settle();
  const indexPanel = app.document.querySelector("#dm-tools-index-panel");
  assert.equal(indexPanel.dataset.deviceGated, undefined);
  const rebuildBtn = [...indexPanel.querySelectorAll("button")].find(
    btn => btn.textContent === i18nCore.translate("en", "index.rebuildBtn")
  );
  assert.ok(rebuildBtn);
  rebuildBtn.click();
  await settle();
  assert.equal(indexPanel.dataset.deviceGated, "true");
  assert.ok(indexPanel.querySelector(":scope > [data-device-gate] [data-device-gate-register]"));
});

test("end-to-end gate -> Trusted devices registration -> returning makes all 3 tabs usable without reopening the modal", async t => {
  let trusted = false;
  let scanned = [];
  let createdSessions = [];

  const app = mountControlAndSettings({
    withSettings: true,
    fetch: async (path, init = {}) => {
      const url = String(path);
      const method = init.method || "GET";
      if (url === "/api/health") return jsonResponse({ ok: true, backend: "opencode", nodeVersion: process.version });
      if (url === "/api/projects") return jsonResponse({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
      if (url === "/api/account") return jsonResponse({ authenticated: true, providers: {}, recovery: {} });
      if (url === "/api/system/diagnostics") return jsonResponse({ capabilities: {}, push: {} });
      if (url === "/api/devices" && method === "GET") {
        if (!trusted) return jsonResponse({ error: "Trusted device token required" }, 401);
        return jsonResponse({
          currentDevice: { id: "dev-1", label: "Desktop", current: true },
          devices: [{ id: "dev-1", label: "Desktop", current: true, lastSeenAt: Date.now() }]
        });
      }
      if (url === "/api/devices/bootstrap" && method === "POST") {
        trusted = true;
        return jsonResponse({ device: { id: "dev-1", label: "Desktop", current: true } }, 201);
      }
      if (url === "/api/terminal/sessions" && method === "GET") {
        if (!trusted) return jsonResponse({ error: "Trusted device required" }, 403);
        return jsonResponse({ sessions: [] });
      }
      if (url === "/api/terminal/sessions" && method === "POST") {
        if (!trusted) return jsonResponse({ error: "A trusted device is required for terminal access." }, 403);
        createdSessions.push(JSON.parse(init.body || "{}"));
        const session = {
          id: "term-1",
          projectId: "project-a",
          projectName: "Sample",
          cwd: "/work/sample",
          persistent: true,
          name: "Default",
          status: "running"
        };
        return jsonResponse({ session, token: "tok-1" }, 201);
      }
      if (url === "/api/terminal/sessions/term-1" && method === "GET") {
        return jsonResponse({
          session: {
            id: "term-1",
            projectId: "project-a",
            projectName: "Sample",
            cwd: "/work/sample",
            persistent: true,
            name: "Default",
            status: "running"
          }
        });
      }
      if (url === "/api/terminal/sessions/term-1/socket-ticket" && method === "POST") {
        return jsonResponse({ ticket: "ticket-1" }, 201);
      }
      if (url === "/api/safety/permissions" && method === "GET") {
        if (!trusted) return jsonResponse({ error: "Trusted device required" }, 403);
        return jsonResponse({ rules: [] });
      }
      if (url === "/api/safety/command-scan" && method === "POST") {
        if (!trusted) return jsonResponse({ error: "Trusted device required" }, 403);
        const payload = JSON.parse(init.body || "{}");
        scanned.push(payload.command);
        return jsonResponse({ command: payload.command, dangerous: false, risk: "low", reasons: [], note: "Safe command" });
      }
      if (url === "/api/projects/project-a/index/status" && method === "GET") {
        if (!trusted) return jsonResponse({ error: "Trusted device required" }, 403);
        return jsonResponse({ ready: false });
      }
      return jsonResponse({ error: "Not found" }, 404);
    }
  });
  t.after(() => app.dom.window.close());

  await settle();
  const panel = app.document.querySelector(".dm-tools-panel");
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();

  // Visit Safety tab so Safety & Terminal are both active/gated before registering.
  app.document.querySelector("#dm-tools-safety-tab").click();
  await settle();
  const safetyPanel = app.document.querySelector("#dm-tools-safety-panel");
  const terminalPanel = app.document.querySelector("#dm-tools-terminal-panel");
  assert.equal(terminalPanel.dataset.deviceGated, "true");
  assert.equal(safetyPanel.dataset.deviceGated, "true");

  // Click the Safety registration action -> opens Settings -> Trusted devices over the still-open modal.
  safetyPanel.querySelector("[data-device-gate-register]").click();
  await settle();

  const settingsRoot = app.document.querySelector(".devmoter-settings-root");
  const settingsModal = app.document.querySelector(".devmoter-settings-modal");
  assert.equal(settingsModal.classList.contains("hidden"), false, "Settings opens cleanly");
  assert.equal(settingsRoot.inert, false, "Settings overlay is not locked inert by background lock");
  assert.equal(panel.classList.contains("hidden"), false, "Control Center stays open underneath Settings");

  // Escape inside Settings navigates/closes Settings without dismissing Control Center.
  const escEvent = new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  app.document.dispatchEvent(escEvent);
  await settle();
  assert.equal(panel.classList.contains("hidden"), false, "Escape in Settings never closes Control Center");

  // Re-open Trusted devices from the still-gated Safety tab and register this browser.
  if (settingsModal.classList.contains("hidden")) {
    safetyPanel.querySelector("[data-device-gate-register]").click();
    await settle();
  }
  const backButton = app.document.querySelector(".devmoter-settings-back");
  if (app.document.querySelector('[data-action="device:bootstrap"]') == null && backButton) {
    // Escaped to Settings root; click the Trusted devices row.
    app.document.querySelector('[data-action="page:devices"]')?.click();
    await settle();
  }
  const bootstrapBtn = app.document.querySelector('[data-action="device:bootstrap"]');
  assert.ok(bootstrapBtn, "Trusted devices page offers Register this browser on localhost");
  bootstrapBtn.click();
  await settle();
  assert.equal(trusted, true);

  // Close Settings -> no reopening of Control Center modal required!
  app.document.querySelector(".devmoter-settings-close").click();
  await settle();
  assert.equal(settingsModal.classList.contains("hidden"), true);
  assert.equal(panel.classList.contains("hidden"), false, "Control Center remains open without reopening");

  // Safety tab is immediately usable.
  assert.equal(safetyPanel.dataset.deviceGated, undefined);
  assert.equal(safetyPanel.querySelector("[data-device-gate]"), null);
  safetyPanel.querySelector("textarea").value = "echo hello";
  safetyPanel.querySelector("button.primary").click();
  await settle();
  assert.deepEqual(scanned, ["echo hello"]);
  assert.match(safetyPanel.querySelector("pre[role='status']").textContent, /echo hello/);

  // Index tab opens unlocked and functional.
  app.document.querySelector("#dm-tools-index-tab").click();
  await settle();
  const indexPanel = app.document.querySelector("#dm-tools-index-panel");
  assert.equal(indexPanel.dataset.deviceGated, undefined);
  assert.equal(indexPanel.querySelector("[role='status']").textContent, i18nCore.translate("en", "index.notBuiltStatus"));

  // Terminal tab is unlocked and can start a real session.
  app.document.querySelector("#dm-tools-terminal-tab").click();
  await settle();
  assert.equal(terminalPanel.dataset.deviceGated, undefined);
  assert.equal(terminalPanel.querySelector("[data-device-gate]"), null);
  const startBtn = [...terminalPanel.querySelectorAll("button")].find(
    btn => btn.textContent === i18nCore.translate("en", "terminal.startReattachBtn")
  );
  assert.ok(startBtn);
  startBtn.click();
  await settle();
  assert.equal(createdSessions.length, 1);
  assert.equal(app.sockets.length, 1);
});

test("returning focus re-checks device trust when registration happens outside the current tab", async t => {
  let trusted = false;
  const app = mountControlAndSettings({
    withSettings: false,
    fetch: async path => {
      const url = String(path);
      if (url === "/api/projects") return jsonResponse({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
      if (url === "/api/devices") {
        if (!trusted) return jsonResponse({ error: "Trusted device token required" }, 401);
        return jsonResponse({ devices: [{ id: "dev-1", current: true }] });
      }
      if (url === "/api/terminal/sessions") {
        if (!trusted) return jsonResponse({ error: "Trusted device required" }, 403);
        return jsonResponse({ sessions: [] });
      }
      if (url === "/api/projects/project-a/index/status") {
        if (!trusted) return jsonResponse({ error: "Trusted device required" }, 403);
        return jsonResponse({ ready: true, files: 12, indexedBytes: 4096, reusedFiles: 12 });
      }
      return jsonResponse({ error: "Not found" }, 404);
    }
  });
  t.after(() => app.dom.window.close());

  await settle();
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();
  app.document.querySelector("#dm-tools-index-tab").click();
  await settle();

  const indexPanel = app.document.querySelector("#dm-tools-index-panel");
  const terminalPanel = app.document.querySelector("#dm-tools-terminal-panel");
  assert.equal(indexPanel.dataset.deviceGated, "true");
  assert.equal(terminalPanel.dataset.deviceGated, "true");

  // Simulate another tab completing registration without emitting in-tab custom events.
  trusted = true;
  app.window.dispatchEvent(new app.window.Event("focus"));
  await settle();

  assert.equal(indexPanel.dataset.deviceGated, undefined);
  assert.equal(terminalPanel.dataset.deviceGated, undefined);
  assert.match(indexPanel.querySelector("[role='status']").textContent, /Ready/);
});

test("server-side terminal trust gate cannot be bypassed without an active trusted device", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-gate-test-"));
  const manager = createTerminalManager({
    authenticateDevice: async () => null,
    resolveProject: async () => ({ id: "project-a", name: "Sample", path: dir }),
    ownerAuthenticated: () => true
  });
  t.after(async () => {
    manager.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  const invoke = async (fn, method, url, headers = {}) => {
    let statusCode = 0;
    let body = "";
    const req = {
      method,
      url,
      headers: { host: "localhost:8765", ...headers },
      on() {}
    };
    const res = {
      writeHead(code) { statusCode = code; },
      end(chunk) { body = String(chunk || ""); }
    };
    await fn(req, res);
    return { statusCode, payload: JSON.parse(body || "{}") };
  };

  const listResult = await invoke(manager.listSessions, "GET", "/api/terminal/sessions");
  assert.equal(listResult.statusCode, 403);
  assert.match(listResult.payload.error, /trusted device/i);

  const createResult = await invoke(manager.create, "POST", "/api/terminal/sessions", {
    "x-devmoter-terminal-entry": "explicit"
  });
  assert.equal(createResult.statusCode, 403);
  assert.match(createResult.payload.error, /trusted device/i);
});
