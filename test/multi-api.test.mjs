import test from "node:test";
import assert from "node:assert/strict";

import {
  loadMultiApiProviders,
  publicMultiApiProviders,
  runMultiApiChat
} from "../server/multi-api.mjs";

const config = JSON.stringify([
  {
    id: "demo",
    name: "Demo API",
    baseUrl: "https://example.test/v1/",
    apiKeyEnv: "DEMO_KEY",
    models: ["demo-fast", "demo-pro"]
  }
]);

test("multi-api provider config keeps secrets server-side", () => {
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
    kind: "openai-compatible",
    ready: true,
    models: ["demo-fast", "demo-pro"]
  }]);
  assert.equal(JSON.stringify(publicProviders).includes("super-secret"), false);
});

test("multi-api provider config rejects insecure remote HTTP", () => {
  const insecure = JSON.stringify([{
    id: "bad",
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

test("multi-api chat calls the configured endpoint without exposing provider choice", async () => {
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
