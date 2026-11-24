import { build } from "esbuild";
await build({
  entryPoints: ["vendor/pptx/entry.ts"],
  outfile: "server/office/pptx-engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  banner: {
    js: "// Generated from vendored @devmoter/pptx sources. See vendor/pptx/NOTICE.md.",
  },
});
