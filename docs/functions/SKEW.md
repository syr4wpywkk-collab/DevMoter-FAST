# SKEW

`SKEW(number1, [number2], ...)` — **sample** skewness (n-adjusted).
Legacy function; contrast `SKEW.P` (population skewness).

## Arguments
- `number1`: required (range/array/scalar); up to 255 total args.

## Coercion
- Same as `MEDIAN`-family aggregates: range text/boolean/blank ignored;
  direct scalars coerce; non-numeric direct text -> `#VALUE!`; error
  cells propagate.

## Semantics
- Sample skewness: `G1 = n/((n-1)(n-2)) * SUM(((x_i - mean)/s)^3)`
  where `s` is the **sample** standard deviation (n-1).
- Symmetric data -> `0`; right tail -> positive.

## Errors
- Fewer than 3 numeric values -> `#DIV/0!`.
- `s = 0` (all values identical) -> `#DIV/0!`.

## Examples
- `SKEW({3;4;5;2;3;4;5;6;4;7})` -> `0.359543` (Excel doc example).
- `SKEW({1;1;2;2;3;3})` -> `0` (symmetric).
- `SKEW({1;2})` -> `#DIV/0!`.
- `SKEW({5;5;5;5})` -> `#DIV/0!`.

## Open questions
- Exact FP ordering in the sum (affects last-digit fixtures).
- Whether Excel computes via the moment formula or a numerically
  different path (agreement tolerance).
