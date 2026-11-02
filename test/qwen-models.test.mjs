import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  customEnvKey,
  installQwenProvider,
  listQwenModels,
  parseJsonc,
  planQwenProviderInstall,
  publicQwenModelList,
  publicQwenPresets,
  resolveQwenModelSelection
} from "../server/qwen-models.mjs";
import { QWEN_CODE_PROVIDERS } from "../server/qwen-code-providers.mjs";

async function homeWith(settings, extra = {}) {
  const home = await mkdtemp(join(tmpdir(), "qwen-home-"));
  await mkdir(join(home, ".qwen"), { recursive: true });
  if (settings !== undefined) await writeFile(join(home, ".qwen", "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings, null, 2));
  for (const [path, text] of Object.entries(extra)) {
    await mkdir(join(home, path, ".."), { recursive: true });
    await writeFile(join(home, path), text);
  }
  return home;
}

const env = {}; // no QWEN_HOME

test("the presets are exactly the /auth providers of qwen-code 0.26.6", () => {
  assert.deepEqual(QWEN_CODE_PROVIDERS.map(item => item.id), [
    "qwencloud-token-plan", "qwencloud-standard", "coding-plan", "token-plan", "alibabaStandard",
    "deepseek", "grok", "minimax", "zai", "moonshot", "idealab", "modelscope", "openrouter", "requesty", "custom-openai-compatible"
  ]);
  const presets = publicQwenPresets();
  const coding = presets.find(item => item.id === "coding-plan");
  assert.deepEqual(coding.baseUrls.map(item => item.id), ["aliyun", "alibabacloud"]);
  assert.ok(!JSON.stringify(presets).includes("https://"), "base URLs stay on the server");
  assert.equal(presets.find(item => item.id === "minimax").models.find(model => model.id === "image-01").disabled, true);
  assert.deepEqual(presets.find(item => item.id === "custom-openai-compatible").protocols, ["openai", "anthropic", "gemini"]);
  // custom-provider.ts generateCustomEnvKey
  assert.match(customEnvKey("openai", "http://localhost:11434/v1/"), /^QWEN_CUSTOM_API_KEY_OPENAI_HTTP_LOCALHOST_11434_V1_[0-9A-F]{12}$/);
  assert.equal(customEnvKey("openai", "http://localhost:11434/v1/"), customEnvKey("openai", "http://localhost:11434/v1"));
});

test("listing reads qwen's own modelProviders, groups by provider and never returns keys", async () => {
  const home = await homeWith(`{
    // comments are allowed in qwen settings
    "modelProviders": {
      "openai": [
        { "id": "qwen3-coder-plus", "name": "[ModelStudio Coding Plan] qwen3-coder-plus", "baseUrl": "https://coding.dashscope.aliyuncs.com/v1", "envKey": "BAILIAN_CODING_PLAN_API_KEY" },
        { "id": "z-ai/glm-4.5-air:free", "name": "[OpenRouter] z-ai/glm-4.5-air:free", "baseUrl": "https://openrouter.ai/api/v1", "envKey": "OPENROUTER_API_KEY" },
        { "id": "qwen3-coder-plus", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "envKey": "DASHSCOPE_API_KEY" },
        { "id": "image-01", "baseUrl": "https://api.minimax.io/v1", "envKey": "MINIMAX_API_KEY", "imageOnly": true },
        { "id": "llama3", "baseUrl": "http://localhost:11434/v1", "envKey": "NOT_SET_KEY" },
        { "id": "gpt-5", "wireApi": "responses", "baseUrl": "https://api.openai.com/v1" }
      ],
      "anthropic": [{ "id": "claude-sonnet-4", "envKey": "ANTHROPIC_API_KEY" }],
      "bogus": [{ "id": "x" }]
    },
    "env": { "BAILIAN_CODING_PLAN_API_KEY": "sk-sp-coding-secret", "OPENROUTER_API_KEY": "sk-or-secret-1", "DASHSCOPE_API_KEY": "sk-ds", "MINIMAX_API_KEY": "mm-key-1234" },
    "model": { "name": "qwen3-coder-plus" },
  }`, { ".env": "OPENAI_API_KEY=sk-from-dotenv\n" });
  const listing = await listQwenModels({ home, env, childEnv: { ANTHROPIC_API_KEY: "sk-ant" } });
  const pub = publicQwenModelList(listing);
  assert.equal(pub.scope, "user");
  assert.equal(pub.defaultModel, "qwen3-coder-plus");
  assert.ok(!JSON.stringify(pub).match(/sk-sp-coding|sk-or-secret|sk-ds|sk-ant|sk-from|mm-key/), "no key values leave the server");
  assert.deepEqual(pub.groups.map(group => group.label), ["ModelStudio Coding Plan", "OpenRouter", "ModelStudio Standard", "MiniMax", "localhost:11434", "api.openai.com", "カスタム"]);
  const by = (id, authType = "openai") => pub.models.filter(model => model.id === id && model.authType === authType);
  assert.equal(by("qwen3-coder-plus")[0].disabled, undefined);
  assert.equal(by("qwen3-coder-plus")[1].reason, "同じIDのモデルが先に登録されています");
  assert.equal(by("image-01")[0].reason, "画像生成専用のモデルです");
  assert.equal(by("llama3")[0].reason, "APIキーが未設定です");
  assert.equal(by("gpt-5", "openai-responses")[0].disabled, undefined, "wireApi responses + key from ~/.env");
  assert.equal(by("claude-sonnet-4", "anthropic")[0].disabled, undefined, "key from the qwen child env");
  assert.equal(pub.models.find(model => model.id === "x").reason, "Qwen Code が対応していないプロトコルです");

  const picked = resolveQwenModelSelection({ authType: "openai", id: "z-ai/glm-4.5-air:free" }, listing);
  assert.deepEqual(picked.args, ["--auth-type", "openai", "--model", "z-ai/glm-4.5-air:free"]);
  assert.equal(picked.secret, "sk-or-secret-1", "server-side only, for redaction");
  assert.equal(resolveQwenModelSelection(null, listing), null, "null = Qwen Code default");
  assert.throws(() => resolveQwenModelSelection({ authType: "openai", id: "unknown-model" }, listing), error => error.code === "unknown_model");
  assert.throws(() => resolveQwenModelSelection({ authType: "openai", id: "llama3" }, listing), /APIキーが未設定/);
  assert.throws(() => resolveQwenModelSelection({ authType: "openai", id: "image-01" }, listing), /画像生成専用/);
  assert.throws(() => resolveQwenModelSelection({ authType: "openai; rm", id: "x" }, listing), /不正/);
  assert.throws(() => resolveQwenModelSelection({ authType: "openai", id: "--yolo" }, listing), /不正/);
  assert.throws(() => resolveQwenModelSelection({ authType: "openai", id: "m", baseUrl: "https://evil" , apiKey: "k" }, listing), error => error.code === "unknown_model", "raw base URL / key from the client are ignored");
});

test("a project's .qwen/settings.json replaces the user list (MergeStrategy.REPLACE)", async () => {
  const home = await homeWith({ modelProviders: { openai: [{ id: "user-model", envKey: "OPENAI_API_KEY" }] }, env: { OPENAI_API_KEY: "sk-1" } });
  const project = await mkdtemp(join(tmpdir(), "qwen-proj-"));
  await mkdir(join(project, ".qwen"));
  await writeFile(join(project, ".qwen", "settings.json"), JSON.stringify({ modelProviders: { openai: [{ id: "project-model" }] } }));
  const listing = await listQwenModels({ home, env, cwd: project });
  assert.equal(listing.scope, "workspace");
  assert.deepEqual(listing.models.map(model => model.id), ["project-model"]);
  const empty = await listQwenModels({ home: await homeWith(undefined), env });
  assert.deepEqual([empty.scope, empty.models.length, empty.groups.length], ["none", 0, 0]);
  await assert.rejects(listQwenModels({ home: await homeWith("{ not json"), env }), error => error.code === "settings_invalid");
});

test("adding a provider writes what /auth writes, keeps other settings and does not switch the CLI default", async () => {
  const home = await homeWith({ theme: "dark", security: { auth: { selectedType: "qwen-oauth" } }, model: { name: "coder-model" },
    modelProviders: { openai: [
      { id: "old", name: "[OpenRouter] old", baseUrl: "https://openrouter.ai/api/v1", envKey: "OPENROUTER_API_KEY" },
      { id: "mine", baseUrl: "https://example.com/v1", envKey: "MY_KEY" }
    ] } });
  const result = await installQwenProvider({ presetId: "openrouter", apiKey: "sk-or-new-key", modelIds: ["z-ai/glm-4.5-air:free", "anthropic/claude-x"] }, { home, env });
  assert.deepEqual(result.added, [{ id: "z-ai/glm-4.5-air:free", authType: "openai" }, { id: "anthropic/claude-x", authType: "openai" }]);
  assert.ok(!JSON.stringify(result).includes("sk-or-new-key"));
  const file = join(home, ".qwen", "settings.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.theme, "dark");
  assert.deepEqual(saved.security, { auth: { selectedType: "qwen-oauth" } });
  assert.deepEqual(saved.model, { name: "coder-model" });
  assert.equal(saved.env.OPENROUTER_API_KEY, "sk-or-new-key");
  assert.deepEqual(saved.modelProviders.openai.map(model => model.id), ["z-ai/glm-4.5-air:free", "anthropic/claude-x", "mine"], "re-adding replaces the provider's own models only");
  assert.deepEqual(saved.modelProviders.openai[0], {
    id: "z-ai/glm-4.5-air:free", name: "[OpenRouter] z-ai/glm-4.5-air:free", baseUrl: "https://openrouter.ai/api/v1", envKey: "OPENROUTER_API_KEY",
    generationConfig: { contextWindowSize: 128000, customHeaders: { "HTTP-Referer": "https://github.com/QwenLM/qwen-code.git", "X-OpenRouter-Title": "Qwen Code" } }
  });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const listing = await listQwenModels({ home, env });
  assert.equal(resolveQwenModelSelection({ authType: "openai", id: "anthropic/claude-x" }, listing).args[3], "anthropic/claude-x");
});

test("adding a provider validates like /auth and never writes a client base URL for presets", async () => {
  assert.throws(() => planQwenProviderInstall({ presetId: "my-own", apiKey: "k", modelIds: ["m"] }), /対応していない/);
  assert.throws(() => planQwenProviderInstall({ presetId: "coding-plan", baseUrlId: "aliyun", apiKey: "sk-123", modelIds: ["qwen3-coder-plus"] }), /sk-sp-/);
  assert.throws(() => planQwenProviderInstall({ presetId: "alibabaStandard", baseUrlId: "cn-beijing", apiKey: "sk-sp-1", modelIds: ["qwen3.7-plus"] }), /Token Plan/);
  assert.throws(() => planQwenProviderInstall({ presetId: "coding-plan", apiKey: "sk-sp-1", modelIds: ["qwen3-coder-plus"] }), /リージョン/);
  assert.throws(() => planQwenProviderInstall({ presetId: "openrouter", apiKey: "", modelIds: ["m"] }), /APIキー/);
  assert.throws(() => planQwenProviderInstall({ presetId: "openrouter", apiKey: "k", modelIds: [] }), /モデル/);
  assert.throws(() => planQwenProviderInstall({ presetId: "openrouter", apiKey: "k", modelIds: ["--yolo"] }), /モデルID/);
  assert.throws(() => planQwenProviderInstall({ presetId: "minimax", baseUrlId: "default", apiKey: "k", modelIds: ["image-01"] }), /リージョン|画像/);
  const plan = planQwenProviderInstall({ presetId: "coding-plan", baseUrlId: "alibabacloud", baseUrl: "https://evil.example/v1", apiKey: "sk-sp-1", modelIds: ["qwen3-coder-plus"] });
  assert.equal(plan.entries[0].baseUrl, "https://coding-intl.dashscope.aliyuncs.com/v1", "presets ignore a client base URL");
  assert.equal(plan.entries[0].name, "[ModelStudio Coding Plan for Global/Intl] qwen3-coder-plus");
  assert.equal(plan.envKey, "BAILIAN_CODING_PLAN_API_KEY");
  assert.throws(() => planQwenProviderInstall({ presetId: "custom-openai-compatible", protocol: "openai", baseUrl: "http://10.0.0.5/v1", apiKey: "k", modelIds: ["m"] }), /https/);
  assert.throws(() => planQwenProviderInstall({ presetId: "custom-openai-compatible", protocol: "openai", baseUrl: "https://u:p@x.example/v1", apiKey: "k", modelIds: ["m"] }), /ユーザー名/);
  assert.throws(() => planQwenProviderInstall({ presetId: "custom-openai-compatible", protocol: "vertex-ai", baseUrl: "https://x.example/v1", apiKey: "k", modelIds: ["m"] }), /プロトコル/);
  const custom = planQwenProviderInstall({ presetId: "custom-openai-compatible", protocol: "anthropic", baseUrl: "https://proxy.example/v1/", apiKey: "k", modelIds: ["claude-x"] });
  assert.equal(custom.authKey, "anthropic");
  assert.match(custom.envKey, /^QWEN_CUSTOM_API_KEY_ANTHROPIC_/);
  assert.deepEqual(custom.entries, [{ id: "claude-x", name: "claude-x", baseUrl: "https://proxy.example/v1", envKey: custom.envKey }]);
});

test("settings with comments are not rewritten (they would be lost)", async () => {
  const text = '{\n  // mine\n  "theme": "dark"\n}\n';
  const home = await homeWith(text);
  await assert.rejects(installQwenProvider({ presetId: "openrouter", apiKey: "k", modelIds: ["m"] }, { home, env }), error => error.code === "settings_jsonc");
  assert.equal(await readFile(join(home, ".qwen", "settings.json"), "utf8"), text);
  assert.deepEqual(parseJsonc('{"a": "// not a comment", /* x */ "b": [1,],}'), { a: "// not a comment", b: [1] });
});

test("QWEN_HOME moves the user settings like the CLI does", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qwen-qh-"));
  await installQwenProvider({ presetId: "deepseek", apiKey: "sk-d", modelIds: ["deepseek-v4-pro"] }, { home: "/nonexistent", env: { QWEN_HOME: dir } });
  const saved = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
  assert.equal(saved.env.DEEPSEEK_API_KEY, "sk-d");
  const listing = await listQwenModels({ home: "/nonexistent", env: { QWEN_HOME: dir } });
  assert.equal(listing.models.length, 1);
});
