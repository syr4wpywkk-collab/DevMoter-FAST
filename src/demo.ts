import { t } from "./i18n";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function mountDemo(root: HTMLElement) {
  document.body.classList.remove("codex-mode", "opencode-mode");
  document.body.classList.add("devmoter-demo-mode");

  root.innerHTML = `
    <main class="devmoter-demo">
      <header class="devmoter-demo-head">
        <div>
          <span class="devmoter-demo-badge">${escapeHtml(t("demo.eyebrow"))}</span>
          <h1>DevMoter FAST</h1>
          <p>${escapeHtml(t("demo.lead"))}</p>
        </div>
        <a href="/">${escapeHtml(t("demo.exit"))}</a>
      </header>

      <section class="devmoter-demo-grid">
        <article>
          <small>${escapeHtml(t("demo.sessionLabel"))}</small>
          <strong>${escapeHtml(t("demo.sessionTitle"))}</strong>
          <p>${escapeHtml(t("demo.sessionMeta"))}</p>
          <div id="demoState" class="devmoter-demo-state">${escapeHtml(t("demo.stateReady"))}</div>
        </article>
        <article>
          <small>${escapeHtml(t("demo.safePreviewLabel"))}</small>
          <strong>${escapeHtml(t("demo.scriptedActivity"))}</strong>
          <pre id="demoLog">${escapeHtml(t("demo.initialLog"))}</pre>
        </article>
      </section>

      <section class="devmoter-demo-actions">
        <button id="demoRun" type="button">${escapeHtml(t("demo.runButton"))}</button>
        <button id="demoReset" type="button">${escapeHtml(t("demo.resetButton"))}</button>
      </section>
    </main>
  `;

  const state = root.querySelector<HTMLElement>("#demoState")!;
  const log = root.querySelector<HTMLElement>("#demoLog")!;
  const run = root.querySelector<HTMLButtonElement>("#demoRun")!;
  const reset = root.querySelector<HTMLButtonElement>("#demoReset")!;
  let timers: number[] = [];

  const clear = () => {
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
  };

  const resetDemo = () => {
    clear();
    state.textContent = t("demo.stateReady");
    log.textContent = t("demo.initialLog");
    run.disabled = false;
  };

  run.addEventListener("click", () => {
    resetDemo();
    run.disabled = true;
    state.textContent = t("demo.stateRunning");
    log.textContent += t("demo.logWorking");
    timers.push(window.setTimeout(() => {
      state.textContent = t("demo.stateApproval");
      log.textContent += t("demo.logApproval");
    }, 700));
    timers.push(window.setTimeout(() => {
      state.textContent = t("demo.stateCompleted");
      log.textContent += t("demo.logComplete");
      run.disabled = false;
    }, 1500));
  });

  reset.addEventListener("click", resetDemo);
}
