# VARP

`VARP(number1, [number2], ...)` — population variance
(denominator n, biased).

Legacy compatibility function; modern equivalent is `VAR.P`.
Distinct from `VARPA` (counts text/booleans in ranges).

## Arguments
- `number1`: required; up to 255 scalar/range arguments.

## Coercion
Same split as `SUM`/`VAR`:
- Range args: text, booleans, blanks ignored; errors propagate.
- Direct scalar args: numeric text and booleans coerced;
  non-numeric text -> `#VALUE!`.

## Semantics / errors
- `sum((x - mean)^2) / n`; `n = 0` numeric values -> `#DIV/0!`.
  (`n = 1` returns `0`.)

## Examples
- `VARP(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)` ->
  `678.84` (Microsoft docs example)
- `VARP(1,2,3)` -> `0.6666667` (`2/3`)
- `VARP(5)` -> `0`
- `VARP(A1:A10)` on an empty range -> `#DIV/0!`

## Open questions
- Empty-range-only invocation -> `#DIV/0!` (confirm vs arity
  error).
