import * as React from "react";
import { createRoot } from "react-dom/client";

export type ChatBackend = "opencode" | "codex" | "api";

const WORKSPACES: ReadonlyArray<{ id: ChatBackend; title: string; hint: string }> = [
  { id: "opencode", title: "OpenCode", hint: "セッション" },
  { id: "codex", title: "Codex", hint: "コードとレビュー" },
  { id: "api", title: "API Chat", hint: "接続済みプロバイダー" }
];

type ShortcutsProps = {
  onSelect: (backend: ChatBackend) => void;
};

function BackendShortcuts({ onSelect }: ShortcutsProps) {
  return (
    <nav className="dm-home-quick-switch" aria-label="チャット環境の切り替え">
      <p className="dm-home-quick-switch-label">CHAT ENVIRONMENTS</p>
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
            <small>{workspace.hint}</small>
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
