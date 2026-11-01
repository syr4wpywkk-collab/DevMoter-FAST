/**
 * Session Control search: one field with optional filter tokens.
 *   agent:codex  project:DevMoter-FAST  state:running  project:"My App"
 * Unknown keys (and anything else) stay free text.
 */
export const QUERY_KEYS = /** @type {const} */ (["agent", "project", "state"]);
const ALIASES = { agent: "agent", backend: "agent", project: "project", state: "state", status: "state" };
export const AGENT_VALUES = ["codex", "opencode"];
export const STATE_VALUES = ["running", "waiting", "done", "idle", "failed", "interrupted"];

const TOKEN = /(\S+?):("([^"]*)"?|\S*)|"([^"]*)"?|\S+/g;

/** Pure: split a query into filters and free text. */
export function parseSessionQuery(input) {
  const result = { text: "", agent: "", project: "", state: "" };
  const words = [];
  const source = String(input ?? "");
  for (const match of source.matchAll(TOKEN)) {
    const [whole, rawKey, rawValue, quoted, bareQuoted] = match;
    if (rawKey !== undefined) {
      const key = ALIASES[rawKey.toLowerCase()];
      const value = (quoted !== undefined ? quoted : rawValue).trim();
      if (key && value) { result[key] = key === "project" ? value : value.toLowerCase(); continue; }
      if (key && !value) continue; // a key still being typed filters nothing yet
      words.push(whole);
      continue;
    }
    words.push(bareQuoted !== undefined ? bareQuoted : whole);
  }
  result.text = words.join(" ").trim();
  return result;
}

const quote = value => (/\s/.test(value) ? `"${value}"` : value);

/** Pure: completions for the token at the end of the query. */
export function suggestSessionTokens(input, { projects = [] } = {}) {
  const source = String(input ?? "");
  const lastStart = source.search(/(?:\S+:"[^"]*|\S*)$/);
  const head = source.slice(0, lastStart);
  const last = source.slice(lastStart);
  const colon = last.indexOf(":");
  const complete = (token, label = token) => ({ label, value: `${head}${token} ` });
  if (colon < 0) {
    const prefix = last.toLowerCase();
    return QUERY_KEYS.filter(key => key.startsWith(prefix)).map(key => ({ label: `${key}:`, value: `${head}${key}:` }));
  }
  const key = ALIASES[last.slice(0, colon).toLowerCase()];
  const typed = last.slice(colon + 1).replace(/^"/, "").toLowerCase();
  const values = key === "agent" ? AGENT_VALUES : key === "state" ? STATE_VALUES : key === "project" ? [...new Set(projects.filter(Boolean))] : [];
  const starts = values.filter(value => value.toLowerCase().startsWith(typed));
  const contains = values.filter(value => !value.toLowerCase().startsWith(typed) && value.toLowerCase().includes(typed));
  return [...starts, ...contains]
    .slice(0, 8)
    .map(value => complete(`${key}:${quote(value)}`, `${key}:${value}`));
}

/** Pure: does one session match the parsed filters (free text is matched by the caller). */
export function matchesSessionFilters(session, query) {
  if (query.agent && session.backend !== query.agent) return false;
  if (query.state && session.status !== query.state) return false;
  if (query.project) {
    const wanted = query.project.toLowerCase();
    const path = String(session.project || "").replace(/\\/g, "/").replace(/\/+$/, "");
    const name = path.split("/").filter(Boolean).at(-1) || path;
    if (name.toLowerCase() !== wanted && path.toLowerCase() !== wanted) return false;
  }
  return true;
}
