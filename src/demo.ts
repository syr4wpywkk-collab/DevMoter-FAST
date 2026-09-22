export function mountDemo(root: HTMLElement) {
  document.body.classList.remove("codex-mode", "opencode-mode");
  document.body.classList.add("devmoter-demo-mode");

  root.innerHTML = `
    <main class="devmoter-demo">
      <header class="devmoter-demo-head">
        <div>
          <span class="devmoter-demo-badge">OFFLINE SCRIPTED DEMO</span>
          <h1>DevMoter FAST</h1>
          <p>No real CLI, project file, credential, or backend is used in this mode.</p>
        </div>
        <a href="/">Exit demo</a>
      </header>

      <section class="devmoter-demo-grid">
        <article>
          <small>SESSION</small>
          <strong>Refactor mobile settings</strong>
          <p>Fake session · Codex · demo-project</p>
          <div id="demoState" class="devmoter-demo-state">Ready</div>
        </article>
        <article>
          <small>SAFE PREVIEW</small>
          <strong>Scripted activity</strong>
          <pre id="demoLog">✓ Loaded fake project metadata
✓ Prepared a fake change plan
· Waiting for demo input</pre>
        </article>
      </section>

      <section class="devmoter-demo-actions">
        <button id="demoRun" type="button">Run scripted demo</button>
        <button id="demoReset" type="button">Reset</button>
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
    state.textContent = "Ready";
    log.textContent = "✓ Loaded fake project metadata\n✓ Prepared a fake change plan\n· Waiting for demo input";
    run.disabled = false;
  };

  run.addEventListener("click", () => {
    resetDemo();
    run.disabled = true;
    state.textContent = "Running";
    log.textContent += "\n● Fake agent is working…";
    timers.push(window.setTimeout(() => {
      state.textContent = "Approval needed";
      log.textContent += "\n! Demo approval requested (nothing will execute)";
    }, 700));
    timers.push(window.setTimeout(() => {
      state.textContent = "Completed";
      log.textContent += "\n✓ Scripted demo completed";
      run.disabled = false;
    }, 1500));
  });

  reset.addEventListener("click", resetDemo);
}
