import "./home.css";
import { APP_REGISTRY, type AppId } from "./app-registry";

type HomeOptions = {
  onLaunchApp: (id: AppId) => void;
  onPreviewApp: (id: AppId, message: string) => void;
};

export function mountHomeSurface(target: HTMLElement, options: HomeOptions) {
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
              <span class="dm-home-card-arrow" aria-hidden="true">${app.availability === "available" ? "↗" : "·"}</span>
            </button>`;
          }).join("")}
        </div>
      </section>

      <section class="dm-home-section dm-home-continue" aria-labelledby="dm-home-continue-title" data-home-continue>
        <div class="dm-home-section-heading">
          <div><p class="dm-home-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="dm-home-continue-title">Continue working</h2></div>
        </div>
        <p>Your chats and project activity are still available in their workspaces.</p>
        <button type="button" class="dm-home-text-action" data-home-open-chat>Go to Chat <span aria-hidden="true">→</span></button>
      </section>

      <footer class="dm-home-footer">DevMoter FAST <span>·</span> Your local AI workspace</footer>
    </div>
  `;
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
