import "./noa-workspace.css";

type Message = { id: number; channel: string; author: string; text: string; time: string };
const KEY = "devmoter-noa-workspace-v1";
const defaults: Message[] = [
  { id: 1, channel: "general", author: "NOA", text: "NOA Workspaceへようこそ！ここで開発の相談を始めよう ✨", time: "09:00" },
  { id: 2, channel: "devmoter", author: "NOA", text: "DevMoter FASTの開発ログをまとめるチャンネルです。", time: "09:05" },
];
const channels = ["general", "devmoter", "ideas", "tasks"];
function load(): Message[] {
  try { const value = JSON.parse(localStorage.getItem(KEY) || "null"); return Array.isArray(value) ? value : defaults; }
  catch { return defaults; }
}
export function mountNoaWorkspace(host: HTMLElement) {
  let messages = load();
  let current = "general";
  let search = "";
  host.innerHTML = `<div class="noa-shell">
    <aside class="noa-rail"><div class="noa-logo">N</div><button type="button" id="noa-back" title="DevMoterに戻る">⌂</button><span>NOA</span></aside>
    <aside class="noa-sidebar"><header><strong>NOA Workspace</strong><small>DevMoter FAST</small></header>
      <p>チャンネル</p><nav id="noa-channels"></nav><p>ワークスペース</p><div class="noa-note">開発チームの会話をここに整理できます。</div></aside>
    <section class="noa-main"><header><div><strong id="noa-heading"># general</strong><small>開発チームの会話</small></div><input id="noa-search" aria-label="メッセージ検索" placeholder="メッセージを検索…" /></header>
      <div id="noa-messages" class="noa-messages" role="log" aria-live="polite"></div>
      <form id="noa-compose"><label for="noa-input">メッセージを送信</label><textarea id="noa-input" rows="2" maxlength="4000" placeholder="メッセージを書く…"></textarea><button type="submit">送信 ↑</button></form>
    </section><aside class="noa-detail"><strong>チャンネル詳細</strong><p id="noa-detail-name"># general</p><small>メッセージはこのブラウザに保存されます。共有や同期はまだ行われません。</small></aside>
  </div>`;
  const channelHost = host.querySelector<HTMLElement>("#noa-channels")!;
  const messageHost = host.querySelector<HTMLElement>("#noa-messages")!;
  const heading = host.querySelector<HTMLElement>("#noa-heading")!;
  const detail = host.querySelector<HTMLElement>("#noa-detail-name")!;
  const input = host.querySelector<HTMLTextAreaElement>("#noa-input")!;
  function render() {
    channelHost.replaceChildren();
    channels.forEach(channel => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "# " + channel;
      button.classList.toggle("active", current === channel);
      button.addEventListener("click", () => { current = channel; search = ""; (host.querySelector("#noa-search") as HTMLInputElement).value = ""; render(); });
      channelHost.append(button);
    });
    heading.textContent = "# " + current;
    detail.textContent = "# " + current;
    messageHost.replaceChildren();
    messages.filter(m => m.channel === current && (m.text + m.author).toLowerCase().includes(search)).forEach(m => {
      const article = document.createElement("article");
      const avatar = document.createElement("span"); avatar.className = "noa-avatar"; avatar.textContent = m.author.slice(0, 1);
      const body = document.createElement("div");
      const meta = document.createElement("div"); meta.className = "noa-meta";
      const name = document.createElement("strong"); name.textContent = m.author;
      const time = document.createElement("small"); time.textContent = m.time;
      const text = document.createElement("p"); text.textContent = m.text;
      meta.append(name, time); body.append(meta, text); article.append(avatar, body); messageHost.append(article);
    });
    messageHost.scrollTop = messageHost.scrollHeight;
  }
  host.querySelector("#noa-search")!.addEventListener("input", e => { search = (e.target as HTMLInputElement).value.toLowerCase(); render(); });
  host.querySelector("#noa-compose")!.addEventListener("submit", e => {
    e.preventDefault(); const value = input.value.trim(); if (!value) return;
    messages.push({ id: Date.now(), channel: current, author: "You", text: value, time: new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) });
    localStorage.setItem(KEY, JSON.stringify(messages)); input.value = ""; render(); input.focus();
  });
  host.querySelector("#noa-back")!.addEventListener("click", () => window.location.assign(window.location.pathname));
  render();
}
