import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMultiApiStore,
  loadMultiApiProviders,
  publicMultiApiProviders,
  runMultiApiChat,
  testMultiApiProvider
} from "../server/multi-api.mjs";
import { createMultiApiAttachmentStore } from "../server/multi-api-attachments.mjs";

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
    reasoningModes: ["auto"],
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


test("binary image attachment store keeps image bytes on disk with private permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-images-"));

  try {
    const store = createMultiApiAttachmentStore({ directory: dir });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);
    const saved = await store.save({
      name: "../camera/photo.jpg",
      mime: "image/jpeg",
      buffer: bytes
    });

    assert.match(saved.id, /^[0-9a-f-]{36}$/i);
    assert.equal(saved.name.includes("/"), false);

    const entries = await readdir(dir);
    const imageName = entries.find(name => name.endsWith(".jpg"));
    assert.ok(imageName);

    const mode = (await stat(join(dir, imageName))).mode & 0o777;
    assert.equal(mode, 0o600);

    const loaded = await store.read(saved.id);
    assert.deepEqual(loaded.buffer, bytes);
    assert.equal(loaded.mime, "image/jpeg");

    await store.remove(saved.id);
    assert.deepEqual(await readdir(dir), []);
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
      reasoning: "high",
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
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "high" });
  assert.equal(result.reasoning, "high");
  assert.equal(result.message.content, "hello back");
});


test("OpenAI-compatible vision resolves local attachment ids only at outbound request time", async () => {
  const providers = [{
    id: "openai-ui",
    name: "OpenAI",
    presetId: "openai",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "openai-secret",
    models: ["vision-model"],
    source: "file"
  }];

  const payload = {
    providerId: "openai-ui",
    model: "vision-model",
    reasoning: "high",
    messages: [{
      role: "user",
      content: "what is in this image?",
      attachments: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "photo.png",
        mime: "image/png"
      }]
    }]
  };

  assert.equal(JSON.stringify(payload).includes("base64"), false);

  let request = null;
  const result = await runMultiApiChat(
    providers,
    payload,
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "a test image" } }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    {
      attachmentStore: {
        async read(id) {
          assert.equal(id, "11111111-1111-4111-8111-111111111111");
          return {
            id,
            name: "photo.png",
            mime: "image/png",
            size: 4,
            buffer: Buffer.from([1, 2, 3, 4])
          };
        }
      }
    }
  );

  const body = JSON.parse(request.init.body);
  assert.equal(body.reasoning_effort, "high");
  assert.equal(body.messages[0].content[0].type, "text");
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(result.message.content, "a test image");
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
