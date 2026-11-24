PPTX engine vendored from @devmoter/pptx (devmoter-office, packages/pptx)
https://github.com/syr4wpywkk-collab/devmoter-office
Commit: 2124fab (feat/pptx-gen-ext)
Copyright DevMoter Calc Engine contributors. Proprietary (see LICENSE).
The original TypeScript sources are retained here under src/.

Runtime dependencies are NOT bundled (esbuild `packages: "external"`); they are
resolved from DevMoter-FAST's pinned dependencies and are recorded here for
provenance:
- jszip (MIT) — archive load/save.
- fast-xml-parser (MIT) — XML part parsing.
- pptxgenjs (MIT) — deck rendering for generation/shaping.

server/office/pptx-model.mjs consumes this bundle for the outline projection
and slide editing operations; server/office/ai.mjs consumes the DeckPlan
schema/renderer for prompt-driven deck generation inside the existing
AI proposal boundary.
