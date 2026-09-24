import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_MESSAGES = 120;
const MAX_CONTENT_CHARS = 500_000;
const MAX_PROVIDERS = 40;
const MAX_MODELS = 300;
const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const REASONING_MODES = new Set(["auto", "none", "low", "medium", "high"]);

export const MULTI_API_PRESETS = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    protocol: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1"
  },
  {
    id: "groq",
    name: "Groq",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1"
  },
  {
    id: "together",
    name: "Together AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1"
  },
  {
    id: "mistral",
    name: "Mistral AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1"
  },
  {
    id: "xai",
    name: "xAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com"
  },
  {
    id: "cerebras",
    name: "Cerebras",
    protocol: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1"
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1"
  },
  {
    id: "perplexity",
    name: "Perplexity",
    protocol: "openai-compatible",
    baseUrl: "https://api.perplexity.ai"
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepinfra.com/v1/openai"
  },
  {
    id: "sambanova",
    name: "SambaNova",
    protocol: "openai-compatible",
    baseUrl: "https://api.sambanova.ai/v1"
  },
  {
    id: "nvidia",
    name: "NVIDIA Build / NIM",
    protocol: "openai-compatible",
    baseUrl: "https://integrate.api.nvidia.com/v1"
  },
  {
    id: "cohere",
    name: "Cohere",
    protocol: "openai-compatible",
    baseUrl: "https://api.cohere.ai/compatibility/v1"
  },
  {
    id: "qwen",
    name: "Alibaba Cloud Qwen",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  },
  {
    id: "custom",
    name: "Custom API",
    protocol: "openai-compatible",
    baseUrl: ""
  }
];

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("Provider baseUrl must use HTTPS (HTTP is allowed only for localhost)");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function assertVaultProviderDestination({ presetId, baseUrl, protocol, secretProvider }) {
  const preset = MULTI_API_PRESETS.find(item => item.id === presetId && item.id !== "custom");
  if (!preset || preset.id !== secretProvider) {
    throw new Error("Vault Secret provider does not match the configured API provider");
  }
  if (normalizeProtocol(protocol || preset.protocol) !== preset.protocol || normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(preset.baseUrl)) {
    throw new Error("Vault-backed providers must use the verified provider endpoint");
  }
  return true;
}

function normalizeProtocol(value) {
  const protocol = String(value || "openai-compatible").trim();
  if (!["openai-compatible", "anthropic"].includes(protocol)) {
    throw new Error("Unsupported provider protocol");
  }
  return protocol;
}

function normalizeModels(value, { allowEmpty = false } = {}) {
  const input = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/)
        .map(item => item.trim());

  const models = [...new Set(
    input.map(item => String(item || "").trim()).filter(Boolean)
  )].slice(0, MAX_MODELS);

  if (!allowEmpty && models.length === 0) {
    throw new Error("Configure at least one model");
  }
  return models;
}

function normalizeProviderId(value) {
  const id = String(value || "").trim();
  if (!id || !/^[a-zA-Z0-9._-]{1,80}$/.test(id)) {
    throw new Error("Provider id is invalid");
  }
  return id;
}

function normalizeSecretReference(value) {
  const reference = String(value || "").trim();
  if (!reference) return "";
  if (!/^secret:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(reference)) {
    throw new Error("Vault Secret reference is invalid");
  }
  return reference;
}

function normalizeProviderInput(input, { requireKey = false, allowEmptyModels = false } = {}) {
  const presetId = String(input?.presetId || "custom").trim().slice(0, 64);
  const preset = MULTI_API_PRESETS.find(item => item.id === presetId);
  const id = input?.id ? normalizeProviderId(input.id) : `ui-${randomUUID()}`;
  const name = String(input?.name || preset?.name || "").trim().slice(0, 100);
  const protocol = normalizeProtocol(input?.protocol || preset?.protocol || "openai-compatible");
  const baseUrl = normalizeBaseUrl(input?.baseUrl || preset?.baseUrl);
  const apiKey = String(input?.apiKey || "").trim();
  const secretRef = normalizeSecretReference(input?.secretRef);
  const projectId = String(input?.projectId || "").trim();
  const models = normalizeModels(input?.models, { allowEmpty: allowEmptyModels });

  if (!name) throw new Error("Provider name is required");
  if (presetId === "custom" && !String(input?.baseUrl || "").trim()) {
    throw new Error("Custom API requires a Base URL");
  }
  if (apiKey && secretRef) throw new Error("Choose either an API key or a Vault reference");
  if (secretRef && !projectId) throw new Error("A registered project is required for a Vault reference");
  if (requireKey && !apiKey && !secretRef) throw new Error("API key or Vault reference is required");

  return {
    id,
    name,
    presetId,
    protocol,
    baseUrl,
    apiKey,
    secretRef,
    projectId,
    models
  };
}

function providerHeaders(provider) {
  if (provider.protocol === "anthropic") {
    return {
      "content-type": "application/json",
      "accept": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01"
    };
  }

  return {
    "content-type": "application/json",
    "accept": "application/json",
    "authorization": `Bearer ${provider.apiKey}`
  };
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

    const attachments = Array.isArray(message?.attachments)
      ? message.attachments.map(item => ({
          id: String(item?.id || "").trim(),
          name: String(item?.name || "image").slice(0, 160),
          mime: String(item?.mime || "").trim()
        }))
      : [];

    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error(`messages[${index}] has too many attachments`);
    }
    if (attachments.length > 0 && role !== "user") {
      throw new Error("Only user messages may contain image attachments");
    }
    for (const attachment of attachments) {
      if (!attachment.id) throw new Error("Attachment id is required");
    }

    if (!content.trim() && attachments.length === 0) {
      throw new Error(`messages[${index}] is empty`);
    }
    total += content.length;
    if (total > MAX_CONTENT_CHARS) throw new Error("message content is too large");
    return { role, content, attachments };
  });
}

function normalizeReasoningMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  if (!REASONING_MODES.has(mode)) throw new Error("Unsupported reasoning mode");
  return mode;
}

function reasoningModesForProvider(provider) {
  if (provider.protocol === "anthropic") return ["auto", "low", "medium", "high"];
  if (["openai", "gemini"].includes(provider.presetId)) {
    return ["auto", "none", "low", "medium", "high"];
  }
  return ["auto"];
}

function providerErrorMessage(payload, status) {
  const candidate =
    payload?.error?.message ??
    payload?.message ??
    payload?.error ??
    `Upstream API returned HTTP ${status}`;
  return String(candidate).slice(0, 600);
}

function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    presetId: provider.presetId || "custom",
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    ready: Boolean(provider.apiKey || provider.secretRef),
    credentialSource: provider.secretRef ? "vault" : "api-key",
    ...(provider.secretRef ? { secretRef: provider.secretRef, projectId: provider.projectId } : {}),
    models: provider.models,
    reasoningModes: reasoningModesForProvider(provider),
    source: provider.source || "file",
    editable: provider.source !== "env"
  };
}

export function publicMultiApiProviders(providers) {
  return providers.map(publicProvider);
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
    const id = normalizeProviderId(item?.id);
    if (seen.has(id)) throw new Error(`Duplicate provider id: ${id}`);
    seen.add(id);

    const apiKeyEnv = String(item?.apiKeyEnv || "").trim();
    if (!apiKeyEnv || !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
      throw new Error(`Provider #${index + 1} has an invalid apiKeyEnv`);
    }

    const normalized = normalizeProviderInput({
      id,
      name: item?.name || id,
      presetId: item?.presetId || "custom",
      protocol: item?.protocol || "openai-compatible",
      baseUrl: item?.baseUrl,
      apiKey: env[apiKeyEnv] || "",
      models: item?.models
    });

    return {
      ...normalized,
      apiKeyEnv,
      source: "env"
    };
  });
}

async function readProviderFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];
    return providers.map(item => ({
      ...normalizeProviderInput({
        id: item?.id,
        name: item?.name,
        presetId: item?.presetId,
        protocol: item?.protocol,
        baseUrl: item?.baseUrl,
        apiKey: item?.apiKey,
        secretRef: item?.secretRef,
        projectId: item?.projectId,
        models: item?.models
      }),
      createdAt: Number(item?.createdAt) || Date.now(),
      updatedAt: Number(item?.updatedAt) || Date.now(),
      source: "file"
    }));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProviderFile(filePath, providers) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => {});

  const payload = JSON.stringify({
    version: 1,
    providers: providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      presetId: provider.presetId,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      ...(provider.secretRef ? { secretRef: provider.secretRef, projectId: provider.projectId } : { apiKey: provider.apiKey }),
      models: provider.models,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    }))
  }, null, 2);

  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, payload, { mode: 0o600 });
  await chmod(temp, 0o600).catch(() => {});
  await rename(temp, filePath);
  await chmod(filePath, 0o600).catch(() => {});
}

export function createMultiApiStore({ filePath, env = process.env } = {}) {
  if (!filePath) throw new Error("multi-API store filePath is required");

  async function listResolved() {
    const [fileProviders, envProviders] = await Promise.all([
      readProviderFile(filePath),
      Promise.resolve(loadMultiApiProviders(env))
    ]);

    const ids = new Set(envProviders.map(provider => provider.id));
    return [
      ...envProviders,
      ...fileProviders.filter(provider => !ids.has(provider.id))
    ].slice(0, MAX_PROVIDERS);
  }

  async function upsert(input) {
    const providers = await readProviderFile(filePath);
    const existingIndex = input?.id
      ? providers.findIndex(provider => provider.id === String(input.id))
      : -1;
    const existing = existingIndex >= 0 ? providers[existingIndex] : null;

    if (existing == null && providers.length >= MAX_PROVIDERS) {
      throw new Error("Too many API providers");
    }

    const credentialMode = input?.credentialMode === "vault"
      ? "vault"
      : input?.credentialMode === "api-key"
        ? "api-key"
        : "legacy";
    const requestedSecretRef = String(input?.secretRef || "").trim();
    if (String(input?.apiKey || "").trim() && (credentialMode === "vault" || requestedSecretRef)) {
      throw new Error("Choose either an API key or a Vault reference");
    }
    const useVault = credentialMode === "vault" || (credentialMode === "legacy" && Boolean(requestedSecretRef || existing?.secretRef));
    const normalized = normalizeProviderInput({
      ...input,
      id: existing?.id || input?.id,
      secretRef: useVault ? requestedSecretRef || existing?.secretRef : "",
      projectId: useVault ? input?.projectId || existing?.projectId : "",
      apiKey: useVault ? "" : String(input?.apiKey || "").trim() || (existing?.secretRef ? "" : existing?.apiKey || "")
    });

    if (!normalized.apiKey && !normalized.secretRef) throw new Error("API key or Vault reference is required");

    const now = Date.now();
    const record = {
      ...normalized,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      source: "file"
    };

    if (existingIndex >= 0) providers[existingIndex] = record;
    else providers.push(record);

    await writeProviderFile(filePath, providers);
    return publicProvider(record);
  }

  async function remove(id) {
    const providerId = normalizeProviderId(id);
    const providers = await readProviderFile(filePath);
    const next = providers.filter(provider => provider.id !== providerId);
    if (next.length === providers.length) throw new Error("Provider not found");
    await writeProviderFile(filePath, next);
    return { ok: true };
  }

  return {
    listResolved,
    upsert,
    remove
  };
}

function parseModelList(payload) {
  const raw = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];

  return [...new Set(
    raw
      .map(item => typeof item === "string" ? item : item?.id ?? item?.name)
      .map(item => String(item || "").trim())
      .filter(Boolean)
  )].slice(0, MAX_MODELS);
}

export async function testMultiApiProvider(input, fetchImpl = fetch) {
  const provider = normalizeProviderInput(input, {
    requireKey: true,
    allowEmptyModels: true
  });

  const upstream = await fetchImpl(`${provider.baseUrl}/models`, {
    method: "GET",
    headers: providerHeaders(provider),
    signal: AbortSignal.timeout(20_000)
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const error = new Error(providerErrorMessage(data, upstream.status));
    error.status = upstream.status;
    throw error;
  }

  return {
    ok: true,
    models: parseModelList(data)
  };
}

async function resolveMessageAttachments(messages, attachmentStore) {
  const cache = new Map();

  async function load(id) {
    if (!attachmentStore) throw new Error("Image attachments are not available");
    if (!cache.has(id)) cache.set(id, await attachmentStore.read(id));
    return cache.get(id);
  }

  const resolved = [];
  for (const message of messages) {
    const attachments = [];
    for (const attachment of message.attachments || []) {
      attachments.push(await load(attachment.id));
    }
    resolved.push({ ...message, resolvedAttachments: attachments });
  }
  return resolved;
}

function openAiMessages(messages) {
  return messages.map(message => {
    if (!message.resolvedAttachments?.length) {
      return { role: message.role, content: message.content };
    }

    const content = [];
    if (message.content.trim()) content.push({ type: "text", text: message.content });
    for (const attachment of message.resolvedAttachments) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${attachment.mime};base64,${attachment.buffer.toString("base64")}`
        }
      });
    }
    return { role: message.role, content };
  });
}

function anthropicMessages(messages) {
  return messages
    .filter(message => message.role !== "system")
    .map(message => {
      if (!message.resolvedAttachments?.length) {
        return { role: message.role, content: message.content };
      }

      const content = [];
      if (message.content.trim()) content.push({ type: "text", text: message.content });
      for (const attachment of message.resolvedAttachments) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.mime,
            data: attachment.buffer.toString("base64")
          }
        });
      }
      return { role: message.role, content };
    });
}

async function runOpenAiCompatible(provider, model, messages, reasoningMode, fetchImpl) {
  const body = {
    model,
    messages: openAiMessages(messages),
    stream: false
  };

  if (reasoningMode !== "auto" && ["openai", "gemini"].includes(provider.presetId)) {
    body.reasoning_effort = reasoningMode;
  }

  const upstream = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: providerHeaders(provider),
    body: JSON.stringify(body),
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
    throw new Error("Provider returned an unsupported OpenAI-compatible response shape");
  }

  return {
    content,
    usage: data?.usage ?? null
  };
}

async function runAnthropic(provider, model, messages, reasoningMode, fetchImpl) {
  const systemMessages = messages.filter(message => message.role === "system");
  const body = {
    model,
    max_tokens: 8192,
    messages: anthropicMessages(messages)
  };

  if (systemMessages.length > 0) {
    body.system = systemMessages.map(message => message.content).join("\n\n");
  }

  if (reasoningMode !== "auto") {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: reasoningMode };
  }

  const upstream = await fetchImpl(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: providerHeaders(provider),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const error = new Error(providerErrorMessage(data, upstream.status));
    error.status = upstream.status;
    throw error;
  }

  const content = Array.isArray(data?.content)
    ? data.content
        .filter(item => item?.type === "text")
        .map(item => String(item?.text || ""))
        .join("")
    : "";

  if (!content) {
    throw new Error("Provider returned an unsupported Anthropic response shape");
  }

  return {
    content,
    usage: data?.usage ?? null
  };
}

export async function runMultiApiChat(
  providers,
  payload,
  fetchImpl = fetch,
  { attachmentStore = null } = {}
) {
  const providerId = String(payload?.providerId || "").trim();
  const model = String(payload?.model || "").trim();
  const reasoning = normalizeReasoningMode(payload?.reasoning);
  const provider = providers.find(item => item.id === providerId);

  if (!provider) throw new Error("Unknown API provider");
  if (!provider.apiKey) throw new Error(`API credential is not configured for ${provider.name}`);
  if (!provider.models.includes(model)) throw new Error("Model is not allowed for this provider");
  if (!reasoningModesForProvider(provider).includes(reasoning)) {
    throw new Error("Reasoning mode is not supported by this provider");
  }

  const messages = await resolveMessageAttachments(
    normalizeMessages(payload?.messages),
    attachmentStore
  );
  const result = provider.protocol === "anthropic"
    ? await runAnthropic(provider, model, messages, reasoning, fetchImpl)
    : await runOpenAiCompatible(provider, model, messages, reasoning, fetchImpl);

  return {
    providerId,
    model,
    reasoning,
    message: { role: "assistant", content: result.content },
    usage: result.usage
  };
}
