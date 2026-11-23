# SUMIF

`SUMIF(range, criteria, [sum_range])` — sums the cells in `range` that
match `criteria`; when `sum_range` is given, sums the corresponding cells
of `sum_range` for the positions where `range` matches.

## Arguments
- `range`: range (or array) evaluated against `criteria`. Required.
- `criteria`: number, text, boolean, or cell reference. Required.
- `sum_range`: optional. When omitted, `range` itself is summed.

## Criteria grammar
A text criterion is parsed as `[operator] operand`:

| Prefix | Meaning |
|---|---|
| (none) or `=` | equality |
| `<>` | not equal |
| `>` `>=` `<` `<=` | ordered comparison |

- The operand after an operator is coerced: numeric-looking text
  (`"5"`, `"-2.5"`) compares numerically; otherwise it compares as text.
- Text comparisons are **case-insensitive** (`"APPLE"` matches `"apple"`).
- Text operands support wildcards: `*` (any run of chars), `?` (one char),
  and `~` escapes the next char as literal (`"~*"` matches a literal `*`).
- A **cell reference** criterion (`SUMIF(A1:A3,B1)`) uses that cell's
  value directly; a text cell's content is parsed with the same grammar
  (a cell containing `>5` means "greater than 5").
- A plain number/boolean argument (`SUMIF(A1:A3,2)`) means equality on
  that value; no string parsing applies.

## `sum_range` shape rule
Excel resizes `sum_range` to the dimensions of `range`, anchored at the
`sum_range` top-left cell (documented behavior). `SUMIF(A1:A3,">1",B1)`
therefore sums `B2:B3` positions 2–3, i.e. uses `B1:B3`.

## Type coercion
- Text and boolean cells in `range` are compared with the same grammar;
  numeric comparisons (`">5"`) do not match text cells.
- Blank cells in `range` match `"="` / `""` / `"<>"` per the grammar
  (**SPEC-OPEN**: exact blank-matching rules for `"="` vs `""` vs `"<>"`).

## Errors
- Error cells in `sum_range` at matched positions propagate.
- Whether an error cell *inside `range`* propagates or is skipped is
  **SPEC-OPEN**.
- `criteria` being an error value propagates.

## Edge cases
- Zero matches -> `0`.
- `sum_range` partially outside the grid -> `#REF!` after resizing?
  (**SPEC-OPEN**)
- Range larger than `sum_range` when `sum_range` is anchored mid-sheet
  clips silently in Excel (resizing rule above).

## Confirm against reference
- Blank-matching criteria (`"="`, `""`, `"<>"`).
- Error cell inside the criteria range: propagate vs skip.
- Whether `"5"` as text criteria operand matches the *text* value `"5"`
  in cells (expected yes — text operands match both, per Excel).
- Case sensitivity of `~`-escaped wildcards (expected insensitive).
