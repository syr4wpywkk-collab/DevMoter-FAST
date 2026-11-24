import { build } from "esbuild";
await build({
  entryPoints: ["vendor/pdf/entry.ts"],
  outfile: "server/office/pdf-engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  banner: {
    js: "// Generated from vendored @devmoter/pdf sources. See vendor/pdf/NOTICE.md.",
  },
});
