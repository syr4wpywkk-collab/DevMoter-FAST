# STDEVP

`STDEVP(number1, [number2], ...)` — population standard deviation
(denominator n, biased estimator).

Legacy compatibility function; modern equivalent is `STDEV.P`.
Distinct from `STDEVPA` (which counts text/booleans inside
ranges — different function).

## Arguments
- `number1`: required; up to 255 scalar/range arguments.

## Coercion
Same split as `SUM`/`STDEV`:
- Range args: text, booleans, blanks ignored; errors propagate.
- Direct scalar args: numeric text and booleans coerced;
  non-numeric text -> `#VALUE!`.

## Semantics / errors
- `sqrt(sum((x - mean)^2) / n)` over n numeric values.
- `n = 0` numeric values -> `#DIV/0!`. (`n = 1` returns `0`.)

## Examples
- `STDEVP(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)` ->
  `26.05455814` (Microsoft docs example)
- `STDEVP(1,2,3)` -> `0.816496581` (`sqrt(2/3)`)
- `STDEVP(5)` -> `0`
- `STDEVP(A1:A10)` on an empty range -> `#DIV/0!`

## Open questions
- Whether a single **empty-range-only** call is arity error or
  `#DIV/0!` (expected `#DIV/0!` — confirm).
