import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  buildModelRegistry, createArtifactRegistry, createGrantRegistry, parseRoutingRules,
  previewFile, providerConfigFromEnv, runWithRouting, sandboxStatus
} from "./advanced-features.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }); }
}

function safeFilename(value) {
  return basename(String(value || "download")).replace(/[\r\n"\\]/g, "_").slice(0, 180) || "download";
}

function mimeForDownload(path) {
  const ext = extname(path).toLowerCase();
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".avif": "image/avif", ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8"
  })[ext] || "application/octet-stream";
}

function loopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

const LIVE_PREVIEW_LIMIT = 20 * 1024 * 1024;

function previewBaseUrl(host, port) {
  const safeHost = host === "::1" ? "[::1]" : host;
  return new URL("http://" + safeHost + ":" + port + "/");
}

async function readBoundedResponseBody(response, limit = LIVE_PREVIEW_LIMIT) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw Object.assign(new Error("Live preview response is too large"), { statusCode: 413 });
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Object.assign(new Error("Live preview response is too large"), { statusCode: 413 });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, size);
}

function publicProvider(provider) {
  const { apiKey, ...rest } = provider;
  return { ...rest, secretConfigured: Boolean(apiKey) };
}

export function createAdvancedApi({ homeDir, configDir, getProjectById, env = process.env, fetchImpl = fetch }) {
  const grants = createGrantRegistry({
    file: resolve(configDir, "directory-grants.json"),
    homeDir,
    allowExternal: env.DEVMOTER_ALLOW_EXTERNAL_GRANTS === "1"
  });
  const artifacts = createArtifactRegistry({ file: resolve(configDir, "artifacts.json") });
  const previews = new Map();
  const routingLog = [];

  async function approvedOutputRoots(project) {
    const roots = [{ id: "project", label: "Project", path: await realpath(project.path) }];
    const configured = String(env.DEVMOTER_OUTPUT_ROOTS || "").split(":").map(x => x.trim()).filter(Boolean);
    for (let index = 0; index < configured.length; index++) {
      try {
        const path = await realpath(configured[index]);
        const info = await stat(path);
        if (info.isDirectory()) roots.push({ id: "output-" + (index + 1), label: "Output " + (index + 1), path });
      } catch {
        // Invalid configured output roots stay unavailable rather than expanding access.
      }
    }
    return roots;
  }

  async function proxyLivePreview(req, res, url, token, suffix) {
    const preview = [...previews.values()].find(item => item.token === token);
    if (!preview) { sendJson(res, 404, { error: "Preview is stopped or token is invalid" }); return; }
    if (!new Set(["GET", "HEAD"]).has(req.method)) { sendJson(res, 405, { error: "Live preview proxy is read-only" }); return; }
    if (!loopbackHost(preview.host)) { sendJson(res, 403, { error: "Preview host is not allowed" }); return; }

    const rawSuffix = String(suffix || "/");
    if (!rawSuffix.startsWith("/") || rawSuffix.startsWith("//") || rawSuffix.includes("\\") || /%5c/i.test(rawSuffix)) {
      sendJson(res, 400, { error: "Invalid live preview path" });
      return;
    }
    const target = new URL("." + rawSuffix, previewBaseUrl(preview.host, preview.port));
    target.search = url.search;
    if (!loopbackHost(target.hostname) || Number(target.port || preview.port) !== preview.port) {
      sendJson(res, 403, { error: "Preview target escaped the approved loopback endpoint" });
      return;
    }
    const upstream = await fetchImpl(target, {
      method: req.method,
      headers: { accept: String(req.headers.accept || "*/*"), "user-agent": "DevMoter-LivePreview/1" },
      redirect: "manual"
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (location) {
        const next = new URL(location, target);
        if (!loopbackHost(next.hostname) || Number(next.port || preview.port) !== preview.port) {
          sendJson(res, 502, { error: "Preview redirect escaped the approved loopback target" });
          return;
        }
      }
    }

    const headers = {
      "cache-control": "no-store",
      "content-security-policy": "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; default-src 'self' data: blob: http: https:; connect-src 'self' http: https: ws: wss:",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    };
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers["content-type"] = contentType;
    const location = upstream.headers.get("location");
    if (location) {
      const next = new URL(location, target);
      if (loopbackHost(next.hostname) && Number(next.port || preview.port) === preview.port) {
        headers.location = "/api/live-preview/proxy/" + token + next.pathname + next.search;
      }
    }
    if (req.method === "HEAD") {
      res.writeHead(upstream.status, headers);
      res.end();
      return;
    }
    const body = await readBoundedResponseBody(upstream);
    res.writeHead(upstream.status, headers);
    res.end(body);
  }

  async function handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/api/advanced/models") {
        const registry = await buildModelRegistry(env, fetchImpl);
        sendJson(res, 200, {
          ...registry,
          routingRules: parseRoutingRules(env),
          failoverChain: String(env.DEVMOTER_PROVIDER_FAILOVER || "").split(",").map(x => x.trim()).filter(Boolean),
          recentRouting: routingLog.slice(-20)
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/advanced/models/run") {
        const payload = await readJson(req, 2 * 1024 * 1024);
        const messages = Array.isArray(payload.messages)
          ? payload.messages.slice(-40).map(item => ({
              role: String(item.role || "user"),
              content: String(item.content || "").slice(0, 200000)
            }))
          : [];
        if (!messages.length) throw Object.assign(new Error("At least one message is required"), { statusCode: 400 });
        const result = await runWithRouting({
          env, fetchImpl, messages, role: String(payload.role || "coding"),
          requirements: payload.requirements || {}, override: payload.override || null,
          failover: payload.failover !== false
        });
        const decision = {
          at: Date.now(), role: String(payload.role || "coding"),
          providerId: result.providerId, model: result.model,
          reason: result.routeReason, attempts: result.attempts
        };
        routingLog.push(decision);
        if (routingLog.length > 100) routingLog.splice(0, routingLog.length - 100);
        sendJson(res, 200, {
          text: result.text,
          handledBy: { providerId: result.providerId, model: result.model },
          routing: decision
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/advanced/providers") {
        sendJson(res, 200, { providers: providerConfigFromEnv(env).map(publicProvider) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/advanced/sandbox") {
        sendJson(res, 200, sandboxStatus({ env }));
        return true;
      }

      if (url.pathname === "/api/advanced/grants") {
        if (req.method === "GET") { sendJson(res, 200, { grants: await grants.list() }); return true; }
        if (req.method === "POST") {
          const payload = await readJson(req);
          const grant = await grants.add(payload.path, payload.mode);
          sendJson(res, 201, { grant });
          return true;
        }
      }

      const grantMatch = url.pathname.match(/^\/api\/advanced\/grants\/([^/]+)$/);
      if (grantMatch && req.method === "DELETE") {
        const ok = await grants.revoke(decodeURIComponent(grantMatch[1]));
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Grant not found" });
        return true;
      }

      const projectPreview = url.pathname.match(/^\/api\/projects\/([^/]+)\/preview$/);
      if (projectPreview && req.method === "GET") {
        const project = await getProjectById(decodeURIComponent(projectPreview[1]));
        const path = url.searchParams.get("path") || "";
        sendJson(res, 200, { preview: await previewFile(project.path, path) });
        return true;
      }

      const projectArtifacts = url.pathname.match(/^\/api\/projects\/([^/]+)\/artifacts$/);
      if (projectArtifacts) {
        const projectId = decodeURIComponent(projectArtifacts[1]);
        const project = await getProjectById(projectId);
        if (req.method === "GET") {
          sendJson(res, 200, {
            artifacts: await artifacts.list(url.searchParams.get("session") || "", projectId),
            roots: (await approvedOutputRoots(project)).map(({ id, label, path }) => ({ id, label, path }))
          });
          return true;
        }
        if (req.method === "POST") {
          const payload = await readJson(req);
          const roots = await approvedOutputRoots(project);
          const root = roots.find(item => item.id === String(payload.rootId || "project"));
          if (!root) throw Object.assign(new Error("Output root is not approved"), { statusCode: 400 });
          const artifact = await artifacts.register({
            sessionId: payload.sessionId, projectId, root: root.path, relativePath: payload.path
          });
          sendJson(res, 201, { artifact });
          return true;
        }
      }

      const artifactPreview = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/preview$/);
      if (artifactPreview && req.method === "GET") {
        const { artifact } = await artifacts.get(decodeURIComponent(artifactPreview[1]));
        sendJson(res, 200, { artifact, preview: await previewFile(artifact.root, artifact.path) });
        return true;
      }

      const artifactDownload = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/download$/);
      if (artifactDownload && req.method === "GET") {
        const { artifact, resolved } = await artifacts.get(decodeURIComponent(artifactDownload[1]));
        const info = await stat(resolved.target);
        if (info.size > 64 * 1024 * 1024) {
          throw Object.assign(new Error("Artifact is too large to download through DevMoter"), { statusCode: 413 });
        }
        const data = await readFile(resolved.target);
        res.writeHead(200, {
          "content-type": mimeForDownload(resolved.target),
          "content-length": String(data.length),
          "content-disposition": 'attachment; filename="' + safeFilename(artifact.name) + '"',
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        res.end(data);
        return true;
      }

      const webPreview = url.pathname.match(/^\/api\/projects\/([^/]+)\/web-preview$/);
      if (webPreview) {
        const projectId = decodeURIComponent(webPreview[1]);
        await getProjectById(projectId);
        if (req.method === "GET") {
          const item = previews.get(projectId) || null;
          sendJson(res, 200, {
            preview: item ? { ...item, url: "/api/live-preview/proxy/" + item.token + "/" } : null
          });
          return true;
        }
        if (req.method === "POST") {
          const payload = await readJson(req);
          const port = Number(payload.port);
          const host = String(payload.host || "127.0.0.1");
          if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            throw Object.assign(new Error("Preview port must be between 1024 and 65535"), { statusCode: 400 });
          }
          if (!loopbackHost(host)) {
            throw Object.assign(new Error("Live preview targets must use a loopback host"), { statusCode: 400 });
          }
          const item = {
            projectId, host, port, token: randomBytes(24).toString("hex"), startedAt: Date.now()
          };
          previews.set(projectId, item);
          sendJson(res, 200, {
            preview: { ...item, url: "/api/live-preview/proxy/" + item.token + "/" }
          });
          return true;
        }
        if (req.method === "DELETE") {
          previews.delete(projectId);
          sendJson(res, 200, { ok: true });
          return true;
        }
      }

      const proxyMatch = url.pathname.match(/^\/api\/live-preview\/proxy\/([a-f0-9]{48})(\/.*)?$/);
      if (proxyMatch) {
        await proxyLivePreview(req, res, url, proxyMatch[1], proxyMatch[2] || "/");
        return true;
      }

      return false;
    } catch (error) {
      const status = Number(
        error?.statusCode || error?.status ||
        (String(error?.message || "").toLowerCase().includes("not found") ? 404 : 400)
      );
      sendJson(res, status >= 400 && status < 600 ? status : 500, {
        error: error instanceof Error ? error.message : String(error),
        attempts: error?.attempts
      });
      return true;
    }
  }

  return { handle, grants, artifacts, previews };
}
