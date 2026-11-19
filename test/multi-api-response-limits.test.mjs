import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shrink the upstream response cap for this test process so oversized-body
// cases stay small and fast. The production default is asserted separately.
process.env.DEVMOTER_MULTI_API_MAX_RESPONSE_BYTES = "2048";

const {
  MAX_UPSTREAM_RESPONSE_BYTES,
  createMultiApiStore,
  loadMultiApiProviders,
  runMultiApiChat,
  testMultiApiProvider
} = await import("../server/multi-api.mjs");

const LIMIT = 2048;
const PADDING = "x".repeat(4096);

function openAiProvider(apiKey) {
  return {
    id: "demo",
    name: "Demo API",
    presetId: "custom",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey,
    models: ["demo-fast"],
    source: "file"
  };
}

function anthropicProvider(apiKey) {
  return {
    id: "claude",
    name: "Claude",
    presetId: "anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey,
    models: ["claude-test"],
    source: "file"
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("upstream response byte limit defaults to 10 MiB", () => {
  assert.equal(MAX_UPSTREAM_RESPONSE_BYTES, 10 * 1024 * 1024);
});

test("provider test rejects an oversized /models body announced via Content-Length", async () => {
  let pulled = false;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      pulled = true;
      controller.close();
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });

  await assert.rejects(
    testMultiApiProvider({
      name: "Demo",
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey: "connection-secret",
      models: []
    }, async () => new Response(body, {
      headers: { "content-length": String(LIMIT + 1) }
    })),
    error => {
      assert.equal(error.code, "UPSTREAM_RESPONSE_TOO_LARGE");
      assert.match(error.message, new RegExp(`exceeded the ${LIMIT}-byte limit`));
      return true;
    }
  );
  assert.equal(pulled, false);
  assert.equal(cancelled, true);
});

test("chat rejects an oversized /chat/completions body", async () => {
  await assert.rejects(
    runMultiApiChat([openAiProvider("chat-secret")], {
      providerId: "demo",
      model: "demo-fast",
      messages: [{ role: "user", content: "hello" }]
    }, async () => jsonResponse({
      choices: [{ message: { role: "assistant", content: "hi" } }],
      padding: PADDING
    })),
    error => {
      assert.equal(error.code, "UPSTREAM_RESPONSE_TOO_LARGE");
      assert.match(error.message, /byte limit/);
      return true;
    }
  );
});

test("chat aborts a chunked oversized /chat/completions body without reading it to the end", async () => {
  const chunk = new Uint8Array(512).fill(0x78);
  const totalChunks = 20;
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > totalChunks) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    }
  });

  await assert.rejects(
    runMultiApiChat([openAiProvider("chat-secret")], {
      providerId: "demo",
      model: "demo-fast",
      messages: [{ role: "user", content: "hello" }]
    }, async () => new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" }
    })),
    error => {
      assert.equal(error.code, "UPSTREAM_RESPONSE_TOO_LARGE");
      assert.match(error.message, /byte limit/);
      return true;
    }
  );

  assert.equal(cancelled, true, "the upstream body stream must be cancelled once the cap is exceeded");
  assert.ok(pulled < totalChunks, `expected the read to stop early, but ${pulled} chunks were pulled`);
});

test("chat rejects an oversized /messages body", async () => {
  await assert.rejects(
    runMultiApiChat([anthropicProvider("anthropic-secret")], {
      providerId: "claude",
      model: "claude-test",
      messages: [{ role: "user", content: "hello" }]
    }, async () => jsonResponse({
      content: [{ type: "text", text: "hello back" }],
      padding: PADDING
    })),
    error => {
      assert.equal(error.code, "UPSTREAM_RESPONSE_TOO_LARGE");
      assert.match(error.message, /byte limit/);
      return true;
    }
  );
});

test("an oversized upstream error body is bounded too and keeps the HTTP status", async () => {
  await assert.rejects(
    runMultiApiChat([openAiProvider("chat-secret")], {
      providerId: "demo",
      model: "demo-fast",
      messages: [{ role: "user", content: "hello" }]
    }, async () => jsonResponse({ error: { message: "boom" }, padding: PADDING }, 500)),
    error => {
      assert.equal(error.code, "UPSTREAM_RESPONSE_TOO_LARGE");
      assert.equal(error.status, 500);
      return true;
    }
  );
});

test("upstream error echoing a file-stored API key is redacted at the multi-api layer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-api-limits-"));
  const filePath = join(dir, "llm-providers.json");
  try {
    const store = createMultiApiStore({ filePath, env: {} });
    await store.upsert({
      presetId: "custom",
      name: "File Stored",
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey: "file-stored-key-592",
      models: ["demo-fast"]
    });
    const providers = await store.listResolved();
    assert.equal(providers[0].apiKey, "file-stored-key-592");
    assert.equal(providers[0].source, "file");

    await assert.rejects(
      runMultiApiChat(providers, {
        providerId: providers[0].id,
        model: "demo-fast",
        messages: [{ role: "user", content: "hello" }]
      }, async () => jsonResponse({
        error: { message: "Authentication failed: bearer file-stored-key-592 was rejected" }
      }, 401)),
      error => {
        assert.equal(error.status, 401);
        assert.equal(error.message.includes("file-stored-key-592"), false);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provider test error echoing the API key is redacted, and so are returned model names", async () => {
  await assert.rejects(
    testMultiApiProvider({
      name: "Demo",
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey: "file-stored-key-592",
      models: []
    }, async () => jsonResponse({
      error: { message: "key file-stored-key-592 is invalid" }
    }, 403)),
    error => {
      assert.equal(error.status, 403);
      assert.equal(error.message.includes("file-stored-key-592"), false);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );

  const result = await testMultiApiProvider({
    name: "Demo",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey: "file-stored-key-592",
    models: []
  }, async () => jsonResponse({ data: [{ id: "model-file-stored-key-592" }, { id: "plain-model" }] }));
  assert.deepEqual(result.models, ["model-[REDACTED]", "plain-model"]);
});

test("upstream error echoing an env-sourced API key is redacted", async () => {
  const providers = loadMultiApiProviders({
    DEVMOTER_LLM_PROVIDERS_JSON: JSON.stringify([{
      id: "envdemo",
      name: "Env Demo",
      presetId: "custom",
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKeyEnv: "ENV_DEMO_KEY",
      models: ["demo-fast"]
    }]),
    ENV_DEMO_KEY: "env-sourced-key-592"
  });
  assert.equal(providers[0].source, "env");

  await assert.rejects(
    runMultiApiChat(providers, {
      providerId: "envdemo",
      model: "demo-fast",
      messages: [{ role: "user", content: "hello" }]
    }, async () => jsonResponse({
      error: { message: "upstream saw key env-sourced-key-592 and refused" }
    }, 502)),
    error => {
      assert.equal(error.message.includes("env-sourced-key-592"), false);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test("assistant content echoing the API key is redacted before it reaches the client", async () => {
  const result = await runMultiApiChat([openAiProvider("chat-secret-592")], {
    providerId: "demo",
    model: "demo-fast",
    messages: [{ role: "user", content: "hello" }]
  }, async () => jsonResponse({
    choices: [{ message: { role: "assistant", content: "your key chat-secret-592 is showing" } }],
    usage: { total_tokens: 3 }
  }));

  assert.equal(result.message.content, "your key [REDACTED] is showing");
  assert.deepEqual(result.usage, { total_tokens: 3 });
});

test("normal-sized valid responses on all three paths still work under the cap", async () => {
  const tested = await testMultiApiProvider({
    name: "Demo",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey: "connection-secret",
    models: []
  }, async () => jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] }));
  assert.deepEqual(tested, { ok: true, models: ["model-a", "model-b"] });

  const chat = await runMultiApiChat([openAiProvider("chat-secret")], {
    providerId: "demo",
    model: "demo-fast",
    messages: [{ role: "user", content: "hello" }]
  }, async () => jsonResponse({
    choices: [{ message: { role: "assistant", content: "hi" } }],
    usage: { total_tokens: 2 }
  }));
  assert.equal(chat.message.content, "hi");
  assert.deepEqual(chat.usage, { total_tokens: 2 });

  const anthropic = await runMultiApiChat([anthropicProvider("anthropic-secret")], {
    providerId: "claude",
    model: "claude-test",
    messages: [{ role: "user", content: "hello" }]
  }, async () => jsonResponse({
    content: [{ type: "text", text: "hello back" }],
    usage: { input_tokens: 2, output_tokens: 2 }
  }));
  assert.equal(anthropic.message.content, "hello back");
  assert.deepEqual(anthropic.usage, { input_tokens: 2, output_tokens: 2 });
});

test("chat returns only recognized numeric usage counters for each protocol", async () => {
  const cases = [
    {
      provider: openAiProvider("chat-secret"),
      model: "demo-fast",
      response: { choices: [{ message: { content: "Hello" } }] },
      usage: { prompt_tokens: 0, completion_tokens: "chat-secret", total_tokens: 4, input_tokens: 99 },
      expected: { prompt_tokens: 0, total_tokens: 4 }
    },
    {
      provider: anthropicProvider("chat-secret"),
      model: "claude-test",
      response: { content: [{ type: "text", text: "Hello" }] },
      usage: { input_tokens: 3, output_tokens: { note: "chat-secret" }, cache_read_input_tokens: 2, cache_creation_input_tokens: -1, total_tokens: 99 },
      expected: { input_tokens: 3, cache_read_input_tokens: 2 }
    }
  ];
  for (const { provider, model, response, usage, expected } of cases) {
    const result = await runMultiApiChat([provider], {
      providerId: provider.id,
      model,
      messages: [{ role: "user", content: "hello" }]
    }, async () => jsonResponse({ ...response, usage: { ...usage, metadata: "chat-secret" } }));
    assert.deepEqual(result.usage, expected, provider.protocol);
  }
});

test("provider test accepts UTF-8 JSON with a leading BOM", async () => {
  const result = await testMultiApiProvider({
    name: "Demo",
    protocol: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey: "connection-secret"
  }, async () => new Response('\uFEFF{"data":[{"id":"model-a"}]}'));

  assert.deepEqual(result, { ok: true, models: ["model-a"] });
});

test("#349: aborting the chat request cancels the provider call", async () => {
  const controller = new AbortController();
  let upstreamSignal;
  const pending = runMultiApiChat([openAiProvider("chat-secret")], {
    providerId: "demo",
    model: "demo-fast",
    messages: [{ role: "user", content: "hello" }]
  }, (_url, init) => new Promise((_resolve, reject) => {
    upstreamSignal = init.signal;
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending);
  assert.equal(upstreamSignal.aborted, true);

  const server = await import("node:fs/promises").then(fs => fs.readFile(new URL("../server.mjs", import.meta.url), "utf8"));
  const handler = server.slice(server.indexOf("async function multiApiChat("), server.indexOf("async function devWorkflowAction("));
  assert.match(handler, /res\.on\("close", abortUpstream\)/);
  assert.match(handler, /runMultiApiChat\([^)]*signal: upstreamAbort\.signal/);
});
