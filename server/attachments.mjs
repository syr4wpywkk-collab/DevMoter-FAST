import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";

const ATTACHMENT_TYPES = Object.freeze(["image", "file", "url", "drive", "backend"]);
const DEFAULT_URL_LIMIT = 2 * 1024 * 1024;
const DEFAULT_REDIRECT_LIMIT = 3;
const DEFAULT_TIMEOUT_MS = 12000;

function publicAttachment(value) {
  return {
    id: value.id,
    type: value.type,
    name: value.name || "",
    mime: value.mime || null,
    size: Number.isFinite(value.size) ? value.size : null,
    source: value.source || null,
    metadata: value.metadata && typeof value.metadata === "object" ? structuredClone(value.metadata) : {}
  };
}

export function normalizeAttachment(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Attachment must be an object");
  const type = String(input.type || "").trim().toLowerCase();
  if (!ATTACHMENT_TYPES.includes(type)) throw new Error("Unsupported attachment type: " + type);
  const id = String(input.id || randomUUID()).slice(0, 160);
  const name = String(input.name || "").slice(0, 240);
  const mime = input.mime ? String(input.mime).slice(0, 160) : null;
  const size = input.size == null ? null : Number(input.size);
  if (size !== null && (!Number.isFinite(size) || size < 0)) throw new Error("Attachment size must be a non-negative number");
  const source = input.source ? String(input.source).slice(0, 2000) : null;
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? structuredClone(input.metadata)
    : {};
  return { id, type, name, mime, size, source, metadata };
}

export function negotiateAttachments(inputs, backend = {}) {
  const supported = new Set(
    Array.isArray(backend.attachmentTypes)
      ? backend.attachmentTypes.map(value => String(value).toLowerCase())
      : []
  );
  const attachments = (Array.isArray(inputs) ? inputs : []).map(normalizeAttachment);
  const unsupported = attachments.filter(item => !supported.has(item.type));
  if (unsupported.length) {
    const types = [...new Set(unsupported.map(item => item.type))];
    throw new Error("Backend does not support attachment type(s): " + types.join(", "));
  }
  return attachments.map(publicAttachment);
}

export function backendAttachmentCapabilities(backend) {
  const name = String(backend || "").toLowerCase();
  if (name === "codex") return { backend: "codex", attachmentTypes: ["image", "file", "url"] };
  if (name === "opencode") return { backend: "opencode", attachmentTypes: ["image", "file", "url"] };
  return { backend: name || "unknown", attachmentTypes: [] };
}

function parseIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return parts;
}

export function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase().split("%", 1)[0];
  const family = isIP(normalized);
  if (family === 4) {
    const p = parseIpv4(normalized);
    if (!p) return true;
    const [a, b] = p;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    return (
      normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
    );
  }
  return true;
}

export function previewUrlInput(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw new Error("URL must be a valid absolute http(s) URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URL attachments are supported");
  if (url.username || url.password) throw new Error("Embedded URL credentials are not allowed");
  if (url.port && !/^\d{1,5}$/.test(url.port)) throw new Error("Invalid URL port");
  return {
    normalizedUrl: url.href,
    origin: url.origin,
    host: url.hostname,
    port: url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + url.search,
    requiresExplicitFetch: true
  };
}

async function resolvePublicHost(hostname) {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Private or special-use network targets are blocked");
    return { address: hostname, family: isIP(hostname) };
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("URL host did not resolve");
  if (records.some(record => isPrivateAddress(record.address))) {
    throw new Error("URL host resolves to a private or special-use network");
  }
  return records[0];
}

function requestPinned(url, address, family, { timeoutMs, maxBytes }) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const req = transport.request(url, {
      method: "GET",
      headers: {
        accept: "text/html,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.1",
        "user-agent": "DevMoter-URLAttachment/1",
        host: url.host
      },
      lookup(_hostname, _options, callback) {
        callback(null, address, family);
      },
      servername: url.hostname,
      timeout: timeoutMs
    }, res => {
      const chunks = [];
      let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(Object.assign(new Error("URL attachment exceeds size limit"), { statusCode: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: Number(res.statusCode || 0),
          headers: res.headers,
          body: Buffer.concat(chunks, size)
        });
      });
      res.on("error", fail);
    });
    req.on("timeout", () => req.destroy(new Error("URL attachment fetch timed out")));
    req.on("error", fail);
    req.end();
  });
}

function extractReadableText(buffer, contentType) {
  const raw = buffer.toString("utf8");
  if (/html|xhtml/i.test(contentType)) {
    return raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
  return raw.replace(/\0/g, "").trim();
}

function contentTypeAllowed(value) {
  const type = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return type.startsWith("text/") || [
    "application/json", "application/xml", "application/xhtml+xml",
    "application/ld+json", "application/rss+xml", "application/atom+xml"
  ].includes(type);
}

export async function fetchUrlAttachment(value, options = {}) {
  const maxBytes = Math.min(8 * 1024 * 1024, Math.max(16 * 1024, Number(options.maxBytes) || DEFAULT_URL_LIMIT));
  const maxRedirects = Math.min(5, Math.max(0, Number(options.maxRedirects) || DEFAULT_REDIRECT_LIMIT));
  const timeoutMs = Math.min(30000, Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  let preview = previewUrlInput(value);
  let current = new URL(preview.normalizedUrl);
  const redirects = [];

  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const resolved = await resolvePublicHost(current.hostname);
    const response = await requestPinned(current, resolved.address, resolved.family, { timeoutMs, maxBytes });
    if (response.status >= 300 && response.status < 400) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      if (!location) throw new Error("URL attachment redirect is missing Location");
      if (attempt >= maxRedirects) throw new Error("URL attachment exceeded redirect limit");
      const next = new URL(location, current);
      previewUrlInput(next.href);
      redirects.push({ from: current.href, to: next.href, status: response.status });
      current = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error("URL attachment fetch failed with HTTP " + response.status), { statusCode: 502 });
    }

    const contentType = String(response.headers["content-type"] || "text/plain");
    if (!contentTypeAllowed(contentType)) {
      throw Object.assign(new Error("URL attachment content type is not supported: " + contentType.split(";", 1)[0]), { statusCode: 415 });
    }
    const text = extractReadableText(response.body, contentType);
    const titleMatch = response.body.toString("utf8").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const attachment = normalizeAttachment({
      type: "url",
      name: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 240) : current.hostname,
      mime: contentType.split(";", 1)[0],
      size: response.body.length,
      source: current.href,
      metadata: {
        originalUrl: preview.normalizedUrl,
        finalUrl: current.href,
        redirectCount: redirects.length
      }
    });
    return {
      attachment: publicAttachment(attachment),
      text: text.slice(0, Math.min(500000, maxBytes)),
      redirects
    };
  }
  throw new Error("URL attachment fetch failed");
}

export { ATTACHMENT_TYPES };
