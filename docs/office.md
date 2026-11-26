# Office Docs v1

Office is available from Home and the manual Tools section. Documents are
classified at ingest into `docx`, `pptx`, `pdf` or `excel` (from `.docx`,
`.pptx`, `.pdf`, `.xlsx`), decided by extension plus a content sniff; mismatches
are rejected. Every library record carries a `format` field — records stored
before classification read as `docx` without rewriting stored metadata. The
library can filter by format.

## Feature matrix

| Capability | DOCX | PPTX | PDF | Excel (.xlsx) |
|---|---|---|---|---|
| Store / list / rename / download / restore | ✓ | ✓ | ✓ | ✓ |
| Read projection | blocks (paragraphs, headings, lists, tables, images) | slide outline (texts, tables, notes) | pages, metadata, extracted text, form fields | sheets + cells (calc-computed values) |
| Manual edit | block editor (text, structure, links) | outline ops: replaceText, add/duplicate/move/remove slide, theme normalize | page ops: rotate/extract/delete/reorder, form fill, stamp, metadata | grid cell edits (typed: text/number/bool/formula) |
| AI edit proposals | paragraph text edits | replaceText ops | — (body text is final) | cell edits |
| AI structure proposals | shape (heading/list/align) | theme normalization | metadata + stamps only | — |
| AI Q&A | ✓ | ✓ | ✓ | ✓ |
| AI generation ("Create with AI") | spec → .docx | DeckPlan → .pptx | spec → drawn-text .pdf | workbook spec → .xlsx |

Body text of a PDF is never edited in place — PDF is a final-form format;
all edits are page/form/stamp/metadata ops producing new revisions.

## Architecture and scope

The server owns uploaded documents under the existing private configuration
directory (`office/`). No project file API restrictions are broadened. Documents
have opaque IDs, an immutable original, bounded immutable revisions, and an
atomic metadata pointer. Files are 0600 and directories 0700. Saving requires
the current revision, so an old tab cannot silently overwrite a newer save.
Restore creates a new revision; it never deletes the original or later history.
This store assumes the existing single-owner, single-server private-host model.

## Vendored components

Generated engine bundles in `server/office/` are built from `vendor/` sources
by `npm run build:office`; they are committed so a checkout runs tests
immediately and are never edited by hand.

| Component | Source | License | Used for |
|---|---|---|---|
| `vendor/genoffice` | GenOffice (genspark-ai/genoffice, pinned commit) | Apache-2.0 | DOCX parse/preserve/save (`engine.mjs`) |
| `vendor/xlsx` | @devmoter/xlsx (devmoter-office) | Proprietary (see LICENSE) | XLSX read/write (`xlsx-engine.mjs`) |
| `vendor/pptx` | @devmoter/pptx (devmoter-office) | Proprietary | PPTX outline/render (`pptx-engine.mjs`) |
| `vendor/pdf` | @devmoter/pdf (devmoter-office) | Proprietary | PDF ops + createDocument draw (`pdf-engine.mjs`) |
| `vendor/calc-wasm` | rust-math-engine calc-wasm | Proprietary | XLSX formula recalculation (`calc-engine.mjs`) |
| `vendor/pdfjs` | pdf.js browser build | Apache-2.0 | PDF viewer rendering |

Runtime dependencies resolved from pinned package.json: jszip (MIT),
fast-xml-parser (MIT), pptxgenjs (MIT), pdf-lib (MIT), @pdf-lib/fontkit (MIT),
pdfjs-dist (Apache-2.0). See each `vendor/*/NOTICE.md` for provenance and
modifications (the GenOffice adapter tightens ZIP limits and rejects DTD/entity
declarations).

## Editing notes

Manual DOCX edits replace paragraph text while retaining original run/paragraph
XML where possible. Enter adds paragraphs. Tables, images, fields and other
complex content are preserved rather than regenerated. This is **not full Word
fidelity**: pagination, advanced numbering, complex layouts, tracked revisions
and printing need a dedicated layout/editor phase.

PPTX editing is an outline-level surface: text replacement, slide ops and
theme normalization. Applying a theme rebuilds the deck from its text outline;
images, charts and the original design are lost (the UI warns before apply).

XLSX edits are typed cell contents serialized back over the original package
bytes so styles and unrelated parts survive; formulas are recalculated by the
vendored calc engine when it can run the workbook, otherwise stored cached
values are shown with a stale-data warning.

Limits: 12MB compressed document, 2,000 ZIP parts/blocks, 16MB per expanded
part, 64MB total expanded package, 100 documents, 50 revisions per document,
100 edits per save and 16KB text per edited paragraph. DTD/entity declarations
are rejected.

## AI boundary

Office uses the existing API Chat provider/model configuration and Vault
authorization. It does not add write operations to the read-only Tools AI
catalog. Explicit sharing consent is required for every run. Only the
projected shareable text goes to the selected AI (at most 60 items, 8KB each,
24KB total; 200 cells for workbooks). Workbook sharing additionally bounds the
serialized document-data envelope (including cell addresses, sheet names,
formulas and JSON overhead) to 24KB. Sheet names and addresses are subject to
the same content exclusion policy; edit proposals are limited to shared sheets.
Suspicious credential-like contents and known secrets are excluded before
truncation; the UI shows exclusion/truncation notices. Document text and
metadata are treated as untrusted data. These checks are defense in depth, not
a guarantee that all sensitive content can be detected.

The model may only return validated proposals: `{edits:[{blockId,text}]}` for
DOCX, `{ops:[replaceText]}` or theme fields for PPTX, `{edits:[{cell,text}]}`
for XLSX, and metadata/stamp ops for PDF. Every proposal is validated against
the fixed document revision and supplied IDs; a changed revision rejects it.
The model cannot issue commands, URLs, arbitrary tool calls or executable UI.
A proposal does not save anything — the user reviews before/after and applies
through the normal save paths.

Generation ("Create with AI" in the library) produces a validated spec
(document outline for DOCX/PDF, DeckPlan for PPTX, workbook spec for XLSX),
renders bytes with the vendored engines, and stores a brand-new document
through the normal ingest path. Existing documents are never touched.
PDF generation draws text with the standard Latin font — CJK/other
non-WinAnsi text fails the whole run rather than writing a partial file.

Stop aborts the provider HTTP request and prevents a late response from
becoming a proposal. Closing Office does not delete a run; reopening can
reconnect while the server remains alive. After host restart a missing run is
`unknown`. Saved documents/history survive restart. Local drafts live in
sessionStorage for that tab and revision; they are not a substitute for
saving.

## Verification and limitations

Unit/integration tests cover: per-format end-to-end (ingest → project →
AI-propose with a stubbed model → apply → save → re-project), generation for
all four formats, malformed-spec rejection, preserved parts, stale revision
rejection, secret exclusion, ZIP bounds, corrupt metadata, symlinks, AI Stop,
owner/origin gates, downloads, restore, restart, and the four-format
classification filter. Browser verification uses synthetic documents only.

Remaining limitations: PPTX is outline-level (no image/chart editing; theme
apply rebuilds the deck); PDF body text cannot be edited (page/form/stamp/
metadata ops only) and PDF generation is Latin-script only; XLSX editing is
cell-level (no styling, charts or sheet add/remove); DOCX is not print
fidelity. Native Codex execution is not connected; provider preparation and
proposal validation are separate so future backends can reuse the same
review/save boundary.
