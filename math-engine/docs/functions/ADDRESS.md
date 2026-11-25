# ADDRESS

`ADDRESS(row_num, column_num, [abs_num], [a1], [sheet_text])` — returns
the text of a cell reference (e.g. `"$C$3"`) built from numeric row and
column indexes.

## Arguments
- `row_num`: required; row index, integer >= 1. Coerced via the numeric
  coercion rules (text `"3"` -> `3`; blank/boolean per standard scalar
  coercion — blank in a direct argument is `0` -> `#VALUE!` since 0 is
  out of range).
- `column_num`: required; column index, integer >= 1.
- `abs_num`: optional; `1` = absolute `$A$1` (default), `2` = absolute
  row / relative column `A$1`, `3` = relative row / absolute column
  `$A1`, `4` = relative `A1`. Values outside 1–4 -> `#VALUE!`.
- `a1`: optional logical; `TRUE`/omitted = A1 notation, `FALSE` = R1C1
  notation.
- `sheet_text`: optional text; sheet name prepended as
  `'Sheet Name'!$A$1` (quoted when it contains spaces or non-alphanumeric
  characters). A blank/`""` sheet is treated as no sheet prefix (confirm).

## Semantics
- Returns `Text`, not a reference — the result cannot itself be used as
  a range argument without `INDIRECT`.
- Fractional `row_num`/`column_num` are truncated toward zero in Excel
  (confirm — document whether `ADDRESS(3.9,2)` = `$B$3`).
- R1C1 output: `abs_num` selects `R1C1` (1), `R1C[1]` (2: absolute row,
  relative col), `R[1]C1` (3), `R[1]C[1]` (4). Relative offsets are
  relative to the cell containing the formula — **Engine requirement**,
  see below.
- Max column is engine-bounded (Excel: 16384 / `XFD`); out-of-range
  column -> `#VALUE!` (confirm error vs clamp).

## Errors
- `row_num`/`column_num` <= 0 or non-numeric -> `#VALUE!`.
- `abs_num` not in {1,2,3,4} -> `#VALUE!`.
- `a1` non-boolean scalar -> `#VALUE!` (coercion per standard rules).

## Examples
- `ADDRESS(3, 2)` -> `"$B$3"`
- `ADDRESS(3, 2, 2)` -> `"B$3"`
- `ADDRESS(3, 2, 4, FALSE)` -> `"R[3]C[2]"` (offsets relative to the
  calling cell; expected value assumes the formula is in row 1 col 1 —
  **SPEC-OPEN**, offsets are anchored to caller position in Excel).
- `ADDRESS(3, 2, 1, TRUE, "My Sheet")` -> `"'My Sheet'!$B$3"`

## Compatibility notes
- Available since early Excel versions; identical in LibreOffice.
- `sheet_text` quoting rules for names starting with digits or
  containing `'` are **SPEC-OPEN**.

## Engine requirements
- R1C1 relative output and (if implemented) relative-address semantics
  require the *caller's cell position* at evaluation time — beyond plain
  value semantics.
- `sheet_text` does not need a real sheet to exist; it is string
  concatenation only (confirm Excel validates name syntax — believed it
  does not check existence).

## Open questions
- Truncation vs rounding of fractional row/col.
- Behavior when `sheet_text` is `""` or contains `!`.
- Error type for column > max column.
