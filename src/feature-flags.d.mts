import type { MainSurface } from "./surface-navigation.mjs";

export const QWEN_UI_ENABLED: boolean;
export type ChatBackend = "codex" | "opencode" | "api" | "qwen";
export const DEFAULT_VISIBLE_BACKEND: "opencode";
export const VISIBLE_CHAT_BACKENDS: readonly ChatBackend[];
export function isVisibleChatBackend(value: unknown): value is ChatBackend;
export function normalizeVisibleBackend(value: unknown, fallback?: ChatBackend): ChatBackend;
export function isHiddenQwenTarget(value: unknown): boolean;
export function normalizeVisibleSurface(value: unknown, fallback?: MainSurface): MainSurface;
export function isVisibleIntegration(id: unknown): boolean;
