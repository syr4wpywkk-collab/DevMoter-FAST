import * as React from "react";
import { createRoot } from "react-dom/client";
import { DEEPSEEK_UI_ENABLED } from "../feature-flags.mjs";
import { t } from "../i18n";

export type ChatBackend = "opencode" | "codex" | "api" | "deepseek";

const WORKSPACES: ReadonlyArray<{ id: ChatBackend; title: string }> = [
  { id: "opencode", title: "OpenCode" },
  { id: "codex", title: "Codex" },
  { id: "api", title: "API Chat" },
  ...(DEEPSEEK_UI_ENABLED ? [{ id: "deepseek", title: "DeepSeek" }] as Array<{ id: ChatBackend; title: string }> : [])
];

type ShortcutsProps = {
  onSelect: (backend: ChatBackend) => void;
};

function BackendShortcuts({ onSelect }: ShortcutsProps) {
  return (
    <nav className="dm-home-quick-switch" aria-label={t("home.backendSwitchAria")}>
      <div className="dm-home-shortcut-grid">
        {WORKSPACES.map(workspace => (
          <button
            className="dm-home-shortcut"
            type="button"
            key={workspace.id}
            onClick={() => onSelect(workspace.id)}
            aria-label={t("home.openBackendAria", { backend: workspace.title })}
          >
            <strong>{workspace.title}</strong>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * React owns only the supplied empty element. The existing Vanilla TS home,
 * session lifetime, auth, SSE and shell navigation remain outside this root.
 */
export function mountHomeBackendShortcuts(
  host: HTMLElement,
  onSelect: (backend: ChatBackend) => void
): () => void {
  const root = createRoot(host);
  root.render(<BackendShortcuts onSelect={onSelect} />);
  return () => root.unmount();
}
