# GAMMA

`GAMMA(number)` — the gamma function Γ(n); `GAMMA(n) = (n-1)!` for
positive integers.

## Arguments
- `number`: real; non-numeric -> `#VALUE!`.

## Errors
- `number` = 0 or a negative integer (`-1,-2,...`) -> `#NUM!`.
- Very large `number` -> `#NUM!` (overflow; Γ overflows f64 around
  n ≈ 171.6) — document `#NUM!` vs IEEE `+inf` (**confirm** Excel
  returns `#NUM!`).

## Examples
- `GAMMA(2.5)` -> `1.3293403881791372` (1.5·√π/2)
- `GAMMA(5)` -> `24`
- `GAMMA(-3.5)` -> `0.2700882058522691` (negative non-integer allowed)
- `GAMMA(0)` -> `#NUM!`
- `GAMMA(-2)` -> `#NUM!`
- `GAMMA(172)` -> `#NUM!` — confirm

## Compatibility
- Excel 2013+. No legacy equivalent.

## Engine requirements
- **Distribution numerics**: `GAMMALN` (Lanczos) + reflection formula
  for negative arguments; f64 only.

## Open questions
- Overflow behavior (`#NUM!` vs `inf`).
- Negative-integer detection tolerance (e.g. `-2.0000000001`).
