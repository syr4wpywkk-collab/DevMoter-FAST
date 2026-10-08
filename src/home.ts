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
          <p class="dm-home-eyebrow">DEV MOTER FAST</p>
          <h1 id="devmoterHomeTitle" tabindex="-1">Your workspace</h1>
          <p class="dm-home-subtitle">A calm starting point for building with AI.</p>
        </div>
      </header>

      <section class="dm-home-section" aria-labelledby="dm-home-apps-title">
        <div class="dm-home-section-heading">
          <div><p class="dm-home-eyebrow">WORKSPACE</p><h2 id="dm-home-apps-title">Apps</h2></div>
          <span class="dm-home-section-note">Choose a place to work</span>
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
          <div><p class="dm-home-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="dm-home-continue-title">Continue working</h2></div>
        </div>
        <p>Your chats and project activity are still available in their workspaces.</p>
        <button type="button" class="dm-home-text-action" data-home-open-chat aria-label="Open your last chat workspace">Go to Chat <span aria-hidden="true">→</span></button>
        <div data-home-react-pilot></div>
      </section>

      <footer class="dm-home-footer">DevMoter FAST <span>·</span> Your local AI workspace</footer>
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
