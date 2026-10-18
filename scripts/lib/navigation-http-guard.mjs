import assert from "node:assert/strict";
import { createRequestGuard, isStaticRequest } from "./navigation-request-guard.mjs";

// The very same route handler is used by the real UI test and negative control.
export async function installNavigationHttpGuard(context, options) {
  const requests = [], external = [], violations = [];
  const inspect = createRequestGuard(options);
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const record = {
      path: url.pathname, method: request.method(), body: request.postData() || "",
      url: request.url(), headers: await request.allHeaders(),
      preparingAttachment: Boolean(options.isPreparingAttachment?.()), resourceType: request.resourceType(),
    };
    requests.push(record);
    const findings = inspect(record);
    record.findings = findings;
    violations.push(...findings);
    if (url.origin !== options.origin) external.push(record.url);
    if (findings.length || url.origin !== options.origin) return route.abort();
    // Unknown dynamic GETs never receive a successful empty mock response.
    if (isStaticRequest(record)) return route.continue();
    let payload = {};
    if (url.pathname === "/api/projects") payload = { projects: [] };
    else if (url.pathname === "/api/codex/upload") payload = { uploadId: options.uploadId };
    else if (url.pathname === "/api/codex/rpc") payload = { result: { data: [] } };
    else if (url.pathname.startsWith("/api/opencode/")) payload = { data: [] };
    else if (url.pathname === "/api/auth/status") payload = { authenticated: true };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  return { requests, external, violations };
}

export async function selfTestNavigationHttpGuard(browser, options) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const audit = await installNavigationHttpGuard(context, options);
    const page = await context.newPage();
    await page.goto("data:text/html,<title>synthetic HTTP guard negative control</title>");
    const failed = await page.evaluate(async url => {
      try { await fetch(url); return false; } catch { return true; }
    }, `${options.origin}/unexpected`);
    assert.equal(failed, true, "unknown GET must reject, not return an empty successful mock");
    assert.ok(audit.requests.some(record => record.path === "/unexpected" && record.method === "GET" && record.resourceType === "fetch"));
    assert.deepEqual(audit.violations, ["unexpected non-static request"]);
    return audit;
  } finally { await context.close(); }
}
