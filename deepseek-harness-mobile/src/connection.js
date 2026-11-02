export const STORAGE_KEY = "dsh-mobile.host-url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateHostUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "DSH ホスト URL を入力してください。" };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "有効な URL を入力してください。" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "HTTPS の URL を指定してください。" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URL にユーザー名やパスワードを含めないでください。" };
  }
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return { ok: false, error: "ホストのオリジンのみ入力してください（パス・クエリ不要）。" };
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return { ok: false, error: "リモートホストには HTTPS が必要です。HTTP は localhost の開発用途のみ利用できます。" };
  }

  return { ok: true, value: url.origin };
}

export function readSavedHost(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (!saved) return "";
    const checked = validateHostUrl(saved);
    return checked.ok ? checked.value : "";
  } catch {
    return "";
  }
}

export function saveHostUrl(value, storage = globalThis.localStorage) {
  const checked = validateHostUrl(value);
  if (!checked.ok) return checked;
  try {
    storage?.setItem(STORAGE_KEY, checked.value);
    return { ok: true, value: checked.value };
  } catch {
    return { ok: false, error: "このブラウザでは接続先を保存できませんでした。" };
  }
}

export function clearSavedHost(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
