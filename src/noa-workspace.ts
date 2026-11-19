import "./noa-workspace.css";
import { formatTime, t } from "./i18n";

type Message = { id: number; channel: string; author: string; text: string; time: string };
const KEY = "devmoter-noa-workspace-v1";
const defaultMessages = (): Message[] => [
  { id: 1, channel: "general", author: "NOA", text: t("noa.defaultWelcome1"), time: "09:00" },
  { id: 2, channel: "devmoter", author: "NOA", text: t("noa.defaultWelcome2"), time: "09:05" }
];
const channels = ["general", "devmoter", "ideas", "tasks"];
function load(): Message[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return Array.isArray(value) ? value : defaultMessages();
  } catch {
    return defaultMessages();
  }
}
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function mountNoaWorkspace(host: HTMLElement) {
  const messages = load();
  let current = "general";
  let search = "";
  host.innerHTML = `<div class="noa-shell">
    <aside class="noa-rail"><div class="noa-logo">N</div><button type="button" id="noa-back" title="${escapeHtml(t("noa.back"))}">⌂</button><span>NOA</span></aside>
    <aside class="noa-sidebar"><header><strong>NOA Workspace</strong><small>DevMoter FAST</small></header>
      <p>${escapeHtml(t("noa.channels"))}</p><nav id="noa-channels"></nav><p>${escapeHtml(t("noa.workspace"))}</p><div class="noa-note">${escapeHtml(t("noa.sidebarNote"))}</div></aside>
    <section class="noa-main"><header><div><strong id="noa-heading"># general</strong><small>${escapeHtml(t("noa.topic"))}</small></div><input id="noa-search" aria-label="${escapeHtml(t("noa.searchAria"))}" placeholder="${escapeHtml(t("noa.searchPlaceholder"))}" /></header>
      <div id="noa-messages" class="noa-messages" role="log" aria-live="polite"></div>
      <form id="noa-compose"><label for="noa-input">${escapeHtml(t("noa.inputLabel"))}</label><textarea id="noa-input" rows="2" maxlength="4000" placeholder="${escapeHtml(t("noa.inputPlaceholder"))}"></textarea><button type="submit">${escapeHtml(t("noa.submit"))}</button></form>
    </section><aside class="noa-detail"><strong>${escapeHtml(t("noa.detailHeading"))}</strong><p id="noa-detail-name"># general</p><small>${escapeHtml(t("noa.detailStorageNote"))}</small></aside>
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
      button.addEventListener("click", () => {
        current = channel;
        search = "";
        (host.querySelector("#noa-search") as HTMLInputElement).value = "";
        render();
      });
      channelHost.append(button);
    });
    heading.textContent = "# " + current;
    detail.textContent = "# " + current;
    messageHost.replaceChildren();
    messages.filter(m => m.channel === current && (m.text + m.author).toLowerCase().includes(search)).forEach(m => {
      const article = document.createElement("article");
      const avatar = document.createElement("span");
      avatar.className = "noa-avatar";
      avatar.textContent = m.author.slice(0, 1);
      const body = document.createElement("div");
      const meta = document.createElement("div");
      meta.className = "noa-meta";
      const name = document.createElement("strong");
      name.textContent = m.author === "You" ? t("noa.you") : m.author;
      const time = document.createElement("small");
      time.textContent = m.time;
      const text = document.createElement("p");
      text.textContent = m.text;
      meta.append(name, time);
      body.append(meta, text);
      article.append(avatar, body);
      messageHost.append(article);
    });
    messageHost.scrollTop = messageHost.scrollHeight;
  }
  host.querySelector("#noa-search")!.addEventListener("input", e => {
    search = (e.target as HTMLInputElement).value.toLowerCase();
    render();
  });
  host.querySelector("#noa-compose")!.addEventListener("submit", e => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    messages.push({
      id: Date.now(),
      channel: current,
      author: "You",
      text: value,
      time: formatTime(Date.now(), { hour: "2-digit", minute: "2-digit" })
    });
    localStorage.setItem(KEY, JSON.stringify(messages));
    input.value = "";
    render();
    input.focus();
  });
  host.querySelector("#noa-back")!.addEventListener("click", () => window.location.assign(window.location.pathname));
  render();
}
