import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import * as i18nCore from "../src/i18n-core.mjs";
import * as diagnosticsFormat from "../src/diagnostics-format.mjs";
import * as fetchWithTimeout from "../src/fetch-with-timeout.mjs";

const jaI18n = {
  ...i18nCore,
  getLanguage: () => "ja",
  t: (k, p) => i18nCore.translate("ja", k, p),
  translateServerMessage: m => i18nCore.translateServerMessage(m, "ja"),
  formatDateTime: (v, o) => i18nCore.formatDateTime(v, o, "ja"),
  formatNumber: (v, o) => i18nCore.formatNumber(v, o, "ja")
};
const ja = key => i18nCore.DICTIONARIES.ja[key];

const settingsCompiled = ts.transpileModule(await readFile(new URL("../src/settings.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

// #769: Trusted Devices must not keep the root list on screen while loading, and a
// failed diagnostics fetch must offer a retry instead of a dead-end guidance line.
test("Trusted Devices shows loading, then a retry when diagnostics fail, then the bootstrap button", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8787/" });
  const { window } = dom;
  let diagnosticsOk = false;
  let releaseDiagnostics = () => {};
  const fetch = async input => {
    const path = String(input);
    if (path === "/api/system/diagnostics") {
      await new Promise(resolve => { releaseDiagnostics = resolve; });
      return diagnosticsOk
        ? json(200, { deviceSecurity: { bootstrapAvailable: true, localBootstrap: true, trustedDevices: 0 } })
        : json(503, { error: "unavailable" });
    }
    if (path === "/api/devices") return json(401, { error: "device required" });
    return json(200, {});
  };
  const exports = {};
  vm.runInNewContext(settingsCompiled, {
    exports,
    require: name => name === "./i18n" ? jaI18n
      : name === "./diagnostics-format.mjs" ? diagnosticsFormat
        : name === "./fetch-with-timeout.mjs" ? fetchWithTimeout
          : name === "./push-readiness.js" ? { boundedPushWait: p => p, inspectPushReadiness: async () => ({ state: "unsupported" }) }
            : {},
    window, document: window.document, navigator: window.navigator, location: window.location,
    localStorage: window.localStorage, Headers, fetch, setTimeout, clearTimeout,
    crypto: { randomUUID: () => "test-operation" },
    CustomEvent: window.CustomEvent,
    matchMedia: () => ({ matches: true }),
    atob
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    exports.mountSettingsPanel();
    const scroll = window.document.querySelector(".devmoter-settings-scroll");
    window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "root" } }));
    await settle();
    releaseDiagnostics();
    await settle();
    scroll.querySelector('.devmoter-settings-row[data-action="page:devices"]').click();
    await settle();
    assert.ok(scroll.querySelector(".devmoter-settings-loading"), "loading state while diagnostics are pending");
    assert.equal(scroll.querySelector('[data-action="page:appearance"]'), null, "root rows are gone");

    releaseDiagnostics();
    await settle();
    const retry = scroll.querySelector('[data-action="devices:retry"]');
    assert.ok(retry, "retry offered when diagnostics fail");
    assert.equal(retry.textContent, ja("common.retry"));
    assert.ok(scroll.querySelector("[data-diagnostics-host-guide]"), "the failure is explained");
    assert.equal(scroll.querySelector("[data-device-guidance]"), null, "no misleading guidance");

    diagnosticsOk = true;
    retry.click();
    await settle();
    assert.ok(scroll.querySelector(".devmoter-settings-loading"), "loading state while retrying");
    releaseDiagnostics();
    await settle();
    assert.ok(scroll.querySelector('[data-action="device:bootstrap"]'), "bootstrap offered after a successful retry");
    assert.equal(scroll.querySelector('[data-action="devices:retry"]'), null);
  } finally {
    window.close();
  }
});
