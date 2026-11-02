export const APP_IDS = [
  "chat",
  "office",
  "projects",
  "mission-control",
  "knowledge",
  "terminal",
  "git",
  "review",
  "agents",
  "sessions",
  "browser",
  "automation",
  "developer-workflows"
] as const;

export type AppId = (typeof APP_IDS)[number];
export type AppAvailability = "available" | "preview" | "unavailable";
export type AppLaunchKind = "surface" | "feature" | "placeholder";

export type AppDefinition = Readonly<{
  id: AppId;
  title: string;
  shortDescription: string;
  icon: string;
  category: "Workspace" | "Development" | "Activity" | "Productivity";
  availability: AppAvailability;
  launchKind: AppLaunchKind;
  previewMessage?: string;
}>;

// Identity and presentation only. Launch behavior stays in code-owned handlers.
const APP_DEFINITIONS: AppDefinition[] = [
  { id: "office", title: "Office", shortDescription: "DOCX editing, original files and AI proposals", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>', category: "Productivity", availability: "available", launchKind: "feature" },
  { id: "chat", title: "Chat", shortDescription: "Codex, OpenCode and API conversations", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z"/></svg>', category: "Workspace", availability: "available", launchKind: "surface" },
  { id: "projects", title: "Projects", shortDescription: "Browse registered workspaces", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>', category: "Workspace", availability: "available", launchKind: "feature" },
  { id: "mission-control", title: "Mission Control", shortDescription: "Agents, sessions, host and projects at a glance", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/></svg>', category: "Activity", availability: "available", launchKind: "feature" },
  { id: "knowledge", title: "Knowledge", shortDescription: "Notes and project knowledge", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 21V5M19 19v2H6"/></svg>', category: "Workspace", availability: "preview", launchKind: "placeholder", previewMessage: "Knowledge is not available yet. Its app shell is planned separately." },
  { id: "terminal", title: "Terminal", shortDescription: "Persistent project terminal sessions", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/></svg>', category: "Development", availability: "available", launchKind: "feature" },
  { id: "git", title: "Git", shortDescription: "Working tree and bounded diff viewer", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10a6 6 0 0 1-6 6H6"/></svg>', category: "Development", availability: "available", launchKind: "feature" },
  { id: "review", title: "Review", shortDescription: "Changes, worktrees and GitHub task workflow", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>', category: "Development", availability: "available", launchKind: "feature" },
  { id: "agents", title: "Agents", shortDescription: "Agent planning and orchestration", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>', category: "Activity", availability: "available", launchKind: "feature" },
  { id: "sessions", title: "Sessions / Activity", shortDescription: "Activity, queue, checkpoints and handoff", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>', category: "Activity", availability: "available", launchKind: "feature" },
  { id: "browser", title: "Browser", shortDescription: "Project files, previews and browser automation", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>', category: "Development", availability: "preview", launchKind: "placeholder", previewMessage: "Browser does not have a separate app surface yet. Open Files & Preview from the sidebar." },
  { id: "automation", title: "Automation", shortDescription: "Schedules, triggers, runs and bounded autopilot", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>', category: "Productivity", availability: "available", launchKind: "feature" },
  { id: "developer-workflows", title: "Developer Workflows", shortDescription: "MCP, Skills, Rules, ACP, CI and verification", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v4a2 2 0 0 0 2 2h7"/></svg>', category: "Development", availability: "available", launchKind: "feature" }
];

// Line icons for system commands (Settings rows, the ☰ menu, file lists): same
// 24px grid as the App icons above; CSS draws them with a 1.5 stroke in the text
// color. Modules that tests load standalone (settings.ts, unified-workspace-nav.ts,
// advanced.ts) inline exact copies; test/line-icons.test.mjs keeps every copy identical.
export const SYSTEM_ICONS = Object.freeze({
  "home": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/></svg>',
  "tools": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18"/></svg>',
  "settings": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  "theme": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 8h5M12 12h6M12 16h5"/></svg>',
  "context": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
  "checkpoint": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  "extensions": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4Z"/></svg>',
  "language": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 4-3 7-7 8"/><path d="m13 21 4-9 4 9M14.5 18h5"/></svg>',
  "notifications": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/></svg>',
  "logout": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M9 12h11M16 8l4 4-4 4"/></svg>',
  "passkey": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>',
  "device": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>',
  "vault": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  "hosts": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/></svg>',
  "index": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M13 3v5h6v3M13 3l6 5"/><circle cx="16" cy="17" r="3"/><path d="m18.2 19.2 2.3 2.3"/></svg>',
  "safety": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/></svg>',
  "diagnostics": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/></svg>',
  "guide": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c-2-2-5-2-8-2v13c3 0 6 0 8 2 2-2 5-2 8-2V5c-3 0-6 0-8 2Z"/><path d="M12 7v13"/></svg>',
  "external": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  "report": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  "system": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/></svg>',
  "light": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
  "dark": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  "density-comfortable": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="6" rx="1.5"/><rect x="4" y="13" width="16" height="6" rx="1.5"/></svg>',
  "density-compact": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>',
  "check": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  "file": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>',
  "plus": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  "send": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  "stop": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  "trash": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  "history": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
} as const);
export type SystemIconId = keyof typeof SYSTEM_ICONS;

export const APP_REGISTRY: readonly AppDefinition[] = Object.freeze(APP_DEFINITIONS.map(entry => Object.freeze(entry)));

const appById = new Map<AppId, AppDefinition>(APP_REGISTRY.map(app => [app.id, app]));

export function isAppId(value: unknown): value is AppId {
  return typeof value === "string" && APP_IDS.some(id => id === value);
}

export function getAppDefinition(id: AppId): AppDefinition {
  return appById.get(id)!;
}

export function getAppsByIds(ids: readonly AppId[]): AppDefinition[] {
  return ids.map(getAppDefinition);
}
