import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { webkit } from "playwright";

const repo = path.resolve(import.meta.dirname, "..");

// Codex's inventory reads use POST. Do not treat every POST as a mutation, or
// allow the entire RPC endpoint: turn/start also travels over POST.
function isReadOnlyApiRequest({ method, pathname, body, external = false }) {
  if (external) return false;
  if (method === "GET" || method === "HEAD") return [
    "/api/projects", "/api/session-control/state", "/api/opencode/session",
    "/api/opencode/session/active", "/api/tools-ai/context",
    "/api/workflow/projects/fixture/changes", "/api/workflow/projects/fixture/worktrees",
    "/api/workflow/projects/fixture/github/tasks"
  ].includes(pathname);
  if (method !== "POST" || pathname !== "/api/codex/rpc") return false;
  try { return ["thread/list", "thread/read"].includes(JSON.parse(body).method); }
  catch { return false; }
}

test("history request guard rejects approvals, applies, executions and unknown RPCs", () => {
  for (const method of ["thread/list", "thread/read"]) {
    assert.equal(isReadOnlyApiRequest({ method: "POST", pathname: "/api/codex/rpc", body: JSON.stringify({ method }) }), true);
  }
  for (const method of ["turn/start", "thread/start", "item/commandExecution/requestApproval", "unknown/method"]) {
    assert.equal(isReadOnlyApiRequest({ method: "POST", pathname: "/api/codex/rpc", body: JSON.stringify({ method }) }), false);
  }
  for (const pathname of ["/outside-api/mutate", "/api/codex/approval", "/api/workflow/projects/fixture/changes/synthetic/apply", "/api/opencode/session/synthetic/prompt", "/api/session-control/queue", "/api/tools-ai/runs"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(isReadOnlyApiRequest({ method, pathname, body: "{}" }), false);
  }
  assert.equal(isReadOnlyApiRequest({ method: "GET", pathname: "/api/projects", external: true }), false);
  assert.equal(isReadOnlyApiRequest({ method: "GET", pathname: "/api/unknown-action" }), false);
  assert.equal(isReadOnlyApiRequest({ method: "POST", pathname: "/api/codex/rpc", body: "not-json" }), false);
});

async function fixtureServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devmoter-tabs-"));
  const entry = path.join(dir, "fixture.ts");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><div id="workflowMount"></div><script type="module" src="/fixture.js"></script></body></html>`;
  await import("node:fs/promises").then(({ writeFile }) => writeFile(entry, `
    import { mountUnifiedFeatureShell } from ${JSON.stringify(path.join(repo, "src/app-shell.ts"))};
    import { mountTaskWorkflow } from ${JSON.stringify(path.join(repo, "src/workflow.ts"))};
    import { mountSessionControl } from ${JSON.stringify(path.join(repo, "src/session-control.ts"))};
    import { createSurfaceNavigation } from ${JSON.stringify(path.join(repo, "src/surface-navigation.mjs"))};
    const applySurface = surface => {
      window.dispatchEvent(new CustomEvent('devmoter:surface-changed', { detail: { surface } }));
      document.body.dataset.surface = surface;
      window.dispatchEvent(new CustomEvent('devmoter:backend-changed', { detail: { backend: surface } }));
    };
    const navigation = createSurfaceNavigation({ window, onSurface: applySurface });
    document.body.dataset.surface = navigation.current();
    mountTaskWorkflow(document.querySelector('#workflowMount'));
    mountSessionControl();
    mountUnifiedFeatureShell({
      initialSurface: navigation.current(), initialBackend: 'codex',
      switchBackend: backend => navigation.navigate(backend), openHome: () => navigation.navigate('home')
    });
  `));
  await build({ entryPoints: [entry], outfile: path.join(dir, "fixture.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", loader: { ".css": "empty" } });
  // Serve the repository CSS files themselves alongside the bundled JS so the layout/hit testing is real.
  const baseCss = await readFile(path.join(repo, "src/styles/base.css"), "utf8");
  const appShellCss = await readFile(path.join(repo, "src/app-shell.css"), "utf8");
  const navCss = await readFile(path.join(repo, "src/unified-workspace-nav.css"), "utf8");
  const workflowCss = await readFile(path.join(repo, "src/styles/tools.css"), "utf8");
  const sessionCss = await readFile(path.join(repo, "src/session-control.css"), "utf8");
  const css = [baseCss, appShellCss, workflowCss, sessionCss, navCss].join("\n");
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      if (url.pathname === "/api/projects") res.end(JSON.stringify({ projects: [{ id: "fixture", name: "Fixture", path: "/synthetic/project", available: true }] }));
      else if (url.pathname.endsWith("/changes")) res.end(JSON.stringify({ changes: [{
        id: "synthetic-change", status: "pending", source: "fixture", autoCommit: false, appliedFiles: [],
        files: [{ path: "synthetic.txt", decision: "accept", hunks: [],
          preview: { content: "synthetic proposal", truncated: false, totalLines: 1, totalBytes: 18 },
          acceptedPreview: { content: "synthetic proposal" } }]
      }] }));
      else if (url.pathname.endsWith("/worktrees")) res.end(JSON.stringify({ worktrees: [] }));
      else if (url.pathname.endsWith("/github/tasks")) res.end(JSON.stringify({ tasks: [] }));
      else if (url.pathname === "/api/session-control/state") res.end(JSON.stringify({ version: 1, queue: [], budgets: {}, ownership: {}, checkpoints: [], events: [] }));
      else if (url.pathname === "/api/codex/rpc") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const rpc = JSON.parse(body);
        res.end(JSON.stringify({ result: rpc.method === "thread/list"
          ? { data: [{ id: "synthetic-session", name: "Synthetic waiting run", cwd: "/synthetic/project" }] }
          : { thread: { id: "synthetic-session", status: "waiting", turns: [{ id: "synthetic-turn", status: "waiting", items: [] }] } } }));
      }
      else if (url.pathname.startsWith("/api/opencode")) res.end(JSON.stringify({ data: [] }));
      else res.end("{}");
      return;
    }
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
    const name = url.pathname === "/fixture.js" ? "fixture.js" : null;
    if (name) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(await readFile(path.join(dir, name))); return; }
    if (url.pathname === "/fixture.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(css); return; }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/?unifiedUI=1&surface=codex`, async close() { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); } };
}

async function openMenu(page) {
  const button = page.locator("[data-workspace-menu-button]");
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  await page.locator("#dmTaskFirstMenu:not([hidden])").waitFor();
}

async function assertNavAndHitTargets(page, device) {
  await openMenu(page);
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const current = page.locator("#dmTaskFirstMenu [aria-current='page']");
  assert.equal(await current.count(), 1, "exactly one workspace destination is current");
  const backgrounds = await page.locator('#dmTaskFirstMenu button[data-workspace-action]').evaluateAll(buttons => buttons.map(button => ({
    current: button.getAttribute('aria-current') === 'page', background: getComputedStyle(button).backgroundColor
  })));
  const selectedBackground = backgrounds.find(button => button.current).background;
  assert.equal(backgrounds.filter(button => button.background === selectedBackground).length, 1, 'only the selected item has the selected background, including after touch hover');
  const buttons = page.locator("#dmTaskFirstMenu button[data-workspace-action]");
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const box = await buttons.nth(i).boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, "every menu item has a usable hit target");
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button[data-workspace-action]")?.dataset.workspaceAction, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert.equal(hit, ["tasks", "chat", "review", "tools"][i], "each item center hits that same item");
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-workspace-menu-button]").getAttribute("aria-expanded"), "false", "Escape closes the menu");
}

for (const device of [
  { name: "narrow iPhone-size WebKit", viewport: { width: 320, height: 568 }, mobile: true, hasTouch: true },
  { name: "iPhone-size WebKit", viewport: { width: 390, height: 844 }, mobile: true, hasTouch: true },
  { name: "desktop WebKit", viewport: { width: 1280, height: 800 }, mobile: false, hasTouch: false }
]) {
  test(`workspace tabs, overlays and browser history (${device.name})`, async t => {
    const server = await fixtureServer();
    let browser;
    t.after(async () => {
      try { await browser?.close(); } finally { await server.close(); }
    });
    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({ viewport: device.viewport, isMobile: device.mobile, hasTouch: device.hasTouch });
    const page = await context.newPage();
    const apiRequests = [];
    const fixtureOrigin = new URL(server.url).origin;
    // Record attempted mutations BEFORE blocking them. A caught fetch error must
    // still fail this regression; no request can reach a real backend.
    await page.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      const external = url.origin !== fixtureOrigin;
      const staticAsset = !external && ["GET", "HEAD"].includes(request.method()) && ["/", "/fixture.js", "/fixture.css"].includes(url.pathname);
      if (!staticAsset) {
        const record = { method: request.method(), pathname: url.pathname, body: request.postData(), external };
        apiRequests.push(record);
        if (external) return route.abort();
        if (!isReadOnlyApiRequest(record)) return route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"synthetic fixture blocks mutations"}' });
      }
      return route.continue();
    });
    await page.goto(server.url);
    await page.locator("[data-workspace-menu-button]").waitFor();
    await page.waitForFunction(() => Boolean(document.querySelector("#dmTaskFirstWorkspace")));
    const tab = name => page.locator(`#dmTaskFirstMenu [data-workspace-action='${name}']`);
    const select = async name => {
      await openMenu(page);
      await tab(name).click();
      await page.waitForFunction(expected => new URL(location.href).searchParams.get("workspaceTab") === expected, name);
      assert.equal(await page.locator('#dmTaskFirstMenu [aria-current="page"]').getAttribute('data-workspace-action'), name);
      assert.equal(await page.locator('#wfModal').isVisible(), name === 'review', 'only Review shows the Review modal');
      assert.equal(await page.locator('.sc-panel.open').count(), name === 'tasks' ? 1 : 0);
      assert.equal(await page.locator('.dm-shell-sidebar.open').count(), name === 'tools' ? 1 : 0);
      await assertNavAndHitTargets(page, device);
    };

    await select("review");
    await page.locator("#wfModal:not(.hidden)").waitFor();
    await page.locator('[data-wf-action="apply"]').waitFor();
    await select("tasks");
    await page.locator(".sc-panel.open").waitFor();
    await page.locator(".sc-card[data-status=waiting]").waitFor();
    assert.equal(await page.locator("#wfModal:not(.hidden)").count(), 0, "Review overlay closes when Tasks opens");
    await select("review");
    await page.locator("#wfModal:not(.hidden)").waitFor();
    assert.equal(await page.locator(".sc-panel.open").count(), 0, "Tasks overlay closes when Review opens");

    for (const name of ["chat", "tools", "review", "tasks", "tools", "chat", "tasks", "review", "tasks"]) await select(name);
    // Prove the browser recorder sees attempted writes, even when blocked.
    // These requests hit only our rejecting loopback fixture, never live data.
    const negativeControls = [
      { pathname: "/api/codex/approval", body: { id: "synthetic-approval", decision: "accept" } },
      { pathname: "/api/workflow/projects/fixture/changes/synthetic-change/apply", body: {} },
      { pathname: "/api/codex/rpc", body: { method: "turn/start" } }
    ];
    const controlStart = apiRequests.length;
    await page.evaluate(async controls => {
      for (const control of controls) await fetch(control.pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(control.body) });
    }, negativeControls);
    assert.equal(apiRequests.slice(controlStart).filter(request => !isReadOnlyApiRequest(request)).length, 3, "network guard detects all three synthetic mutation attempts");

    // Create an exact four-destination history chain, then traverse it without
    // clicking any approval, apply, queue, stop, or execution controls.
    for (const name of ["chat", "tasks", "review", "tools", "chat"]) await select(name);
    await page.waitForLoadState("networkidle");
    const historyStart = apiRequests.length;
    for (const [direction, destinations] of [
      ["goBack", ["tools", "review", "tasks", "chat"]],
      ["goForward", ["tasks", "review", "tools", "chat"]]
    ]) {
      for (const name of destinations) {
        await page[direction]();
        await page.waitForFunction(expected => new URL(location.href).searchParams.get("workspaceTab") === expected, name);
        await page.waitForLoadState("networkidle");
        assert.equal(await page.locator('#dmTaskFirstMenu [aria-current="page"]').getAttribute("data-workspace-action"), name);
        assert.equal(await page.locator("#wfModal").isVisible(), name === "review");
        assert.equal(await page.locator(".sc-panel.open").count(), name === "tasks" ? 1 : 0);
        assert.equal(await page.locator(".dm-shell-sidebar.open").count(), name === "tools" ? 1 : 0);
        await assertNavAndHitTargets(page, device);
        assert.deepEqual(apiRequests.slice(historyStart).filter(request => !isReadOnlyApiRequest(request)), [], `browser ${direction} to ${name} must not authorize, apply, start, or otherwise mutate`);
      }
    }
    const historyRequests = apiRequests.slice(historyStart);
    assert.ok(historyRequests.some(request => request.pathname.endsWith("/changes")), "history really refreshes the populated Review panel");
    for (const method of ["thread/list", "thread/read"]) {
      assert.ok(historyRequests.some(request => request.pathname === "/api/codex/rpc" && JSON.parse(request.body).method === method), `history performs the allowed ${method} inventory read`);
    }
    await context.close();
  });
}
