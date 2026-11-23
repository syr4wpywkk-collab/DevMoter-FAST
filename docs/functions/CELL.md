# CELL

`CELL(info_type, [reference])` — returns formatting, location, or
content information about a cell.

v3 expansion (track S10). Legacy macro-era function; many
`info_type` values depend on workbook metadata this engine may not
model.

## Engine requirements
- Requires cell metadata beyond the value model: column width,
  number format strings, protection/lock state, text prefix/alignment,
  file path, and the "current cell" notion for the two-argument
  default. Without a formatting layer, only a subset (`address`,
  `col`, `row`, `contents`, `type`, and possibly `filename`) is
  implementable. Unimplementable info_types should return a defined
  error rather than guessed values.

## Arguments
- `info_type`: required text, case-insensitive. Documented values:
  `"address"`, `"col"`, `"color"`, `"contents"`, `"coord"`,
  `"filename"`, `"format"`, `"parentheses"`, `"prefix"`, `"protect"`,
  `"row"`, `"type"`, `"width"`.
- `reference`: optional cell. If omitted, applies to the *last cell
  changed* (volatile, interactive-Excel concept) — in a headless
  engine this default is likely meaningless; **open question** whether
  to require the argument.
  - If `reference` is a range, Excel uses the top-left cell (confirm).
  - If `reference` is omitted under dynamic-array Excel, `CELL` may
    return an array over the *selected* range — not applicable
    headless.

## info_type semantics (documented)
- `"address"`: absolute `$A$1` text incl. sheet for external refs —
  `$A$1` or `'Sheet1'!$A$1`? (Excel returns e.g. `"$A$1"` without sheet
  for same-workbook — confirm).
- `"col"`, `"row"`: 1-based column/row numbers.
- `"contents"`: the cell's *value* (not formula).
- `"type"`: `"b"` blank, `"l"` label (text constant), `"v"` value
  (anything else).
- `"filename"`: `"path[sheet]"` text of the containing file; empty
  `""` if the workbook was never saved — engine has no file path
  concept -> likely always `""` or a defined result (open question).
- `"color"`: `1` if cell is formatted for color negative values, else
  `0` — format-layer dependent.
- `"format"`: number-format code mapped to legacy tokens (`G`,`F0`,
  `,0`,`C2`,`D1`..`D9`,`S2`,`P0`..`.0-`, etc.) — requires a format
  table; large and locale-sensitive, flag as engine req.
- `"parentheses"`: `1` if formatted with parens for positive/all
  values else `0`.
- `"prefix"`: quote-style prefix char `'` `"` `^` `\` by alignment, `""`
  if no label — alignment metadata.
- `"protect"`: `1` locked / `0` unlocked — protection metadata.
- `"width"`: column width array `{width, isDefault}` in modern Excel —
  metadata dependent.
- `"coord"`: legacy absolute-with-sheet token `$A:$A$1`-ish; mostly
  obsolete — confirm value.

## Errors
- Unknown `info_type` -> `#VALUE!`.
- `reference` not a reference -> `#VALUE!` (confirm).
- Volatile: recalcs on sheet change in Excel — mark volatile only if
  the formatting model makes results mutable.

## Examples
- `=CELL("row",B7)` -> `7`
- `=CELL("col",B7)` -> `2`
- `=CELL("type",A1)` (A1 = `"x"`) -> `"l"`
- `=CELL("type",A1)` (A1 empty) -> `"b"`
- `=CELL("address",C3)` -> `"$C$3"` (confirm exact form)

## Open questions
- Which info_type subset to implement; others -> defined error vs
  `#N/A`.
- Omitted-`reference` semantics in a headless engine.
- Range `reference`: top-left vs array return.
- `"filename"` result with no persistence layer.
