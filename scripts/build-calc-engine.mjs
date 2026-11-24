import { build } from "esbuild";
await build({
  entryPoints: ["vendor/calc-wasm/entry.ts"],
  outfile: "server/office/calc-engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  loader: { ".wasm": "binary" },
  banner: {
    js: "// Generated from vendored rust-math-engine calc-wasm artifacts. See vendor/calc-wasm/NOTICE.md.",
  },
});
