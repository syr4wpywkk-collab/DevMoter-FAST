import "./home.css";
import { APP_REGISTRY, type AppId } from "./app-registry";
import { mountHomeBackendShortcuts, type ChatBackend } from "./react/home-backend-shortcuts";

type HomeOptions = {
  onLaunchApp: (id: AppId) => void;
  onPreviewApp: (id: AppId, message: string) => void;
  onSwitchBackend?: (backend: ChatBackend) => void;
};

const pilotDisposers = new WeakMap<HTMLElement, () => void>();

export function mountHomeSurface(target: HTMLElement, options: HomeOptions) {
  // Unmount any previous React island before the Vanilla TS renderer replaces it.
  pilotDisposers.get(target)?.();
  pilotDisposers.delete(target);
  target.innerHTML = `
    <div class="dm-home-shell">
      <header class="dm-home-header">
        <div class="dm-home-brand-mark" aria-hidden="true">D</div>
        <div>
          <p class="dm-home-eyebrow">DEV MOTER FAST <span aria-hidden="true">/</span> WORKSPACE</p>
          <h1 id="devmoterHomeTitle" tabindex="-1">作業スペース</h1>
          <p class="dm-home-subtitle">開発ツールと作業中のプロジェクト。</p>
        </div>
      </header>

      <section class="dm-home-section" aria-labelledby="dm-home-apps-title">
        <div class="dm-home-section-heading">
          <div><p class="dm-home-eyebrow">TOOLBOX</p><h2 id="dm-home-apps-title">ツール</h2></div>
          <span class="dm-home-section-note">使う機能を選択</span>
        </div>
        <div class="dm-home-app-grid" data-home-app-grid>
          ${APP_REGISTRY.map(app => {
            const disabled = app.availability === "unavailable";
            const state = app.availability === "preview" ? "Preview" : app.availability === "unavailable" ? "Unavailable" : "";
            return `<button class="dm-home-app-card" type="button" data-home-app="${app.id}" aria-label="${app.title}${state ? `, ${state}` : ""}"${disabled ? " disabled aria-disabled=\"true\"" : app.availability === "preview" ? " aria-disabled=\"true\"" : ""}>
              <span class="dm-home-card-icon" aria-hidden="true">${app.icon}</span>
              <span class="dm-home-card-copy"><strong>${app.title}</strong><small>${app.shortDescription}</small>${state ? `<em class="dm-home-app-state">${state}</em>` : ""}</span>
              <span class="dm-home-card-arrow" aria-hidden="true">${app.availability === "available" ? '<svg viewBox="0 0 20 20" focusable="false"><path d="M5 15 15 5M6 5h9v9" /></svg>' : "·"}</span>
            </button>`;
          }).join("")}
        </div>
      </section>

      <section class="dm-home-section dm-home-continue" aria-labelledby="dm-home-continue-title" data-home-continue>
        <div class="dm-home-section-heading">
          <div><p class="dm-home-eyebrow">RECENT WORK</p><h2 id="dm-home-continue-title">作業を続ける</h2></div>
        </div>
        <p>会話やプロジェクトの状態は、それぞれのワークスペースに保存されています。</p>
        <button type="button" class="dm-home-text-action" data-home-open-chat aria-label="チャットのワークスペースを開く">チャットを開く <span aria-hidden="true">→</span></button>
        <div data-home-react-pilot></div>
      </section>

      <footer class="dm-home-footer">DevMoter FAST <span>·</span> ローカル開発環境</footer>
    </div>
  `;
  // The Continue card previously looked interactive but had no click handler.
  // Reuse the registered chat launch path so navigation keeps its existing
  // backend selection and browser history semantics.
  target.querySelector<HTMLButtonElement>("[data-home-open-chat]")?.addEventListener("click", () => {
    options.onLaunchApp("chat");
  });

  if (options.onSwitchBackend) {
    const pilotHost = target.querySelector<HTMLElement>("[data-home-react-pilot]");
    if (pilotHost) pilotDisposers.set(target, mountHomeBackendShortcuts(pilotHost, options.onSwitchBackend));
  }

  target.querySelectorAll<HTMLButtonElement>("[data-home-app]").forEach(button => {
    button.addEventListener("click", () => {
      const id = button.dataset.homeApp;
      if (!id) return;
      const app = APP_REGISTRY.find(entry => entry.id === id);
      if (!app) return;
      if (app.availability === "preview" || app.availability === "unavailable") {
        options.onPreviewApp(app.id, app.previewMessage || `${app.title} is not available yet.`);
      } else options.onLaunchApp(app.id);
    });
  });
}
