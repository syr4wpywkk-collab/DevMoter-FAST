import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMultiApiStore,
  loadMultiApiProviders,
  publicMultiApiProviders,
  runMultiApiChat,
  testMultiApiProvider
} from "../server/multi-api.mjs";

const config = JSON.stringify([
  {
    id: "demo",
    name: "Demo API",
    presetId: "custom",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1/",
    apiKeyEnv: "DEMO_KEY",
    models: ["demo-fast", "demo-pro"]
  }
]);

test("multi-api environment config keeps secrets server-side", () => {
  const providers = loadMultiApiProviders({
    DEVMOTER_LLM_PROVIDERS_JSON: config,
    DEMO_KEY: "super-secret"
  });

  assert.equal(providers[0].baseUrl, "https://example.test/v1");
  assert.equal(providers[0].apiKey, "super-secret");

  const publicProviders = publicMultiApiProviders(providers);
  assert.deepEqual(publicProviders, [{
    id: "demo",
    name: "Demo API",
    presetId: "custom",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1",
    ready: true,
    models: ["demo-fast", "demo-pro"],
    source: "env",
    editable: false
  }]);
  assert.equal(JSON.stringify(publicProviders).includes("super-secret"), false);
});

test("multi-api provider config rejects insecure remote HTTP", () => {
  const insecure = JSON.stringify([{
    id: "bad",
    name: "Bad",
    baseUrl: "http://example.com/v1",
    apiKeyEnv: "BAD_KEY",
    models: ["model"]
  }]);

  assert.throws(
    () => loadMultiApiProviders({
      DEVMOTER_LLM_PROVIDERS_JSON: insecure,
      BAD_KEY: "secret"
    }),
    /HTTPS/
  );
});

test("file-backed provider store uses private permissions and never exposes keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-api-"));
  const filePath = join(dir, "llm-providers.json");

  try {
    const store = createMultiApiStore({ filePath, env: {} });
    const saved = await store.upsert({
      presetId: "gemini",
      name: "Gemini",
      protocol: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "file-secret",
      models: ["gemini-test"]
    });

    assert.equal(saved.ready, true);
    assert.equal(JSON.stringify(saved).includes("file-secret"), false);

    const mode = (await stat(filePath)).mode & 0o777;
    assert.equal(mode, 0o600);

    const disk = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(disk.providers[0].apiKey, "file-secret");

    const resolved = await store.listResolved();
    assert.equal(resolved[0].apiKey, "file-secret");

    const updated = await store.upsert({
      id: saved.id,
      presetId: "gemini",
      name: "Gemini renamed",
      protocol: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "",
      models: ["gemini-test", "gemini-test-2"]
    });

    assert.equal(updated.name, "Gemini renamed");
    const after = await store.listResolved();
    assert.equal(after[0].apiKey, "file-secret");

    await store.remove(saved.id);
    assert.deepEqual(await store.listResolved(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provider connection test fetches model ids without returning the API key", async () => {
  let request = null;
  const result = await testMultiApiProvider({
    name: "Demo",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey: "connection-secret",
    models: []
  }, async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      data: [{ id: "model-a" }, { id: "model-b" }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  assert.equal(request.url, "https://example.test/v1/models");
  assert.equal(request.init.headers.authorization, "Bearer connection-secret");
  assert.deepEqual(result, { ok: true, models: ["model-a", "model-b"] });
  assert.equal(JSON.stringify(result).includes("connection-secret"), false);
});

test("multi-api chat calls OpenAI-compatible endpoint", async () => {
  const providers = loadMultiApiProviders({
    DEVMOTER_LLM_PROVIDERS_JSON: config,
    DEMO_KEY: "super-secret"
  });

  let request = null;
  const result = await runMultiApiChat(
    providers,
    {
      providerId: "demo",
      model: "demo-fast",
      messages: [{ role: "user", content: "hello" }]
    },
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hi" } }],
        usage: { total_tokens: 2 }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  );

  assert.equal(request.url, "https://example.test/v1/chat/completions");
  assert.equal(request.init.headers.authorization, "Bearer super-secret");
  assert.equal(JSON.parse(request.init.body).model, "demo-fast");
  assert.equal(result.message.content, "hi");
});

test("multi-api chat supports Anthropic Messages API directly", async () => {
  const providers = [{
    id: "claude",
    name: "Claude",
    presetId: "anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "anthropic-secret",
    models: ["claude-test"],
    source: "file"
  }];

  let request = null;
  const result = await runMultiApiChat(
    providers,
    {
      providerId: "claude",
      model: "claude-test",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "hello" }
      ]
    },
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "hello back" }],
        usage: { input_tokens: 2, output_tokens: 2 }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  );

  const body = JSON.parse(request.init.body);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.init.headers["x-api-key"], "anthropic-secret");
  assert.equal(request.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(body.system, "Be concise.");
  assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);
  assert.equal(result.message.content, "hello back");
});

test("multi-api chat rejects models outside the configured allowlist", async () => {
  const providers = loadMultiApiProviders({
    DEVMOTER_LLM_PROVIDERS_JSON: config,
    DEMO_KEY: "super-secret"
  });

  await assert.rejects(
    runMultiApiChat(providers, {
      providerId: "demo",
      model: "not-allowed",
      messages: [{ role: "user", content: "hello" }]
    }, async () => {
      throw new Error("fetch should not be called");
    }),
    /not allowed/
  );
});
