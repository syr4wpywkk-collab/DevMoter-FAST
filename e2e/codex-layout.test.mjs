import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { webkit } from "playwright";

const repo = path.resolve(import.meta.dirname, "..");

async function fixtureServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devmoter-codex-layout-"));
  const entry = path.join(dir, "fixture.ts");
  await writeFile(entry, `
    import ${JSON.stringify(path.join(repo, "src/style.css"))};
    import ${JSON.stringify(path.join(repo, "src/zcode-theme.css"))};
    import { mountCodexRemote } from ${JSON.stringify(path.join(repo, "src/codex.ts"))};
    import { startWorkspaceControl } from ${JSON.stringify(path.join(repo, "src/workspace-control.ts"))};
    import { mountTaskWorkflow } from ${JSON.stringify(path.join(repo, "src/workflow.ts"))};
    document.body.classList.add('codex-mode');
    mountCodexRemote(document.querySelector('#app'));
    mountTaskWorkflow(document.querySelector('#workflowMount'));
    startWorkspaceControl();
    const button = document.createElement('button');
    button.textContent = 'Fixture workspace control';
    button.id = 'fixtureWorkspaceControl';
    document.querySelector('#cxWorkspaceControlsMount').append(button);
  `);
  await build({ entryPoints: [entry], outfile: path.join(dir, "fixture.js"), bundle: true, format: "esm", platform: "browser", target: "es2022" });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><div id="workflowMount"></div><script type="module" src="/fixture.js"></script></body></html>';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.writeHead(200, { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" });
      res.end(await readFile(path.join(dir, path.basename(url.pathname)))); return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async close() { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
  };
}

async function setup(t, viewport) {
  const server = await fixtureServer();
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await server.close(); } });
  browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(server.url).origin ? route.continue() : route.abort();
  });
  await page.goto(server.url);
  await page.locator("#cxSidebar").waitFor({ state: "attached" });
  return page;
}

test("desktop Codex sidebar remains clickable before and after a modal", async t => {
  const page = await setup(t, { width: 1280, height: 800 });
  const sidebar = page.locator("#cxSidebar");
  assert.equal(await sidebar.isVisible(), true);
  assert.equal(await sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(await sidebar.getAttribute("inert"), null);
  await page.locator("#cxLibraryNav").click({ timeout: 5000 });
  assert.equal(await page.locator("#cxModal").isVisible(), true);
  assert.notEqual(await sidebar.getAttribute("inert"), null);
  await page.locator("#cxModalClose").click();
  assert.equal(await sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(await sidebar.getAttribute("inert"), null);
  await page.locator("#cxLibraryNav").click({ timeout: 5000 });
  assert.equal(await page.locator("#cxModal").isVisible(), true);
});

test("mobile Codex details drawer restores focus and removes hidden controls", async t => {
  const page = await setup(t, { width: 390, height: 844 });
  const details = page.locator("#cxDetailsPanel");
  const toggle = page.locator("#cxDetailsTop");
  await toggle.click();
  assert.equal(await details.getAttribute("aria-hidden"), "false");
  assert.equal(await details.getAttribute("role"), "dialog");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "cxDetailsPanel");
  await page.keyboard.press("Tab");
  assert.equal(await details.evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  assert.equal(await details.getAttribute("aria-hidden"), "true");
  assert.notEqual(await details.getAttribute("inert"), null);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "cxDetailsTop");
  await toggle.click();
  await page.locator("#cxScrim").click({ position: { x: 8, y: 100 } });
  assert.equal(await details.getAttribute("aria-hidden"), "true");
  assert.notEqual(await details.getAttribute("inert"), null);
});

test("mobile Review shortcut closes the details focus trap before opening Review", async t => {
  const page = await setup(t, { width: 390, height: 844 });
  const details = page.locator("#cxDetailsPanel");
  await page.locator("#cxDetailsTop").click();
  await page.locator(".dm-review-shortcut").click({ timeout: 5000 });
  await page.locator("#wfModal:not(.hidden)").waitFor();
  assert.equal(await details.getAttribute("aria-hidden"), "true");
  assert.notEqual(await details.getAttribute("inert"), null);
  await page.locator("#wfClose").focus();
  await page.keyboard.press("Tab");
  assert.equal(await details.evaluate(node => node.contains(document.activeElement)), false);
});
