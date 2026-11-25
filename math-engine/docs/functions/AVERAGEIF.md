# AVERAGEIF

`AVERAGEIF(range, criteria, [average_range])` — arithmetic mean of cells
in `average_range` (or `range` itself) whose corresponding `range`
cells match `criteria`.

## Arguments
- `range`: required; range evaluated against `criteria`. Cells in
  `range` that are blank or text are ignored for matching numbers.
- `criteria`: required; see criteria grammar below.
- `average_range`: optional; defaults to `range`. May differ in
  size/shape — Excel anchors at the top-left cell and uses only as
  many cells as needed (**confirm**; documented `SUMIF`-style
  resizing).

## Criteria grammar
Identical to `SUMIF` (see `SUMIF.md`): operator prefixes `=` `<>` `>`
`>=` `<` `<=`, numeric coercion of the operand, wildcards `*` `?` `~`,
case-insensitive text, cell-reference criteria.

## Semantics
- Only positions where `range` matches contribute to the average.
- If `average_range` is omitted, numeric cells of `range` itself are
  averaged.
- Blank or text cells in `average_range` at matching positions are
  ignored (not counted) — **confirm**.

## Errors
- No matching cells, or matching positions contain no numbers ->
  `#DIV/0!` (differs from `SUMIF`'s `0`).
- `criteria` evaluating to an error propagates.
- `average_range` non-range argument -> behavior **SPEC-OPEN**.

## Examples
- `AVERAGEIF({1,2,3,4},">2")` -> `3.5`
- `AVERAGEIF(A1:A4,"x",B1:B4)` with A={x,y,x,y}, B={10,20,30,40} -> `20`
- `AVERAGEIF({1,2,3},">10")` -> `#DIV/0!`
- `AVERAGEIF({"a","b"},"a",5)` with scalar average target — invalid;
  flag arity/shape handling.

## Compatibility
- Excel 2007+. Wildcard and operator semantics match `SUMIF`/`COUNTIF`.

## Open questions
- `average_range` resizing/anchoring rules (same as `SUMIF`).
- Whether `"*"` matches text cells only (expected yes).
- Error cells inside `range`: propagate vs skip.
