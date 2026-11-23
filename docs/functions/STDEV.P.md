# STDEV.P

`STDEV.P(number1, [number2], ...)` — **population** standard deviation
(divide by n). Excel 2010+; legacy `STDEVP`. Sample version: `STDEV.S`
(see `STDEV_S.md`).

## Arguments
- `number1`: required; range/array/scalar; up to 255 args.

## Coercion
- Range/array cells: text, booleans, blanks ignored (same as
  `STDEV.S`). Direct scalars: numeric text and booleans coerce;
  non-numeric text -> `#VALUE!`. Error cells propagate.

## Semantics
- `sqrt( SUM((x_i - mean)^2) / n )` over `n` numeric values.
- `n = 1` -> `0` (valid — unlike `STDEV.S` which gives `#DIV/0!`).
- `n = 0` (no numeric values) -> `#DIV/0!`.
- Implement with a numerically stable two-pass or Welford
  accumulation (plan §6 Phase 5).

## Errors
- No numeric values -> `#DIV/0!`.
- Non-numeric direct arg -> `#VALUE!`.
- Errors propagate.

## Examples
- `STDEV.P({1345;1301;1368;1322;1310;1370;1318;1350;1303;1299})` ->
  `26.0545` (Excel doc example `26.05455814` vs STDEV.S `27.4639`).
- `STDEV.P(5)` -> `0`.
- `STDEV.P({1;2;3})` -> `0.8164965809` (sqrt(2/3)).
- `STDEV.P(A1:A3)` all blank/text -> `#DIV/0!`.

## Open questions
- Tolerance vs Excel's accumulation order (two-pass expected).
