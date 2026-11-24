PDF IO engine vendored from @devmoter/pdf (devmoter-office, packages/pdf)
https://github.com/syr4wpywkk-collab/devmoter-office
Commit: eef064e (packages/pdf at origin/main)
Copyright DevMoter Calc Engine contributors. Proprietary (see LICENSE).
The original TypeScript sources are retained here under src/. The CLI
(src/cli.ts, src/bin.ts) and addField helpers are not vendored — this track
needs only the library surface used by entry.ts.

Runtime dependencies are NOT bundled (esbuild `packages: "external"`); they are
resolved from DevMoter-FAST's pinned dependencies and are recorded here for
provenance:
- pdf-lib (MIT) — document load/save, page ops, AcroForm, stamps, metadata.
- @pdf-lib/fontkit (MIT) — custom font embedding (draw.ts only).
- pdfjs-dist (Apache-2.0) — text/metadata extraction (extract.ts uses the
  legacy Node build; a browser build is vendored separately in vendor/pdfjs/).

server/office/pdf-model.mjs consumes the generated bundle
(server/office/pdf-engine.mjs, built by scripts/build-pdf-engine.mjs) for
projection and page/form/stamp/metadata operations.
