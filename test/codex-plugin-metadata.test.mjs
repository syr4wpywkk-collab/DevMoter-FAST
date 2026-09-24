import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichInstalledPluginEntries,
  pluginEntries,
  pluginNameLooksOpaque
} from "../src/codex-plugin-metadata.mjs";

test("current Codex PluginSummary interface.displayName is used as the user-facing name", () => {
  const payload = {
    marketplaces: [{
      name: "openai-curated",
      interface: { displayName: "OpenAI Curated" },
      plugins: [{
        id: "linear@openai-curated",
        name: "linear",
        installed: true,
        enabled: true,
        interface: { displayName: "Linear" }
      }]
    }]
  };
  assert.deepEqual(pluginEntries(payload), [{
    id: "linear@openai-curated",
    name: "Linear",
    marketplace: "OpenAI Curated",
    installed: true,
    enabled: true
  }]);
});

test("remote installed compatibility accepts release.display_name", () => {
  const payload = {
    marketplaces: [{
      name: "remote",
      plugins: [{
        id: "remote-only@openai-curated-remote",
        name: "remote-only",
        release: { display_name: "Remote Only" },
        enabled: true
      }]
    }]
  };
  assert.equal(pluginEntries(payload)[0].name, "Remote Only");
});

test("opaque installed names are enriched from plugin/list by stable id", () => {
  const installed = [{
    id: "linear@openai-curated",
    name: "app-linear@openai-curated",
    marketplace: "openai-curated",
    installed: true,
    enabled: true
  }];
  const catalog = [{
    id: "linear@openai-curated",
    name: "Linear",
    marketplace: "OpenAI Curated",
    installed: true,
    enabled: true
  }];

  assert.equal(pluginNameLooksOpaque(installed[0]), true);
  assert.deepEqual(enrichInstalledPluginEntries(installed, catalog), [{
    ...installed[0],
    name: "Linear"
  }]);
});

test("catalog entries with a different id never rename an installed plugin", () => {
  const installed = [{
    id: "opaque@market",
    name: "app-opaque",
    marketplace: "market",
    installed: true,
    enabled: true
  }];
  const catalog = [{
    id: "other@market",
    name: "Other",
    marketplace: "market",
    installed: true,
    enabled: true
  }];
  assert.deepEqual(enrichInstalledPluginEntries(installed, catalog), installed);
});
