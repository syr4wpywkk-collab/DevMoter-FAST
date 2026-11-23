# STDEVPA

`STDEVPA(value1, [value2], ...)` — **population** standard deviation
with `A`-family coercion.

## Arguments & coercion
Same as `STDEVA`: range text/booleans/blanks count as 0/1; direct
scalars coerce.

## Semantics
- `sqrt( SUM((v_i - mean)^2) / n )` over coerced values.
- `n = 0` values -> `#DIV/0!` (an entirely empty arg set); a single
  cell -> `n = 1` -> `0` (valid, population).

## Errors
- No values at all -> `#DIV/0!`.
- Non-numeric direct text -> `#VALUE!` (confirm); errors propagate.

## Examples
- `STDEVPA({1;2;3})` -> `0.8164965809`.
- `STDEVPA(10)` -> `0` (single value population sd).
- `STDEVPA(A1:A2)` with `A1=TRUE, A2=blank` -> {1,0} -> `0.5`.
- `STDEVPA(A1:A3)` with all text/blank -> `0` (all zeros -> sd 0).

## Open questions
- Same as `STDEVA` (direct-text handling).
