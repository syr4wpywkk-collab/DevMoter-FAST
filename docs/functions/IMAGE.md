# IMAGE

`IMAGE(source, [alt_text], [sizing], [height], [width], [clipX], [clipY], [clipHeight], [clipWidth])` — inserts an image into a cell from a URL. The cell's logical value is `#VALUE!`-adjacent/display-only; the image is a cell decoration.

## Arguments
- `source`: required; URL text of the image (must be `https://` —
  Excel rejects other schemes and local file paths).
- `alt_text`: optional; alternative text for accessibility.
- `sizing`: optional; `0` fit cell keeping aspect (default), `1` fill
  cell ignoring aspect, `2` original size, `3` custom size (uses
  `height`/`width` in pixels).
- `height`, `width`: optional; pixels, only when `sizing` = 3.
- `clipX`, `clipY`, `clipHeight`, `clipWidth`: optional; crop
  coordinates in pixels applied before sizing.

## Semantics
- Evaluation requires a network fetch; the *cell value* in Excel is
  the image itself (it does not participate in arithmetic — using it
  in math yields `#VALUE!`? confirm). `ISBLANK`-style tests on an
  image cell: treated as non-blank (confirm).
- Fetch failure -> cell shows an error icon/`#BUSY!`-style transient
  state, then `#VALUE!`? — **SPEC-OPEN**; Excel displays a broken
  image glyph rather than a formula error in most cases.

## Errors
- Non-text or non-URL `source` -> `#VALUE!` (confirm).
- `sizing` outside 0–3 -> `#VALUE!`.
- `sizing` = 3 without `height`/`width` -> `#VALUE!` (confirm).
- Unreachable URL / non-image content -> display glyph, not a
  formula error (confirm).

## Examples
- `IMAGE("https://example.com/pic.png")` -> embedded image cell
- `IMAGE("https://example.com/pic.png", "logo", 0)` -> fitted image
  with alt text
- `IMAGE("https://example.com/pic.png", "", 3, 32, 32)` -> 32x32
  custom-sized image
- `IMAGE("not-a-url")` -> `#VALUE!` (confirm)

## Engine requirements / implementability
- **NOT IMPLEMENTABLE OFFLINE** for real rendering — requires network
  access to fetch `source`. A conforming offline implementation may:
  (a) return `#VALUE!`/`#N/A` for all inputs, or (b) store the URL as
  cell metadata and produce a placeholder value. Must be declared in
  engine docs.

## Compatibility notes
- Excel 365 (2023+). Requires `https://` sources.

## Open questions
- Exact value semantics of an image cell in arithmetic/`IS*` tests.
- Whether failed fetches surface as a formula error or a UI glyph.
- Whether data URIs or `http://` are accepted on current builds.
