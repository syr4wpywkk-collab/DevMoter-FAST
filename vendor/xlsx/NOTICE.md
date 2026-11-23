XLSX IO engine vendored from @devmoter/xlsx (devmoter-office, packages/xlsx)
https://github.com/syr4wpywkk-collab/devmoter-office
Commit: e0eb0a7 (feat/xlsx-io)
Copyright DevMoter Calc Engine contributors. Proprietary (see LICENSE).
The original TypeScript sources are retained here under src/.

Runtime dependencies are NOT bundled (esbuild `packages: "external"`); they are
resolved from DevMoter-FAST's pinned dependencies and are recorded here for
provenance:
- jszip (MIT) — archive load/save.
- fast-xml-parser (MIT) — XML part parsing.

Only IO code is used: readWorkbook / writeWorkbook and the plain workbook
model. No evaluation; formulas remain strings. server/office/xlsx-model.mjs
consumes this bundle for read-only projection.
