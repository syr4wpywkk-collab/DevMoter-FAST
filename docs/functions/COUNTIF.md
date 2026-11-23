# COUNTIF

`COUNTIF(range, criteria)` — counts cells in `range` matching `criteria`.

## Arguments
- `range`: required. `criteria`: required (number, text, boolean, or
  cell reference — same grammar as `SUMIF`).

## Criteria grammar
Identical to `SUMIF.md`: `[operator] operand` with
`=` `<>` `>` `>=` `<` `<=`, numeric coercion of operands, wildcards
`*` `?` `~` for text, case-insensitive matching, cell-reference criteria
parsed with the same rules.

## Semantics
- Returns a non-negative integer count (0 when nothing matches).
- Blank cells: `"="` or `""` criteria count blanks in Excel;
  `"<>"` counts non-blanks (**SPEC-OPEN**: exact blank rules, incl.
  whether `COUNTIF(range,"")` counts empty strings AND blanks).
- Error cells inside `range`: whether they propagate or are simply
  non-matching is **SPEC-OPEN** (Excel appears to skip them; confirm).

## Errors
- Error in the `criteria` argument itself propagates.
- `range` being a scalar/direct array — allowed per general arg rules.

## Edge cases
- `COUNTIF(A1:A3,"5")` matches numeric cells equal to 5 even though the
  criterion is text.
- `"??"` requires exactly two characters.
- `~*`/`~?`/`~~` match the literal characters.

## Confirm against reference
- Blank/empty-string counting rules.
- Error-cell skip vs propagate.
- Whether numeric-looking *text cells* (`"5"` stored as text) match the
  criterion `5` (expected: no — type matters).
