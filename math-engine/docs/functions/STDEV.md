# STDEV

`STDEV(number1, [number2], ...)` — sample standard deviation
(denominator n-1).

Legacy compatibility function; modern equivalent is `STDEV.S`
(identical semantics — see `STDEV_S.md` for the full spec). Note:
in legacy `STDEV`, direct boolean/text arguments are **counted**
(coerced); in ranges they are ignored — same split as `VAR`/`SUM`.

## Arguments
- `number1`: required; up to 255 scalar/range arguments.

## Coercion
Same split as `SUM`:
- Range args: text, booleans, blanks ignored; errors propagate.
- Direct scalar args: numeric text and booleans coerced;
  non-numeric text -> `#VALUE!`; blank -> 0.

## Semantics / errors
- `sqrt(sum((x - mean)^2) / (n - 1))`; `n < 2` numeric values ->
  `#DIV/0!`.
- Numerical-stability requirement identical to `STDEV_S.md`
  (Welford/two-pass; document measured error).

## Examples
- `STDEV(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)` ->
  `27.46391572` (Microsoft docs example)
- `STDEV(1,2,3)` -> `1`
- `STDEV(5)` -> `#DIV/0!`
- `STDEV("abc")` -> `#VALUE!`

## Open questions
- See `STDEV_S.md` (algorithm choice; all-equal inputs).
