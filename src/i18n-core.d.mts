export type DevMoterLanguage = "ja" | "en" | "zh";
export type TranslationParams = Record<string, string | number | boolean | null | undefined>;
export type LocaleTag = "ja-JP" | "en-US" | "zh-CN";

export const STORAGE_KEY: string;
export const SUPPORTED_LANGUAGES: readonly DevMoterLanguage[];
export const DICTIONARIES: Readonly<Record<DevMoterLanguage, Readonly<Record<string, string>>>>;

export function normalizeLanguage(value: unknown): DevMoterLanguage | null;
export function detectBrowserLanguage(nav?: Navigator | null): DevMoterLanguage;
export function resolveLanguage(value?: unknown): DevMoterLanguage;
export function getLanguage(): DevMoterLanguage;
export function localeTag(language?: unknown): LocaleTag;
export function speechRecognitionLanguage(language?: unknown): LocaleTag;
export function applyDocumentLocale(language?: unknown, doc?: Document | null): DevMoterLanguage;
export function syncLanguageSelectors(root?: ParentNode | null, language?: unknown): void;
export function ensureSelectOptions(select: HTMLSelectElement): void;
export function onLanguageChange(listener: (language: DevMoterLanguage) => void): () => void;
export function setLanguage(language: unknown, options?: { reload?: boolean }): DevMoterLanguage;
export function interpolate(template: string, params?: TranslationParams): string;
export function translate(language: unknown, key: string, params?: TranslationParams): string;
export function t(key: string, params?: TranslationParams): string;
export function formatDateTime(
  value: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
  language?: unknown
): string;
export function formatTime(
  value: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
  language?: unknown
): string;
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  language?: unknown
): string;
export function formatRelativeTime(
  timestamp: number,
  now?: number,
  language?: unknown
): string;
export function translateServerMessage(raw: string, language?: unknown): string;
export function tApp(
  appId: string,
  field?: "title" | "shortDescription" | "previewMessage",
  language?: unknown
): string;
export function bindLanguageSelectors(root?: ParentNode | null, options?: { reload?: boolean }): void;
export function startI18n(options?: { reload?: boolean }): DevMoterLanguage;
