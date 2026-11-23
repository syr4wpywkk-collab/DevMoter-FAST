# BESSELK

`BESSELK(x, n)` — returns the modified Bessel function of the second
kind, K_n(x) (also called the Neumann/Weber modified function).

## Arguments
- `x`: required numeric; must be positive.
- `n`: required numeric; order, truncated to integer.

## Semantics
- Returns a scalar number; `K_n(x)` decays exponentially and diverges
  as `x -> 0+`.

## Coercion
- Numeric text coerced; non-numeric text -> `#VALUE!`; blank -> `0`
  (confirm, which then yields `#NUM!` since `x <= 0`).

## Errors
- Non-numeric arguments -> `#VALUE!`.
- `x <= 0` -> `#NUM!`.
- `n < 0` -> `#NUM!`.

## Examples
- `BESSELK(1.5, 1)` = `0.277387804` (approx `0.2773878045`)
- `BESSELK(2, 0)` = `0.113893893` (approx `0.1138938938`)
- `BESSELK(1, 0)` = `0.601907230` (approx `0.6019072302`)
- `BESSELK(0, 1)` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (Analysis ToolPak earlier).

## Engine requirements
- Modified Bessel K_n (recurrence upward from K_0/K_1 for integer
  orders).

## Open questions
- Overflow/`#NUM!` boundary as `x -> 0+` for large `n`.
- Symmetry `K_{-n} = K_n` is moot since `n < 0` errors — confirm Excel
  really rejects negative `n` (documented as `#NUM!`).
