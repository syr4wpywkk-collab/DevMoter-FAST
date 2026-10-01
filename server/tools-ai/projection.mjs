import { redactSecretsInText } from "../secret-redaction.mjs";

export const LIMITS = Object.freeze({ bytes: 24_000, textBytes: 12_000, items: 40, snippetBytes: 800, diffBytes: 4_000, documentBytes: 8_000 });
export const sensitivePath = path => /(?:^|\/)(?:\.env(?:\..*)?|\.ssh|credentials?[^/]*|secrets?[^/]*|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i.test(path);
const suspicious = /-----BEGIN .*PRIVATE KEY-----|(?:api[_-]?key|secret(?:[_-]?(?:access)?[_-]?key)?|private[_-]?key|password|passwd|token|credential|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["']?[^\s"',;]{4,}|authorization\s*[:=]\s*["']?(?:bearer|basic)\s+\S+|\b(?:sk-[a-zA-Z0-9_-]{8,}|gh[pousr]_[a-zA-Z0-9]{10,}|github_pat_[a-zA-Z0-9_]+|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|https?:\/\/[^\s/:]+:[^\s/@]+@/i;

function excludeSuspiciousContent(value, secrets) {
  const containsSecret = text => suspicious.test(text) || secrets.some(secret => secret && text.includes(secret));
  if (!containsSecret(value)) return { text: value, excluded: false };
  if (/-----BEGIN .*PRIVATE KEY-----/.test(value) || secrets.some(s => s?.includes("\n") && value.includes(s))) return { text: "[安全上、内容を除外]", excluded: true };
  let excluded = false;
  const text = value.split("\n").map(line => {
    if (!containsSecret(line)) return line;
    excluded = true; return "[安全上、内容を除外]";
  }).join("\n");
  // Multiline assignments that cannot be isolated safely exclude the entire field.
  return excluded && !containsSecret(text) ? { text, excluded: true } : { text: "[安全上、内容を除外]", excluded: true };
}

export function clipBytes(text, limit) {
  const bytes = Buffer.from(String(text));
  return bytes.length <= limit ? String(text) : bytes.subarray(0, limit).toString("utf8").replace(/\uFFFD$/, "");
}

export function safeText(value, secrets = [], maxBytes = 2_000) {
  const text = String(value);
  if (suspicious.test(text) || secrets.some(secret => secret && text.includes(secret))) return "[安全上、内容を除外]";
  return clipBytes(redactSecretsInText(text, secrets), maxBytes);
}

export function projectResult(type, raw, secrets = []) {
  let budget = LIMITS.textBytes;
  const sharing = { excluded: false, truncated: false };
  const clean = (value, depth = 0, key = "") => {
    if (depth > 7) { sharing.truncated = true; return null; }
    if (typeof value === "string") {
      // Scan BEFORE truncation, so credentials outside the visible prefix cannot escape detection.
      if ((key === "path" || key === "name") && sensitivePath(value)) {
        sharing.excluded = true; return "[安全上、内容を除外]";
      }
      const safe = excludeSuspiciousContent(value, secrets);
      sharing.excluded ||= safe.excluded;
      const cap = key === "diff" ? LIMITS.diffBytes : key === "content" ? LIMITS.documentBytes : LIMITS.snippetBytes;
      const text = clipBytes(redactSecretsInText(safe.text, secrets), Math.max(0, Math.min(cap, budget)));
      budget -= Buffer.byteLength(text); sharing.truncated ||= text !== safe.text;
      return text;
    }
    if (Array.isArray(value)) {
      sharing.truncated ||= value.length > LIMITS.items;
      return value.slice(0, LIMITS.items).map(v => clean(v, depth + 1, key));
    }
    if (value && typeof value === "object") {
      const output = {};
      for (const [k, v] of Object.entries(value).slice(0, 40)) {
        if (/^(?:apiKey|token|password|secret|headers|env|root|cwd)$/i.test(k)) { sharing.excluded = true; continue; }
        output[k] = clean(v, depth + 1, k);
      }
      return output;
    }
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  };
  const data = clean(raw);
  const facts = [];
  const fact = text => { if (facts.length < 30) facts.push({ id: `f${facts.length}`, text: clipBytes(text, 800) }); };
  if (raw.unavailable) fact(data.message || "取得できませんでした。");
  else if (type === "git") {
    fact(data.status.isGit ? `Git branch: ${data.status.branch}。変更ファイル数: ${data.files.total}。staged: ${data.status.staged} / modified: ${data.status.modified} / untracked: ${data.status.untracked} / conflicts: ${data.status.conflicts}。` : "Git helperでリポジトリとして確認できませんでした。");
    fact(`変更一覧は最大${data.files.files.length}件、差分は${data.diffs.length}件を取得しました。省略した内容を確認済みとは扱いません。`);
    for (const file of data.files.files) fact(`変更: ${JSON.stringify(file.path)} (${file.status.join(", ")})。`);
  } else if (type === "search") {
    fact(`保存済みindexの作成時刻: ${data.builtAt}。現在のファイル状態は未確認です。`);
    fact(`検索 ${JSON.stringify(data.query)}: 返却結果${data.results.length}件。`);
    for (const item of data.results.slice(0, 8)) fact(`${JSON.stringify(item.path)}:${item.line} — ${item.snippet}`);
  } else if (type === "map") {
    fact(`保存済みindexの作成時刻: ${data.builtAt}。index内のファイル総数: ${raw.totalFiles}。現在のファイル状態は未確認です。`);
    for (const directory of data.directories.slice(0, 8)) fact(`構造: ${JSON.stringify(directory.path)} (${directory.fileCount} files in saved index)。`);
  } else if (type === "document") {
    fact(`取得したMarkdown: ${JSON.stringify(data.path)}。元のbyte数: ${data.size}。`);
    const lines = data.content.split("\n").map(s => s.trim()).filter(Boolean);
    const relevant = lines.filter(line => /npm|pnpm|yarn|bun|start|install|起動|手順|^#/.test(line));
    for (const line of [...new Set([...relevant, ...lines])].slice(0, 12)) fact(`文書内の記載: ${JSON.stringify(line)}`);
  } else if (type === "diagnostics") {
    fact(`診断: 必須ツールの不足 ${JSON.stringify(data.prerequisites.missing)}。これは固定されたhost観測です。設定変更は行っていません。`);
    for (const [name, health] of Object.entries(data.backends || {})) fact(`接続状態 ${name}: ${JSON.stringify(health)}`);
    fact(`Network: ${data.network.message}`);
  }
  if (sharing.excluded) fact("安全上、一部内容をAIへの共有対象から除外しました。除外した内容は説明できません。");
  if (sharing.truncated) fact("件数・byte上限により一部を省略しました。省略部分は未取得・未共有として扱います。");
  const result = { type, source: raw.source, builtAt: raw.builtAt ?? null, unavailable: Boolean(raw.unavailable), data, sharing, facts };
  // Strict envelope cap, including keys/metadata/facts; retain provenance rather than send an oversized result.
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.bytes) {
    return { type, source: raw.source, builtAt: raw.builtAt ?? null, unavailable: true,
      data: { message: "結果が上限を超えたため内容を省略しました。" }, sharing: { ...sharing, truncated: true },
      facts: [{ id: "f0", text: "結果が24KBの上限を超えたため、内容をAIへ共有していません。" }] };
  }
  return result;
}
