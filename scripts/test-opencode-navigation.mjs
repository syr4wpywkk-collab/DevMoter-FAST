import assert from "node:assert/strict";
import { createServer } from "vite";
import { webkit } from "playwright";
import { inspectRequest, isStaticRequest, isExpectedUpload } from "./lib/navigation-request-guard.mjs";

const synthetic = {
  draft: "Synthetic conversation: person@example.invalid; no real personal data",
  attachmentName: "synthetic-private.txt",
  attachmentContent: "synthetic-attachment-content",
  uploadId: "synthetic-upload-id",
  credential: "synthetic-device-credential"
};

// Run the real frontend, never a live application backend. All API responses
// are synthetic; cross-origin requests and WebSockets are blocked.
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await webkit.launch({ headless: true });
  for (const unified of ["1", "0"]) {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block", isMobile: viewport.width < 681, hasTouch: viewport.width < 681 });
      try {
        await context.addInitScript(() => {
          localStorage.setItem("opencode-pocket-opencode-session", "synthetic-retained-session");
          localStorage.setItem("opencode-pocket-backend", "opencode");
          localStorage.setItem("devmoter-device-token", "synthetic-device-credential");
        });
        const page = await context.newPage();
        await context.routeWebSocket("**/*", socket => socket.close());
        const requests = [];
        const external = [];
        const violations = [];
        let preparingAttachment = false;
        // Context-wide routing also covers popups and worker HTTP traffic.
        await context.route("**/*", async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin) {
            external.push(request.url());
            return route.abort();
          }
          const body = request.postData() || "";
          const record = { path: url.pathname, method: request.method(), body, url: request.url(), headers: await request.allHeaders(), preparingAttachment, resourceType: request.resourceType() };
          requests.push(record);
          const findings = inspectRequest(record, { origin, ...synthetic });
          violations.push(...findings);
          if (findings.length) return route.abort();
          // Only known static GETs reach Vite. Every other request is inspected
          // and mocked, including non-/api endpoints and non-GET asset URLs.
          if (isStaticRequest(record)) return route.continue();
          let payload = {};
          if (url.pathname === "/api/projects") payload = { projects: [] };
          else if (url.pathname === "/api/codex/upload") payload = { uploadId: "synthetic-upload-id" };
          else if (url.pathname === "/api/codex/rpc") payload = { result: { data: [] } };
          else if (url.pathname.startsWith("/api/opencode/")) payload = { data: [] };
          else if (url.pathname === "/api/auth/status") payload = { authenticated: true };
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
        });
        await page.goto(`${origin}/?surface=opencode&unifiedUI=${unified}`);
        await page.locator("#ocxMenu").waitFor().catch(error => {
          console.error("Initialization request classifications:", requests.map(request => ({ path: request.path, type: request.resourceType, static: isStaticRequest(request) })), violations);
          throw error;
        });
        if (unified === "1") await page.locator("#dmTaskFirstWorkspace").waitFor().catch(error => {
          console.error("Unified initialization non-static paths:", [...new Set(requests.filter(request => !isStaticRequest(request)).map(request => request.path))], violations);
          throw error;
        });
        // Fill the actual composer and pending-attachment queue, not DOM stand-ins.
        const { draft } = synthetic;
        await page.locator("#ocxPromptInput").evaluate((node, value) => {
          node.value = value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
        }, draft);
        preparingAttachment = true;
        await page.locator("#ocxFileInput").setInputFiles({ name: "synthetic-private.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic-attachment-content") });
        await page.waitForFunction(() => document.querySelector("#ocxAttachmentStrip")?.textContent.includes("synthetic-private.txt"));
        preparingAttachment = false;
        for (const [button, surface, destination] of [["#ocxQuickCodex", "codex", "#cxMenu"], ["#ocxQuickApi", "api", "#apiMenu"]]) {
          await page.locator("#ocxMenu").click();
          await page.locator("#ocxSidebar.open").waitFor();
          await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
          await page.evaluate(() => {
            const scroll = document.querySelector(".ocx-sidebar-scroll");
            const content = document.createElement("div");
            content.style.height = "3000px";
            content.textContent = "Synthetic long history";
            scroll.append(content);
            scroll.scrollTop = scroll.scrollHeight;
          });
          for (const selector of ["#ocxQuickCodex", "#ocxQuickApi"]) {
            const box = await page.locator(selector).boundingBox();
            assert.ok(box && box.width >= 44 && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height);
            const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.id, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
            assert.equal(hit, selector.slice(1));
          }
          await page.locator(button).click();
          await page.waitForFunction(expected => new URL(location.href).searchParams.get("surface") === expected, surface);
          await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), destination);
          assert.equal(await page.locator("#ocxSidebar").getAttribute("aria-hidden"), "true");
          assert.equal(await page.locator("#ocxSidebar").evaluate(node => node.inert), true);
          assert.equal(await page.locator("#ocxScrim").isVisible(), false);
          // Exercise native history in both directions through the real router.
          await page.goBack();
          await page.waitForFunction(() => new URL(location.href).searchParams.get("surface") === "opencode");
          await page.goForward();
          await page.waitForFunction(expected => new URL(location.href).searchParams.get("surface") === expected, surface);
          await page.goBack();
          await page.waitForFunction(() => new URL(location.href).searchParams.get("surface") === "opencode");
          assert.equal(await page.locator("#ocxPromptInput").inputValue(), draft);
          assert.match(await page.locator("#ocxAttachmentStrip").textContent(), /synthetic-private\.txt/);
          assert.equal(await page.evaluate(() => localStorage.getItem("opencode-pocket-opencode-session")), "synthetic-retained-session");
        }
        assert.equal(requests.filter(request => isExpectedUpload(request, { origin, ...synthetic })).length, 1, "exercise exactly one expected synthetic attachment upload");
        assert.ok(requests.some(isStaticRequest), "record static GETs as well as dynamic traffic");
        assert.deepEqual(external, [], "no request may leave the synthetic same-origin backend");
        assert.deepEqual(violations, [], "all HTTP phases must preserve authentication, draft, attachment and mutation boundaries");
        console.log(`PASS unifiedUI=${unified}, viewport=${viewport.width}x${viewport.height}: pinned 44px exits, real routing/focus, Back/Forward, retained draft/session/attachment, mocked send boundary`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
