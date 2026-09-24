export type CodexPluginEntry = {
  id: string;
  name: string;
  marketplace: string;
  installed: boolean;
  enabled: boolean;
};
export function pluginEntries(payload: any): CodexPluginEntry[];
export function pluginNameLooksOpaque(entry: Partial<CodexPluginEntry>): boolean;
export function enrichInstalledPluginEntries(installedEntries: CodexPluginEntry[], catalogEntries: CodexPluginEntry[]): CodexPluginEntry[];
