# BESSELY

`BESSELY(x, n)` — returns the Bessel function of the second kind, Y_n(x)
(Weber/Neumann function).

## Arguments
- `x`: required numeric; must be positive.
- `n`: required numeric; order, truncated to integer.

## Semantics
- Returns a scalar number; `Y_n` is singular at `0` and oscillatory with
  decaying amplitude for large `x`.

## Coercion
- Numeric text coerced; non-numeric text -> `#VALUE!`; blank -> `0`
  (confirm — then `#NUM!` since `x <= 0`).

## Errors
- Non-numeric arguments -> `#VALUE!`.
- `x <= 0` -> `#NUM!`.
- `n < 0` -> `#NUM!`.

## Examples
- `BESSELY(2.5, 1)` = `0.145918138` (approx `0.1459181380`)
- `BESSELY(1, 0)` = `0.088256964` (approx `0.0882569642`)
- `BESSELY(10, 0)` = `0.055671167` (approx `0.0556711673`)
- `BESSELY(-1, 0)` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (Analysis ToolPak earlier).

## Engine requirements
- Bessel Y_n for positive real `x`, integer order.

## Open questions
- Behavior for very small positive `x` (divergence — confirm `#NUM!` vs
  a huge finite value near underflow).
- Blank `n` -> `0` (confirm).
