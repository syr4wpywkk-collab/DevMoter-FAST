export const APP_IDS = [
  "chat",
  "projects",
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
  { id: "chat", title: "Chat", shortDescription: "Open your AI workspace", icon: "✳", category: "Workspace", availability: "available", launchKind: "surface" },
  { id: "projects", title: "Projects", shortDescription: "Browse registered workspaces", icon: "▱", category: "Workspace", availability: "available", launchKind: "feature" },
  { id: "knowledge", title: "Knowledge", shortDescription: "Notes and project knowledge", icon: "▤", category: "Workspace", availability: "preview", launchKind: "placeholder", previewMessage: "Knowledge is not available yet. Its app shell is planned separately." },
  { id: "terminal", title: "Terminal", shortDescription: "Persistent project terminal sessions", icon: "⌘", category: "Development", availability: "available", launchKind: "feature" },
  { id: "git", title: "Git", shortDescription: "Working tree and bounded diff viewer", icon: "⑂", category: "Development", availability: "available", launchKind: "feature" },
  { id: "review", title: "Review", shortDescription: "Changes, worktrees and GitHub task workflow", icon: "⌁", category: "Development", availability: "available", launchKind: "feature" },
  { id: "agents", title: "Agents", shortDescription: "Agent planning and orchestration", icon: "◎", category: "Activity", availability: "available", launchKind: "feature" },
  { id: "sessions", title: "Sessions / Activity", shortDescription: "Activity, queue, checkpoints and handoff", icon: "✦", category: "Activity", availability: "available", launchKind: "feature" },
  { id: "browser", title: "Browser", shortDescription: "Project files, previews and browser automation", icon: "▦", category: "Development", availability: "preview", launchKind: "placeholder", previewMessage: "Browser does not have a separate app surface yet. Open Files & Preview from the sidebar." },
  { id: "automation", title: "Automation", shortDescription: "Schedules, triggers, runs and bounded autopilot", icon: "⏱", category: "Productivity", availability: "available", launchKind: "feature" },
  { id: "developer-workflows", title: "Developer Workflows", shortDescription: "MCP, Skills, Rules, ACP, CI and verification", icon: "◇", category: "Development", availability: "available", launchKind: "feature" }
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
