# VAR

`VAR(number1, [number2], ...)` — sample variance (denominator
n-1).

Legacy compatibility function; modern equivalent is `VAR.S`
(identical). Distinct from `VARA` (counts text/booleans in
ranges).

## Arguments
- `number1`: required; up to 255 scalar/range arguments.

## Coercion
Same split as `SUM`:
- Range args: text, booleans, blanks ignored; errors propagate.
- Direct scalar args: numeric text and booleans coerced;
  non-numeric text -> `#VALUE!`.

## Semantics / errors
- `sum((x - mean)^2) / (n - 1)`; `n < 2` -> `#DIV/0!`.
- Numerical-stability requirement identical to `STDEV_S.md`
  (Welford/two-pass).

## Examples
- `VAR(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)` ->
  `754.2666667` (Microsoft docs example)
- `VAR(1,2,3)` -> `1`
- `VAR(5)` -> `#DIV/0!`
- `VAR("x",1,2)` -> `#VALUE!`

## Open questions
- See `STDEV_S.md` open questions (algorithm, stability bound).
