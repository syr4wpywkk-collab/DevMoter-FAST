# VAR.P

`VAR.P(number1, [number2], ...)` — **population** variance
(`SUM((x-mean)^2)/n`). Excel 2010+; legacy `VARP`. Sample version:
`VAR.S` (see `VAR_S.md`).

## Arguments & coercion
- `number1` required; up to 255. Same coercion as `VAR.S`: range
  text/boolean/blank ignored; direct scalars coerce; non-numeric
  direct text -> `#VALUE!`; error cells propagate.

## Semantics
- `n = 1` -> `0`; `n = 0` (no numeric values) -> `#DIV/0!`.
- `VAR.P = STDEV.P^2` — shared accumulation (Welford/two-pass,
  plan §6 Phase 5).

## Errors
- No numeric values -> `#DIV/0!`; errors propagate.

## Examples
- `VAR.P({1345;1301;1368;1322;1310;1370;1318;1350;1303;1299})` ->
  `678.84` (Excel doc example `678.84`).
- `VAR.P({1;2;3})` -> `0.6666667` (2/3).
- `VAR.P(5)` -> `0`.
- `VAR.P(A1:A3)` all text -> `#DIV/0!`.

## Open questions
- Accumulation-order tolerance vs Excel.
