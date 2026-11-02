import "./qwen-chat.css";
import { renderChatMarkdown } from "./chat-markdown.mjs";

type Project = { id: string; name: string; path: string; available?: boolean };
type Message = { role: "user" | "assistant" | "error"; text: string };

const SESSION_KEY = "devmoter-qwen-session";

function opId() {
  return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST",
    headers: { "content-type": "application/json", "x-pocket-operation-id": opId() },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
  return payload as T;
}

export function mountQwenChat(root: HTMLElement) {
  root.innerHTML = `
    <div class="qx-app">
      <header class="qx-top"><strong>Qwen Code</strong><button type="button" class="qx-new" data-qwen-new>新規</button></header>
      <div class="qx-log" data-qwen-log data-i18n-skip aria-live="polite"></div>
      <form class="qx-form" data-qwen-form>
        <textarea data-qwen-input rows="2" placeholder="メッセージ" aria-label="メッセージ"></textarea>
        <button type="submit" data-qwen-send>送信</button>
      </form>
    </div>`;
  const log = root.querySelector<HTMLDivElement>("[data-qwen-log]")!;
  const form = root.querySelector<HTMLFormElement>("[data-qwen-form]")!;
  const input = root.querySelector<HTMLTextAreaElement>("[data-qwen-input]")!;
  const send = root.querySelector<HTMLButtonElement>("[data-qwen-send]")!;
  const messages: Message[] = [];
  let busy = false;

  const render = () => {
    log.replaceChildren();
    for (const m of messages) {
      const el = document.createElement("div");
      el.className = `qx-msg qx-${m.role}`;
      if (m.role === "assistant") renderChatMarkdown(el, m.text, text => void navigator.clipboard?.writeText(text));
      else el.textContent = m.text;
      log.append(el);
    }
    if (busy) {
      const wait = document.createElement("div");
      wait.className = "qx-msg qx-wait";
      wait.textContent = "考え中…";
      log.append(wait);
    }
    log.scrollTop = log.scrollHeight;
  };

  async function currentProject(): Promise<Project> {
    const { projects = [] } = await api<{ projects?: Project[] }>("/api/projects");
    const usable = projects.filter(p => p.available !== false);
    const saved = localStorage.getItem("opencode-pocket-project") || "";
    const project = usable.find(p => p.id === saved || p.path === saved) || usable[0];
    if (!project) throw new Error("プロジェクトがありません");
    return project;
  }

  root.querySelector("[data-qwen-new]")!.addEventListener("click", () => {
    localStorage.removeItem(SESSION_KEY);
    messages.length = 0;
    render();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || busy) return;
    input.value = "";
    messages.push({ role: "user", text: prompt });
    busy = true;
    send.disabled = true;
    render();
    try {
      const project = await currentProject();
      const sessionId = localStorage.getItem(SESSION_KEY) || null;
      const reply = await api<{ text: string; sessionId: string | null }>("/api/qwen/chat", { projectId: project.id, prompt, sessionId });
      if (reply.sessionId) localStorage.setItem(SESSION_KEY, reply.sessionId);
      messages.push({ role: "assistant", text: reply.text || "（空の応答）" });
    } catch (error) {
      messages.push({ role: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
      send.disabled = false;
      render();
    }
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  render();
}
