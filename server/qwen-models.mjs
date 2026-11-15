// Qwen Code model picker, server side. Lists only what the qwen CLI itself
// can run: the models declared in its own settings (`modelProviders`, the
// list `/model` shows) and the providers its `/auth` menu installs
// (server/qwen-code-providers.mjs, generated from qwen-code v0.26.6).
//
// Keys never leave the server and never reach argv: an installed key is
// written where `/auth` writes it (settings.json `env`, qwen-code
// docs/users/configuration/auth.md "settings.json → env field"), and a run
// only passes `--auth-type <protocol> --model <id>` (auth.md "Step 3", and
// packages/cli/src/config/config.ts: selectedAuthType = argv.authType ||
// settings…; modelConfigUtils.ts: argv.model > settings.model.name).
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath } from "node:path";
import { QWEN_CODE_PRESET_VERSION, QWEN_CODE_PROVIDERS } from "./qwen-code-providers.mjs";
import { readHandle, withOpenFile } from "./safe-file.mjs";

// packages/cli/src/config/top-level-options.ts AUTH_TYPE_CHOICES.
export const QWEN_AUTH_TYPES = Object.freeze(["openai", "openai-responses", "anthropic", "qwen-oauth", "gemini", "vertex-ai"]);
// Default key per protocol when a model entry has no envKey (auth.md "Supported protocols").
const DEFAULT_ENV_KEYS = { openai: "OPENAI_API_KEY", "openai-responses": "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", "vertex-ai": "GOOGLE_API_KEY" };
// install.ts DENY_ENV_KEYS: an install never sets these.
const DENY_ENV_KEYS = new Set(["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "PATH", "HOME", "TMPDIR", "TMP", "TEMP"]);
const CUSTOM_PREFIX = "QWEN_CUSTOM_API_KEY_";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const MAX_MODELS = 300;
const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;

export class QwenModelError extends Error {
  constructor(message, status = 400, code = "invalid") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// storage.ts getGlobalSettingsPath: $QWEN_HOME/settings.json or ~/.qwen/settings.json.
export function userSettingsPath(env = process.env, home = homedir()) {
  return join(env.QWEN_HOME ? String(env.QWEN_HOME) : join(home, ".qwen"), "settings.json");
}

// qwen reads settings.json with comments allowed; strip them for reading only.
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

async function readSettingsFile(path) {
  let raw;
  try {
    // Open once with O_NOFOLLOW and fstat + read the same file descriptor (no TOCTOU).
    raw = await withOpenFile(path, { noFollow: true }, async (handle, info) => {
      if (!info.isFile()) {
        throw new QwenModelError("Qwen Code の設定を読めませんでした", 500, "settings_unreadable");
      }
      if (info.size > MAX_SETTINGS_BYTES) {
        throw new QwenModelError("Qwen Code の設定ファイルが大きすぎます", 500, "settings_unreadable");
      }
      return readHandle(handle, MAX_SETTINGS_BYTES, "utf8");
    });
  } catch (error) {
    if (error instanceof QwenModelError) throw error;
    if (error?.code === "ENOENT") return { exists: false, raw: "", data: {} };
    if (error?.code === "EFBIG") throw new QwenModelError("Qwen Code の設定ファイルが大きすぎます", 500, "settings_unreadable");
    throw new QwenModelError("Qwen Code の設定を読めませんでした", 500, "settings_unreadable");
  }
  try {
    const data = raw.trim() ? parseJsonc(raw) : {};
    return { exists: true, raw, data: data && typeof data === "object" && !Array.isArray(data) ? data : {} };
  } catch {
    throw new QwenModelError("Qwen Code の settings.json を読めませんでした。書式を確認してください", 500, "settings_invalid");
  }
}

// Only the variable names of the first .env qwen would load (auth.md Step 2:
// .qwen/.env then .env walking up from the project, then ~/.qwen/.env, ~/.env).
async function dotenvNames(cwd, home) {
  const candidates = [];
  if (cwd) {
    let dir = cwd;
    for (;;) {
      candidates.push(join(dir, ".qwen", ".env"), join(dir, ".env"));
      const parent = dirname(dir);
      if (parent === dir || dir === parsePath(dir).root) break;
      dir = parent;
    }
  }
  candidates.push(join(home, ".qwen", ".env"), join(home, ".env"));
  for (const file of candidates) {
    let text;
    try {
      text = await withOpenFile(file, { noFollow: true }, async (handle, info) => {
        if (!info.isFile() || info.size > MAX_SETTINGS_BYTES) return null;
        return readHandle(handle, MAX_SETTINGS_BYTES, "utf8");
      });
    } catch {
      continue;
    }
    if (text === null) continue;
    const names = new Set();
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match && match[2].trim().replace(/^['"]|['"]$/g, "")) names.add(match[1]);
    }
    return names;
  }
  return new Set();
}

function hostOf(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return "";
  }
}

// modelRegistry.ts resolveProviderProtocol / resolveModelProtocol.
function entryAuthType(providerKey, entry, providerProtocol) {
  const mapped = providerProtocol && Object.hasOwn(providerProtocol, providerKey) ? providerProtocol[providerKey] : providerKey;
  if (!QWEN_AUTH_TYPES.includes(mapped)) return null;
  if (entry.wireApi === undefined) return mapped;
  if (mapped !== "openai" && mapped !== "openai-responses") return null;
  if (entry.wireApi === "responses") return "openai-responses";
  if (entry.wireApi === "chat-completions") return "openai";
  return null;
}

// Which /auth provider installed an entry (envKey + its base URLs).
function presetFor(entry) {
  if (typeof entry.envKey === "string" && entry.envKey.startsWith(CUSTOM_PREFIX)) return QWEN_CODE_PROVIDERS.find(p => p.id === "custom-openai-compatible");
  return QWEN_CODE_PROVIDERS.find(p => p.envKey && p.envKey === entry.envKey && p.baseUrls.some(option => option.url === entry.baseUrl)) ?? null;
}

function groupFor(entry) {
  const preset = presetFor(entry);
  const host = hostOf(entry.baseUrl);
  if (preset && preset.id !== "custom-openai-compatible") {
    const option = preset.baseUrls.find(item => item.url === entry.baseUrl);
    return { id: `${preset.id}:${option?.id ?? "default"}`, label: option?.prefix || preset.label };
  }
  return { id: `custom:${host || "default"}`, label: host || "カスタム" };
}

function unsupportedReason(entry, authType) {
  if (!authType) return "Qwen Code が対応していないプロトコルです";
  if (authType === "qwen-oauth") return "Qwen OAuth は 2026-04-15 に終了しました";
  if (entry.imageOnly) return "画像生成専用のモデルです";
  if (entry.voiceOnly) return "音声文字起こし専用のモデルです";
  if (entry.realtimeOnly) return "リアルタイム音声専用のモデルです";
  return "";
}

/**
 * Lists the models qwen would offer in this project. Never returns key values;
 * `secrets` (server-only) carries the configured key values for redaction.
 */
export async function listQwenModels({ cwd = "", env = process.env, home = homedir(), childEnv = {} } = {}) {
  const userPath = userSettingsPath(env, home);
  const user = await readSettingsFile(userPath);
  const workspace = cwd ? await readSettingsFile(join(cwd, ".qwen", "settings.json")) : { exists: false, data: {} };
  // settingsSchema.ts: modelProviders / providerProtocol use MergeStrategy.REPLACE,
  // so a project's own list replaces the user list wholesale.
  const fromWorkspace = workspace.data.modelProviders && typeof workspace.data.modelProviders === "object";
  const scope = fromWorkspace ? "workspace" : user.data.modelProviders ? "user" : "none";
  const modelProviders = (fromWorkspace ? workspace.data.modelProviders : user.data.modelProviders) || {};
  const providerProtocol = (workspace.data.providerProtocol ?? user.data.providerProtocol) || {};
  const settingsEnv = { ...(user.data.env || {}), ...(workspace.data.env || {}) };
  const dotenv = await dotenvNames(cwd, home);
  const hasKey = name => Boolean(name && (String(settingsEnv[name] ?? "").trim() || String(childEnv[name] ?? "").trim() || dotenv.has(name)));

  const groups = new Map();
  const seen = new Set();
  const models = [];
  const secrets = new Map();
  for (const [providerKey, list] of Object.entries(modelProviders)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list.slice(0, MAX_MODELS)) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id.trim()) continue;
      const authType = entryAuthType(providerKey, entry, providerProtocol);
      const envKey = typeof entry.envKey === "string" && entry.envKey ? entry.envKey : DEFAULT_ENV_KEYS[authType] || "";
      let reason = unsupportedReason(entry, authType);
      const identity = `${authType}\0${entry.id}`;
      // modelConfigUtils.ts: with --model, the first entry with that id wins.
      if (!reason && seen.has(identity)) reason = "同じIDのモデルが先に登録されています";
      if (!reason && authType !== "vertex-ai" && !hasKey(envKey)) reason = "APIキーが未設定です";
      if (!reason) seen.add(identity);
      const group = groupFor(entry);
      if (!groups.has(group.id)) groups.set(group.id, { id: group.id, label: group.label });
      const value = String(settingsEnv[envKey] ?? "");
      if (value.length >= 8) secrets.set(identity, value);
      models.push({
        id: entry.id,
        name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
        authType: authType ?? String(providerKey),
        group: group.id,
        host: hostOf(entry.baseUrl),
        ...(typeof entry.description === "string" ? { description: entry.description.slice(0, 200) } : {}),
        ...(reason ? { disabled: true, reason } : {})
      });
    }
  }
  return {
    version: QWEN_CODE_PRESET_VERSION,
    scope,
    defaultModel: typeof (workspace.data.model?.name ?? user.data.model?.name) === "string" ? (workspace.data.model?.name ?? user.data.model?.name) : null,
    groups: [...groups.values()],
    models,
    secrets
  };
}

export function publicQwenModelList(listing) {
  const { secrets: _secrets, ...rest } = listing;
  return rest;
}

/** The add-API choices: exactly the /auth providers, without key material. */
export function publicQwenPresets() {
  return QWEN_CODE_PROVIDERS.map(provider => ({
    id: provider.id,
    label: provider.label,
    group: provider.group,
    title: provider.flowTitle || (provider.group === "third-party" ? "Third-party Providers" : provider.group === "custom" ? "Custom Provider" : provider.label),
    baseUrls: provider.baseUrls.map(({ id, label }) => ({ id, label })),
    custom: provider.id === "custom-openai-compatible",
    protocols: provider.protocolOptions ?? [provider.protocol],
    modelsEditable: provider.modelsEditable,
    keyPlaceholder: provider.keyPlaceholder ?? "",
    models: provider.models.map(model => ({
      id: model.id,
      ...(model.imageOnly ? { disabled: true, reason: "画像生成専用のモデルです" } : {})
    }))
  }));
}

/** Turns a client selection into CLI args, or null for the CLI default. */
export function resolveQwenModelSelection(selection, listing) {
  if (selection == null || selection === "") return null;
  if (typeof selection !== "object") throw new QwenModelError("モデルの指定が不正です");
  const id = String(selection.id || "");
  const authType = String(selection.authType || "");
  if (!MODEL_ID.test(id) || !QWEN_AUTH_TYPES.includes(authType)) throw new QwenModelError("モデルの指定が不正です");
  const model = listing.models.find(item => item.id === id && item.authType === authType && !item.disabled);
  if (!model) {
    const known = listing.models.find(item => item.id === id && item.authType === authType);
    throw new QwenModelError(known ? `このモデルは使えません: ${known.reason}` : "このモデルは Qwen Code に登録されていません", 400, "unknown_model");
  }
  return { args: ["--auth-type", authType, "--model", id], label: model.name, secret: listing.secrets.get(`${authType}\0${id}`) || "" };
}

// custom-provider.ts generateCustomEnvKey.
function envSegment(value) {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
export function customEnvKey(protocol, baseUrl) {
  const canonical = String(baseUrl).trim().replace(/\/+$/, "");
  const suffix = createHash("sha256").update(`${protocol}\0${canonical}`).digest("hex").slice(0, 12).toUpperCase();
  return `${CUSTOM_PREFIX}${envSegment(protocol)}_${envSegment(baseUrl)}_${suffix}`;
}

function customBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new QwenModelError("Base URL が正しくありません");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new QwenModelError("Base URL は https にしてください（http は localhost のみ）");
  if (url.username || url.password || url.search || url.hash) throw new QwenModelError("Base URL にユーザー名やクエリは入れられません");
  return url.toString().replace(/\/+$/, "");
}

// provider-config.ts buildGenerationConfig (the subset presets use).
function generationConfig(spec) {
  const config = {};
  if (spec.enableThinking) config.extra_body = { enable_thinking: true };
  if (spec.thinkingMandatory) config.thinkingMandatory = true;
  if (spec.contextWindowSize) config.contextWindowSize = spec.contextWindowSize;
  if (spec.modalities && Object.values(spec.modalities).some(Boolean)) config.modalities = spec.modalities;
  return Object.keys(config).length ? config : undefined;
}

function buildEntries(preset, { baseUrl, prefix, envKey, modelIds }) {
  const specs = new Map(preset.models.map(spec => [spec.id.toLowerCase(), spec]));
  return modelIds.map(id => {
    const spec = specs.get(id.toLowerCase()) || { id };
    const gen = generationConfig(spec);
    const headers = preset.customHeaders ? { customHeaders: { ...preset.customHeaders } } : null;
    const merged = gen || headers ? { ...(gen || {}), ...(headers || {}) } : undefined;
    return {
      id,
      name: prefix ? `[${prefix}] ${id}` : id,
      ...(spec.description ? { description: spec.description } : {}),
      ...(spec.capabilities ? { capabilities: spec.capabilities } : {}),
      baseUrl,
      envKey,
      ...(merged ? { generationConfig: merged } : {})
    };
  });
}

export function planQwenProviderInstall(input) {
  const preset = QWEN_CODE_PROVIDERS.find(item => item.id === String(input?.presetId || ""));
  if (!preset) throw new QwenModelError("Qwen Code が対応していないプロバイダーです");
  const apiKey = String(input?.apiKey || "").trim();
  if (!apiKey) throw new QwenModelError("APIキーを入力してください");
  if (apiKey.length > 512 || /\s/.test(apiKey)) throw new QwenModelError("APIキーの形式が正しくありません");
  if (preset.keyRule) {
    const { prefix, notPrefix } = preset.keyRule;
    if (!apiKey.startsWith(prefix) || (notPrefix && apiKey.startsWith(notPrefix))) {
      throw new QwenModelError(notPrefix ? `このプランのキーは「${prefix}」で始まります（「${notPrefix}」は Token Plan 用）` : `このプランのキーは「${prefix}」で始まります`);
    }
  }
  let baseUrl;
  let prefix;
  let protocol = preset.protocol;
  let envKey;
  const custom = preset.id === "custom-openai-compatible";
  if (custom) {
    protocol = String(input?.protocol || "openai");
    if (!preset.protocolOptions.includes(protocol)) throw new QwenModelError("プロトコルを選んでください");
    baseUrl = customBaseUrl(input?.baseUrl);
    prefix = "";
    envKey = customEnvKey(protocol, baseUrl);
  } else {
    const option = preset.baseUrls.find(item => item.id === String(input?.baseUrlId || "")) ?? (preset.baseUrls.length === 1 ? preset.baseUrls[0] : null);
    if (!option) throw new QwenModelError("リージョンを選んでください");
    baseUrl = option.url;
    prefix = option.prefix;
    envKey = preset.envKey;
  }
  if (!ENV_NAME.test(envKey) || DENY_ENV_KEYS.has(envKey)) throw new QwenModelError("キーの保存先が不正です", 500, "failed");
  const requested = Array.isArray(input?.modelIds) ? input.modelIds : [];
  const modelIds = [...new Set(requested.map(id => String(id || "").trim()).filter(Boolean))].slice(0, 50);
  if (!modelIds.length) throw new QwenModelError("モデルを1つ以上選んでください");
  const known = new Map(preset.models.map(model => [model.id.toLowerCase(), model]));
  for (const id of modelIds) {
    if (!MODEL_ID.test(id)) throw new QwenModelError(`モデルIDが正しくありません: ${id.slice(0, 60)}`);
    const spec = known.get(id.toLowerCase());
    if (!spec && !preset.modelsEditable) throw new QwenModelError(`このプロバイダーにないモデルです: ${id}`);
    if (spec?.imageOnly) throw new QwenModelError(`画像生成専用のモデルは追加できません: ${id}`);
  }
  const entries = buildEntries(preset, { baseUrl, prefix, envKey, modelIds });
  const authKey = protocol === "openai-responses" ? "openai" : protocol;
  // install.ts / provider ownsModel: re-adding a provider replaces the models
  // it installed before (same key at the same endpoint); custom providers
  // replace by id + base URL only (mergeModelsByIdentity).
  const owns = model => custom
    ? model?.baseUrl === baseUrl && entries.some(entry => entry.id === model?.id)
    : model?.envKey === envKey && preset.baseUrls.some(option => option.url === model?.baseUrl);
  return { preset, authKey, envKey, apiKey, entries, owns };
}

function applyInstall(settings, plan) {
  const next = { ...settings };
  const providers = { ...(next.modelProviders && typeof next.modelProviders === "object" ? next.modelProviders : {}) };
  const existing = Array.isArray(providers[plan.authKey]) ? providers[plan.authKey] : [];
  providers[plan.authKey] = [...plan.entries, ...existing.filter(model => !plan.owns(model))];
  next.modelProviders = providers;
  next.env = { ...(next.env && typeof next.env === "object" ? next.env : {}), [plan.envKey]: plan.apiKey };
  return next;
}

let writing = Promise.resolve();

/**
 * Adds a provider to the user-scope qwen settings the way /auth does
 * (modelProviders + env). It does not change security.auth.selectedType or
 * model.name, so the CLI's own default stays what the user picked.
 */
export async function installQwenProvider(input, { env = process.env, home = homedir() } = {}) {
  const plan = planQwenProviderInstall(input);
  const path = userSettingsPath(env, home);
  const job = writing.then(async () => {
    const current = await readSettingsFile(path);
    if (current.exists && current.raw.trim()) {
      try {
        JSON.parse(current.raw);
      } catch {
        throw new QwenModelError("settings.json にコメントがあるため自動で追加できません。ターミナルで qwen の /auth から追加してください", 409, "settings_jsonc");
      }
    }
    const next = applyInstall(current.data, plan);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600).catch(() => {});
    await rename(temp, path);
    return { presetId: plan.preset.id, added: plan.entries.map(entry => ({ id: entry.id, authType: plan.authKey })) };
  });
  writing = job.catch(() => {});
  try {
    return await job;
  } catch (error) {
    if (error instanceof QwenModelError) throw error;
    throw new QwenModelError("Qwen Code の設定に保存できませんでした", 500, "failed");
  }
}

export function publicQwenModelError(error) {
  if (error instanceof QwenModelError) return { status: error.status, error: error.message, code: error.code };
  return { status: 500, error: "Qwen Code のモデル一覧を読めませんでした", code: "failed" };
}
