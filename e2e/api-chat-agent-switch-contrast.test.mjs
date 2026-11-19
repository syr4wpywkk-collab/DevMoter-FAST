import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { webkit } from "playwright";

// Regression for #310 (fixed by #410, which superseded #313): the active API
// Chat row in the agent switcher must stay readable in both themes.
const repo = path.resolve(import.meta.dirname, "..");

async function fixtureServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devmoter-api-contrast-"));
  const entry = path.join(dir, "fixture.ts");
  await writeFile(entry, `
    import ${JSON.stringify(path.join(repo, "src/style.css"))};
    import ${JSON.stringify(path.join(repo, "src/zcode-theme.css"))};
    import { mountApiChat } from ${JSON.stringify(path.join(repo, "src/api-chat.ts"))};
    document.documentElement.dataset.devmoterTheme = new URL(location.href).searchParams.get("theme") || "light";
    document.body.classList.add("api-mode");
    mountApiChat(document.querySelector("#app"));
  `);
  await build({ entryPoints: [entry], outfile: path.join(dir, "fixture.js"), bundle: true, format: "esm", platform: "browser", target: "es2022" });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.writeHead(200, { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" });
      res.end(await readFile(path.join(dir, path.basename(url.pathname)))); return;
    }
    res.writeHead(404, { "content-type": "application/json" }).end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async close() { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
  };
}

function luminance([r, g, b]) {
  const channel = value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Resolves each element's text color and the opaque background it is painted on.
async function rowColors(page, selector) {
  return page.locator(selector).evaluate(row => {
    const rgba = value => {
      const [r, g, b, a = 1] = value.match(/[\d.]+/g).map(Number);
      return [r, g, b, a];
    };
    const background = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] >= 1) break;
      }
      let result = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse()) result = [r * a + result[0] * (1 - a), g * a + result[1] * (1 - a), b * a + result[2] * (1 - a)];
      return result;
    };
    return [row.querySelector("strong"), row.querySelector("small")].map(element => ({
      text: rgba(getComputedStyle(element).color).slice(0, 3),
      background: background(element)
    }));
  });
}

for (const theme of ["dark", "light"]) {
  test(`active API Chat row in the agent switcher is readable in ${theme} theme`, async t => {
    const server = await fixtureServer();
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await server.close(); } });
    browser = await webkit.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(server.url).origin ? route.continue() : route.abort());
    await page.goto(`${server.url}?theme=${theme}`);
    await page.locator("#apiAgentCurrent").waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.devmoterTheme), theme);
    const [name, summary] = await rowColors(page, "#apiAgentCurrent");
    assert.ok(contrast(name.text, name.background) >= 4.5, `${theme} name contrast ${contrast(name.text, name.background).toFixed(2)} ${JSON.stringify(name)}`);
    assert.ok(contrast(summary.text, summary.background) >= 4.5, `${theme} summary contrast ${contrast(summary.text, summary.background).toFixed(2)} ${JSON.stringify(summary)}`);
  });
}
