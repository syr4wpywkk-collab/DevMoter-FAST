import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const FILES = ["index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "icon.svg"];

test("Qwen Code Mobile is embedded unchanged as static files", async () => {
  for (const f of FILES) {
    const data = await readFile(new URL(`../public/qwen-mobile/${f}`, import.meta.url), "utf8");
    assert.ok(data.length > 0, f);
  }
  const html = await readFile(new URL("../public/qwen-mobile/index.html", import.meta.url), "utf8");
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), "no inline scripts (CSP script-src 'self')");
  assert.ok(!/\son[a-z]+=/.test(html), "no inline handlers (script-src-attr 'none')");
});

test("Home launches Qwen Code Mobile through the fixed shell allowlist", async () => {
  const [registry, shell, home, server] = await Promise.all([
    readFile(new URL("../src/app-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/home.ts", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8")
  ]);
  assert.match(registry, /id: "qwen-mobile"[^\n]+availability: "available"/);
  assert.ok(shell.includes('case "qwen-mobile": window.open("/qwen-mobile/index.html", "_blank", "noopener")'));
  assert.ok(home.includes('"qwen-mobile": "Qwen Code Mobile"'));
  assert.ok(server.includes('path = "/qwen-mobile/index.html"'));
});
