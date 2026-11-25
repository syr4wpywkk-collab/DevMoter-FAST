# VAR.S

`VAR.S(number1, [number2], ...)` — sample variance (denominator n-1).

Identical input handling to `STDEV.S`; `VAR.S(x) = STDEV.S(x)^2`
mathematically, and implementations should share the accumulator so
`VAR.S` is not computed via `sqrt`/`pow` round-trip.

## Arguments & coercion
- Same as `STDEV.S.md` / `SUM.md`: range args ignore text/boolean/blank
  and propagate errors; direct args coerce numeric text and booleans,
  reject other text with `#VALUE!`.

## Computation
- `sum((x - mean)^2) / (n - 1)`; same stability requirement
  (Welford/two-pass) as `STDEV.S`.

## Errors
- `n < 2` -> `#DIV/0!`.
- Propagating errors and `#VALUE!` rules as `STDEV.S`.

## Edge cases
- All-equal values -> `0`.
- Negative-zero / signed-zero output: expected `+0` (confirm).

## Open questions
- Same as `STDEV.S` (algorithm, single-arg behavior).
