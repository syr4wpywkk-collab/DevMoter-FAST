Real DOCX fixtures for the Office/Docs round-trip tests (test/office-docx-roundtrip.test.mjs).

- `word-report.docx` — written by python-docx 1.2.0 (Word's default template): header part,
  Heading 1/2, bold/italic/underline runs, a coloured 14pt run, a centred paragraph,
  "List Bullet"/"List Number" style lists, a table.
- `pandoc-minutes.docx` — written by pandoc from Markdown: heading bookmarks, inline
  bold/italic, an external hyperlink, numbering.xml lists (numId 1001/1002), a table.
- `word-sections.docx` — written by python-docx: two sections (a paragraph carrying w:sectPr).
