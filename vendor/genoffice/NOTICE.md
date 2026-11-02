DOCX engine and ZIP gate adapted from GenOffice
https://github.com/genspark-ai/genoffice
Commit: e4be545a881eed5b700d5da997aae26e8e24fc82
Copyright GenOffice contributors. Licensed under Apache-2.0 (see LICENSE).

Only open-source engine code is used; no ee/ code, trademarks or application UI.
The original TypeScript sources are retained here. DevMoter's adapter exports
only parsing, preservation-based saving, the blank template and the paragraph-
property helpers (splitXmlChildren, PPR_CHILD_ORDER) used by
server/office/docx-model.mjs to write whole-document edits back to DOCX.
Modification: ZIP limits reduced to 2,000 parts / 16MB per part / 64MB total.
Modification: XML/rels parts containing DTD/entity declarations are rejected.
Modification: field-instruction text uses a linear tag scanner (stripXmlTags) instead of a single-pass regex replace.
Modification: rels DOCTYPE removal uses a linear scanner (stripDoctype) instead of a backtracking regex.
Modification: strict-OOXML / bibliography-namespace / relationship-type checks compare parsed values exactly instead of substring search.
