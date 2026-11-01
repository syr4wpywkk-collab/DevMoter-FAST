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
