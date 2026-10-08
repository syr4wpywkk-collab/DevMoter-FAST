# Office Docs v1

Office is available from Home and the manual Tools section. The first format is
DOCX; XLSX, PPTX and PDF are subsequent phases, not placeholder apps.

## Architecture and scope

The server owns uploaded documents under the existing private configuration
directory (`office/`). No project file API restrictions are broadened. Documents
have opaque IDs, an immutable original, bounded immutable revisions, and an
atomic metadata pointer. Files are 0600 and directories 0700. Saving requires
the current revision, so an old tab cannot silently overwrite a newer save.
Restore creates a new revision; it never deletes the original or later history.
This store assumes the existing single-owner, single-server private-host model.

The pinned Apache-2.0 GenOffice DOCX engine parses and preserves OOXML. Its source,
license, provenance and modifications are in `vendor/genoffice`. The generated
server bundle is committed so a checkout can run server tests immediately;
`npm run build:office` regenerates it. XML parser dependencies are pinned to a
patched release. No Electron, enterprise code or brand assets are included.

Manual edits replace paragraph text while retaining original run/paragraph XML
where possible. Enter adds paragraphs. Headings, inline formatting, lists, basic
tables and raster images have a preview. Tables, images, fields and other complex
content are preserved rather than regenerated and are not directly editable in
this release. This is **not full Word fidelity**: pagination, advanced numbering,
complex layouts, tracked revisions and printing need a dedicated layout/editor
phase. Strict OOXML may be normalized by the engine when saving edited documents.
Do not use the preview as a claim of exact print layout.

Limits: 12MB compressed document, 2,000 ZIP parts/blocks, 16MB per expanded part,
64MB total expanded package, 100 documents, 50 revisions per document, 100 edits
per save and 16KB text per edited paragraph. DTD/entity declarations are rejected.

## AI editing

Office uses the existing API Chat provider/model configuration and Vault
authorization. It does not add write operations to the read-only Tools AI catalog.
Choose the Vault's project when using a project-bound provider. Explicit sharing
consent is required. Only editable paragraphs are projected to the selected AI:
at most 60 complete paragraphs, 8KB per paragraph and 24KB text total. Suspicious
credential-like contents and known secrets are excluded before truncation.
The UI shows exclusion/truncation notices. Document text is treated as untrusted
data; the model may only propose `{ "edits": [{ "blockId": "...", "text": "..." }] }`.
Every edit is validated against the fixed document revision and supplied IDs.

The model cannot issue commands, URLs, arbitrary tool calls or executable UI.
A proposal does not save anything. Review the before/after text, apply it to the
local draft, then explicitly save. A changed revision rejects the proposal.

Stop aborts the provider HTTP request and prevents a late response from becoming
a proposal. Requesting Stop is distinct from stopped. No remote-provider compute
termination is promised. Closing Office does not delete its run; reopening can
reconnect while the server remains alive. After host restart a missing AI run is
`unknown`, with no automatic resumption. Saved documents/history survive restart.
Local drafts are retained in sessionStorage for that browser tab and revision;
they are not a substitute for saving and are not a permanent server backup.

## Verification and next phases

Unit/integration tests cover preserved parts, first edits, new paragraphs, stale
revision rejection, malformed edits, secret exclusion, ZIP bounds, corrupt metadata,
symlinks, AI Stop, owner/origin gates, the real HTTP provider adapter, downloads,
restore, and restart. Browser verification uses an isolated host and synthetic
DOCX samples; no customer documents or real credentials are used.

Next: rich selection editing and table editing with lossless validation, advanced
numbering/page layout, an interoperability fixture corpus, then XLSX/PPTX/PDF.
Native Codex execution is not connected; provider preparation and proposal
validation are separate so future backends can reuse the same review/save boundary.
