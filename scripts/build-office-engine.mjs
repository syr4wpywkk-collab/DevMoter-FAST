import { build } from "esbuild";
await build({
  entryPoints: ["vendor/genoffice/entry.ts"],
  outfile: "server/office/engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  alias: {
    "@genoffice/zip-gate": "./vendor/genoffice/zip-gate/index.ts",
    "@genoffice/pptx-engine/custgeom": "./vendor/genoffice/custgeom.ts",
  },
  banner: {
    js: "// Generated from pinned Apache-2.0 GenOffice sources. See vendor/genoffice/NOTICE.md.",
  },
});
