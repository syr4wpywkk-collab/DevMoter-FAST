import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { openPromptTemplates } = await vite.ssrLoadModule("/src/prompt-templates.ts");
const { setLanguage, DICTIONARIES } = await vite.ssrLoadModule("/src/i18n-core.mjs");
await vite.close();

// #781: Prompts used to print only a red "Trusted device registration is required."
// with nothing to act on; it now shows the same gate as Knowledge.
test("an unregistered browser sees the shared Trusted device gate in Prompts", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/", pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = async path => {
    if (path === "/api/projects") return { ok: true, status: 200, json: async () => ({ projects: [] }) };
    return { ok: false, status: 401, json: async () => ({ error: "Trusted device registration is required." }) };
  };
  for (const key of ["window", "document", "CustomEvent", "HTMLElement", "fetch"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: window.localStorage });
  setLanguage("ja");
  const opened = [];
  window.addEventListener("devmoter:open-settings", event => opened.push(event.detail.page));
  try {
    openPromptTemplates();
    for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0));
    const doc = window.document;
    const gate = doc.querySelector(".pt-body [data-device-gate]");
    assert.ok(gate, "the registration gate is shown");
    assert.equal(gate.querySelector("strong").textContent, DICTIONARIES.ja["deviceGate.unregisteredTitle"]);
    assert.equal(doc.querySelector(".pt-status").textContent, "", "no raw error line");
    gate.querySelector("[data-device-gate-register]").click();
    assert.deepEqual(opened, ["devices"], "the button opens Settings → Trusted devices");
    assert.equal(doc.querySelector(".pt-panel"), null, "Prompts closes first");
  } finally {
    window.close();
  }
});
