import test from "node:test";
import assert from "node:assert/strict";
import {
  DeepSeekError,
  cacheModels,
  clearApiKey,
  createChatCompletion,
  fetchBalance,
  fetchModels,
  formatMoney,
  formatTokens,
  maskApiKey,
  parseBalance,
  parseChatCompletion,
  parseModels,
  readApiKey,
  readCachedModels,
  readLedger,
  readSelectedModel,
  recordUsage,
  resetLedger,
  saveApiKey,
  saveSelectedModel,
  validateApiKey,
  API_BASE,
} from "../src/deepseek.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

test("API key storage round-trips and validates input", () => {
  const storage = memoryStorage();
  assert.deepEqual(validateApiKey(""), { ok: false, error: "API キーを入力してください。" });
  assert.equal(validateApiKey("sk- abc").ok, false);
  assert.deepEqual(saveApiKey(" sk-test-1234 ", storage), { ok: true, value: "sk-test-1234" });
  assert.equal(readApiKey(storage), "sk-test-1234");
  assert.equal(maskApiKey(readApiKey(storage)), "末尾 1234");
  assert.equal(clearApiKey(storage), true);
  assert.equal(readApiKey(storage), "");
});

test("parseModels maps documented fields and drops entries without an id", () => {
  const models = parseModels({
    object: "list",
    data: [
      {
        id: "deepseek-v4-pro",
        object: "model",
        owned_by: "deepseek",
        name: "DeepSeek V4 Pro",
        context_window: 1048576,
        max_output_tokens: 393216,
      },
      { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
      { object: "model" },
      { id: "  " },
    ],
  });
  assert.equal(models.length, 2);
  assert.equal(models[0].name, "DeepSeek V4 Pro");
  assert.equal(models[0].contextWindow, 1048576);
  assert.equal(models[1].name, "deepseek-v4-flash");
  assert.equal(models[1].contextWindow, null);
  assert.deepEqual(parseModels(null), []);
  assert.deepEqual(parseModels({}), []);
});

test("fetchModels calls GET /models with the bearer key", async () => {
  const { calls, fetchImpl } = recordingFetch(async () =>
    jsonResponse(200, { object: "list", data: [{ id: "deepseek-v4-flash" }] })
  );
  const models = await fetchModels("sk-key", { fetchImpl });
  assert.equal(models.length, 1);
  assert.equal(calls[0].url, `${API_BASE}/models`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-key");
  assert.equal(calls[0].init.credentials, "omit");
});

test("parseBalance converts documented string amounts to numbers", () => {
  const balance = parseBalance({
    is_available: true,
    balance_infos: [
      { currency: "USD", total_balance: "12.30", granted_balance: "2.00", topped_up_balance: "10.30" },
      { currency: "CNY", total_balance: "0", granted_balance: "0", topped_up_balance: "0" },
    ],
  });
  assert.equal(balance.isAvailable, true);
  assert.equal(balance.balances.length, 2);
  assert.deepEqual(balance.balances[0], {
    currency: "USD",
    total: 12.3,
    granted: 2,
    toppedUp: 10.3,
  });
  assert.deepEqual(parseBalance(null), { isAvailable: false, balances: [] });
});

test("fetchBalance maps 401 to an actionable auth error", async () => {
  const { fetchImpl } = recordingFetch(async () =>
    jsonResponse(401, { error: { message: "Authentication Fails" } })
  );
  await assert.rejects(fetchBalance("sk-bad", { fetchImpl }), (error) => {
    assert.ok(error instanceof DeepSeekError);
    assert.equal(error.kind, "auth");
    assert.equal(error.status, 401);
    return true;
  });
});

test("requests without a key fail before any network call", async () => {
  const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(200, {}));
  await assert.rejects(fetchModels("", { fetchImpl }), (error) => error.kind === "no-key");
  assert.equal(calls.length, 0);
});

test("network failures map to a network error kind", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(fetchBalance("sk-key", { fetchImpl }), (error) => error.kind === "network");
});

test("parseChatCompletion extracts content and usage", () => {
  const result = parseChatCompletion({
    id: "chatcmpl-1",
    model: "deepseek-v4-flash",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "答えです。", reasoning_content: "考え中…" },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 6,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  });
  assert.equal(result.content, "答えです。");
  assert.equal(result.reasoningContent, "考え中…");
  assert.deepEqual(result.usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cacheHitTokens: 4,
    cacheMissTokens: 6,
    reasoningTokens: 3,
  });
});

test("createChatCompletion posts a single user message without streaming", async () => {
  const { calls, fetchImpl } = recordingFetch(async () =>
    jsonResponse(200, {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  );
  const result = await createChatCompletion(
    "sk-key",
    { model: "deepseek-v4-flash", prompt: "  こんにちは  " },
    { fetchImpl }
  );
  assert.equal(result.content, "ok");
  assert.equal(calls[0].url, `${API_BASE}/chat/completions`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, [{ role: "user", content: "こんにちは" }]);
});

test("createChatCompletion rejects empty prompts and missing models locally", async () => {
  const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(200, {}));
  await assert.rejects(
    createChatCompletion("sk-key", { model: "m", prompt: " " }, { fetchImpl }),
    (error) => error.kind === "empty-prompt"
  );
  await assert.rejects(
    createChatCompletion("sk-key", { model: "", prompt: "hi" }, { fetchImpl }),
    (error) => error.kind === "no-model"
  );
  assert.equal(calls.length, 0);
});

test("402 and 429 map to balance and rate error kinds", async () => {
  const { fetchImpl: fetch402 } = recordingFetch(async () => jsonResponse(402, {}));
  await assert.rejects(fetchBalance("sk-key", { fetchImpl: fetch402 }), (e) => e.kind === "balance");
  const { fetchImpl: fetch429 } = recordingFetch(async () => jsonResponse(429, {}));
  await assert.rejects(fetchModels("sk-key", { fetchImpl: fetch429 }), (e) => e.kind === "rate");
});

test("model cache and selection persist", () => {
  const storage = memoryStorage();
  assert.equal(readCachedModels(storage), null);
  cacheModels([{ id: "m1", name: "m1" }], storage, 1700000000000);
  const cached = readCachedModels(storage);
  assert.equal(cached.fetchedAt, 1700000000000);
  assert.equal(cached.models[0].id, "m1");
  assert.equal(saveSelectedModel("m1", storage), "m1");
  assert.equal(readSelectedModel(storage), "m1");
  saveSelectedModel("", storage);
  assert.equal(readSelectedModel(storage), "");
});

test("usage ledger accumulates per-device totals and resets", () => {
  const storage = memoryStorage();
  assert.deepEqual(readLedger(storage), {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
  recordUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }, storage);
  const ledger = recordUsage({ promptTokens: 3, completionTokens: 2, totalTokens: 5 }, storage);
  assert.deepEqual(ledger, { requests: 2, promptTokens: 13, completionTokens: 7, totalTokens: 20 });
  assert.deepEqual(readLedger(storage), ledger);
  resetLedger(storage);
  assert.equal(readLedger(storage).requests, 0);
});

test("formatting helpers use Japanese grouping and currency", () => {
  assert.equal(formatTokens(1234567), "1,234,567");
  assert.equal(formatTokens(undefined), "0");
  assert.match(formatMoney(12.3, "USD"), /12\.30/);
});
