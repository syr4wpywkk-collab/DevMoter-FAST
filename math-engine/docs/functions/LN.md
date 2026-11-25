# LN

`LN(number)` — returns the natural logarithm (base *e*) of `number`.

## Arguments
- `number`: required positive numeric scalar, coerced per the
  direct-argument model (numeric text and booleans coerce; other text
  -> `#VALUE!`; blank -> 0).

## Behavior
- `LN(x) = log_e(x)`; inverse of `EXP`.
- `LN(EXP(1))` -> 1; `LN(1)` -> 0; `LN(10)` -> 2.302585092994046
  (approximately; fixture tolerance required).

## Errors
- `number` <= 0 -> `#NUM!` (includes blank and `FALSE`, which coerce
  to 0).
- Coercion failures -> `#VALUE!`.
- Error inputs propagate.

## Edge cases
- Result of `LN(0)` is `-inf` mathematically but must be `#NUM!` — do
  not return non-finite `f64`.
- Very small positive subnormal inputs produce large-magnitude
  negatives; keep finite.

## Open questions
- Numeric tolerance vs reference implementation for transcendental
  results (shared policy with `EXP`/`LOG`).
