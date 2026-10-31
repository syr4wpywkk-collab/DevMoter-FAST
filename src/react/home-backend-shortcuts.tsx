import * as React from "react";
import { createRoot } from "react-dom/client";

export type ChatBackend = "opencode" | "codex" | "api";

const WORKSPACES: ReadonlyArray<{ id: ChatBackend; title: string }> = [
  { id: "opencode", title: "OpenCode" },
  { id: "codex", title: "Codex" },
  { id: "api", title: "API Chat" }
];

type ShortcutsProps = {
  onSelect: (backend: ChatBackend) => void;
};

function BackendShortcuts({ onSelect }: ShortcutsProps) {
  return (
    <nav className="dm-home-quick-switch" aria-label="チャット環境の切り替え">
      <div className="dm-home-shortcut-grid">
        {WORKSPACES.map(workspace => (
          <button
            className="dm-home-shortcut"
            type="button"
            key={workspace.id}
            onClick={() => onSelect(workspace.id)}
            aria-label={`${workspace.title}のワークスペースを開く`}
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
