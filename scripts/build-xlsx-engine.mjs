import { build } from "esbuild";
await build({
  entryPoints: ["vendor/xlsx/entry.ts"],
  outfile: "server/office/xlsx-engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  banner: {
    js: "// Generated from vendored @devmoter/xlsx sources. See vendor/xlsx/NOTICE.md.",
  },
});
