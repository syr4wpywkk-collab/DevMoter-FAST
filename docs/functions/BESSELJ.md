# BESSELJ

`BESSELJ(x, n)` — returns the Bessel function of the first kind, J_n(x).

## Arguments
- `x`: required numeric.
- `n`: required numeric; order. Non-integer values are truncated to an
  integer.

## Semantics
- Returns a scalar number; `J_n` oscillates and decays like
  `sqrt(2/(pi*x))` for large `x`.
- `n` truncated toward zero (e.g. `1.9` -> `1`).

## Coercion
- Numeric text coerced; non-numeric text -> `#VALUE!`; blank -> `0`
  (confirm).

## Errors
- Non-numeric arguments -> `#VALUE!`.
- `n < 0` -> `#NUM!`.

## Examples
- `BESSELJ(1.9, 2)` = `0.329925829` (approx `0.3299258287`)
- `BESSELJ(0, 0)` = `1`
- `BESSELJ(5, 0)` = `-0.177596771` (approx `-0.1775967713`)
- `BESSELJ(1, -2)` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (Analysis ToolPak earlier). Accuracy improved in
  Excel 2010.

## Engine requirements
- Bessel J_n for arbitrary real `x` and non-negative integer order
  (series for small `x`, asymptotic for large `x`, recurrence for order).

## Open questions
- `J_n(-x)` parity handling (`(-1)^n` rule) — confirm.
- Accuracy near zeros of `J_n` for large `x`.
- Blank `n` -> `0` (confirm).
