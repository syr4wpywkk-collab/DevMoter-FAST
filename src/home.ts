import "./home.css";

type HomeOptions = {
  onOpenChat: () => void;
  onOpenProjects: () => void;
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
          <button class="dm-home-app-card" type="button" data-home-open-chat>
            <span class="dm-home-card-icon" aria-hidden="true">✳</span>
            <span><strong>Chat</strong><small>Open your AI workspace</small></span>
            <span class="dm-home-card-arrow" aria-hidden="true">↗</span>
          </button>
          <button class="dm-home-app-card" type="button" data-home-open-projects>
            <span class="dm-home-card-icon dm-home-project-icon" aria-hidden="true">▱</span>
            <span><strong>Projects</strong><small>Browse registered workspaces</small></span>
            <span class="dm-home-card-arrow" aria-hidden="true">↗</span>
          </button>
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
  target.querySelectorAll<HTMLButtonElement>("[data-home-open-chat]").forEach(button => button.addEventListener("click", options.onOpenChat));
  target.querySelector<HTMLButtonElement>("[data-home-open-projects]")?.addEventListener("click", options.onOpenProjects);
}
