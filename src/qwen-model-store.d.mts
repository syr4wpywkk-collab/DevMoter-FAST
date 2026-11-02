export type QwenModelChoice = { id: string; authType: string; name: string };
export type QwenListedModel = { id: string; name: string; authType: string; group: string; host?: string; description?: string; disabled?: boolean; reason?: string };
export type QwenModelGroup = { id: string; label: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const QWEN_MODEL_KEY: string;
export const QWEN_RECENT_KEY: string;
export function qwenModelKey(model: { authType: string; id: string } | null | undefined): string;
export function loadQwenModel(storage: StorageLike): QwenModelChoice | null;
export function loadRecentQwenModels(storage: StorageLike): QwenModelChoice[];
export function saveQwenModel(storage: StorageLike, choice: QwenModelChoice | null): QwenModelChoice | null;
export function qwenModelChipLabel(choice: QwenModelChoice | null): string;
export function qwenModelSections(
  listing: { groups?: QwenModelGroup[]; models?: QwenListedModel[] },
  options?: { query?: string; group?: string; recent?: QwenModelChoice[] }
): { id: string; label: string; items: QwenListedModel[] }[];
