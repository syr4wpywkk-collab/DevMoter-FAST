const MAX_MESSAGES = 120;
const MAX_CONTENT_CHARS = 500_000;

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("Provider baseUrl must use HTTPS (HTTP is allowed only for localhost)");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))].slice(0, 200);
}

export function loadMultiApiProviders(env = process.env) {
  const raw = String(env.DEVMOTER_LLM_PROVIDERS_JSON || "").trim();
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DEVMOTER_LLM_PROVIDERS_JSON must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("DEVMOTER_LLM_PROVIDERS_JSON must be a JSON array");
  }

  const seen = new Set();
  return parsed.map((item, index) => {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || id).trim();
    const apiKeyEnv = String(item?.apiKeyEnv || "").trim();
    const models = normalizeModels(item?.models);

    if (!id || !/^[a-zA-Z0-9._-]{1,64}$/.test(id)) {
      throw new Error(`Provider #${index + 1} has an invalid id`);
    }
    if (seen.has(id)) throw new Error(`Duplicate provider id: ${id}`);
    seen.add(id);
    if (!apiKeyEnv || !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
      throw new Error(`Provider ${id} has an invalid apiKeyEnv`);
    }
    if (!models.length) throw new Error(`Provider ${id} must configure at least one model`);

    return {
      id,
      name: name || id,
      kind: "openai-compatible",
      baseUrl: normalizeBaseUrl(item?.baseUrl),
      apiKeyEnv,
      apiKey: String(env[apiKeyEnv] || ""),
      models
    };
  });
}

export function publicMultiApiProviders(providers) {
  return providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    ready: Boolean(provider.apiKey),
    models: provider.models
  }));
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    throw new Error("messages must be a non-empty array");
  }

  let total = 0;
  return input.map((message, index) => {
    const role = String(message?.role || "");
    const content = String(message?.content || "");
    if (!["system", "user", "assistant"].includes(role)) {
      throw new Error(`messages[${index}].role is invalid`);
    }
    if (!content.trim()) throw new Error(`messages[${index}].content is empty`);
    total += content.length;
    if (total > MAX_CONTENT_CHARS) throw new Error("message content is too large");
    return { role, content };
  });
}

function providerErrorMessage(payload, status) {
  const candidate =
    payload?.error?.message ??
    payload?.message ??
    payload?.error ??
    `Upstream API returned HTTP ${status}`;
  return String(candidate).slice(0, 600);
}

export async function runMultiApiChat(providers, payload, fetchImpl = fetch) {
  const providerId = String(payload?.providerId || "").trim();
  const model = String(payload?.model || "").trim();
  const provider = providers.find(item => item.id === providerId);

  if (!provider) throw new Error("Unknown API provider");
  if (!provider.apiKey) throw new Error(`API key is not configured for ${provider.name}`);
  if (!provider.models.includes(model)) throw new Error("Model is not allowed for this provider");

  const messages = normalizeMessages(payload?.messages);
  const endpoint = `${provider.baseUrl}/chat/completions`;

  const upstream = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "authorization": `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    }),
    signal: AbortSignal.timeout(120_000)
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const error = new Error(providerErrorMessage(data, upstream.status));
    error.status = upstream.status;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Provider returned an unsupported response shape");
  }

  return {
    providerId,
    model,
    message: { role: "assistant", content },
    usage: data?.usage ?? null
  };
}
