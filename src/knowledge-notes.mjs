// Pure helpers for the Knowledge notes UI (list order, filters, Markdown
// export/import). No DOM access, so tests load this file directly.

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_TITLE_LENGTH = 300;

const text = value => (typeof value === "string" ? value : "");

export function normalizeNote(raw) {
  const note = raw && typeof raw === "object" ? raw : {};
  return {
    id: text(note.id),
    title: text(note.title),
    projectId: text(note.projectId) || null,
    createdAt: text(note.createdAt),
    updatedAt: text(note.updatedAt),
    pinned: note.pinned === true,
    content: text(note.content)
  };
}

function time(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Pinned notes first, then the most recently updated. */
export function sortNotes(notes) {
  return [...notes].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || time(b.updatedAt) - time(a.updatedAt) || a.id.localeCompare(b.id));
}

function fold(value) {
  return text(value).normalize("NFKC").toLocaleLowerCase().trim();
}

/** Title search ignores case and width; an empty query or project keeps every note. */
export function filterNotes(notes, { query = "", projectId = "" } = {}) {
  const needle = fold(query);
  return notes.filter(note =>
    (!needle || fold(note.title).includes(needle)) && (!projectId || note.projectId === projectId));
}

// The server counts UTF-16 units, so cut on that unit without splitting a surrogate pair.
function clip(value, limit) {
  let out = "";
  for (const char of value) {
    if (out.length + char.length > limit) break;
    out += char;
  }
  return out;
}

export function cleanTitle(value, fallback = "") {
  const title = text(value).replace(/[\0-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return clip(title, MAX_TITLE_LENGTH).trimEnd() || fallback;
}

export function duplicateTitle(title, suffix) {
  const tail = ` ${suffix}`;
  return clip(cleanTitle(title), MAX_TITLE_LENGTH - tail.length).trimEnd() + tail;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A file name that is safe on Windows, macOS and Linux, always ending in .md. */
export function exportFileName(title, fallback = "note") {
  let base = text(title).normalize("NFC")
    .replace(/[\0-\x1f\x7f\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_]+|[.\s]+$/g, "");
  base = Array.from(base).slice(0, 80).join("").replace(/[.\s]+$/g, "");
  if (!base || RESERVED_NAMES.test(base)) base = fallback;
  return base + ".md";
}

/** The exported file starts with the title as a heading, followed by the body as written. */
export function exportMarkdown(note) {
  const body = text(note?.content);
  return `# ${cleanTitle(note?.title, "note")}\n\n${body}${body && !body.endsWith("\n") ? "\n" : ""}`;
}

/**
 * Decode a picked Markdown file. Returns { ok: true, title, content } or
 * { ok: false, reason: "tooLarge" | "notUtf8" | "notText" }.
 */
export function decodeMarkdownFile(bytes, fileName = "") {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: "notText" };
  if (bytes.byteLength > MAX_IMPORT_BYTES) return { ok: false, reason: "tooLarge" };
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { ok: false, reason: "notUtf8" }; }
  if (decoded.includes("\0")) return { ok: false, reason: "notText" };
  const source = decoded.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  // Up to three leading spaces is still a heading; four or more is an indented code block.
  const heading = source.match(/^(?:[ \t]*\n)* {0,3}# +([^\n]+)\n*/);
  const fromName = text(fileName).replace(/^.*[\\/]/, "").replace(/\.(md|markdown|txt)$/i, "");
  const title = cleanTitle(heading?.[1].replace(/\s+#+\s*$/, ""), "") || cleanTitle(fromName, "");
  return { ok: true, title, content: heading && cleanTitle(heading[1]) ? source.slice(heading[0].length) : source };
}
