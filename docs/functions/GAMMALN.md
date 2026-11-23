# GAMMALN

`GAMMALN(x)` — natural log of `|Γ(x)|`: `LN(ABS(GAMMA(x)))`.

## Arguments
- `x`: `> 0`; non-numeric -> `#VALUE!`.

## Errors
- `x <= 0` -> `#NUM!` (docs: `x <= 0` -> `#NUM!` — negative
  non-integers where Γ is defined still error; flag: only documented
  domain is x > 0? Excel docs say `x <= 0` -> `#NUM!`. Confirm.)

## Examples
- `GAMMALN(4)` -> `1.791759469228055` (ln 6)
- `GAMMALN(0.5)` -> `0.5723649429247001` (ln √π)
- `GAMMALN(10)` -> `12.801827480081469` (ln 9! = ln 362880)
- `GAMMALN(-1)` -> `#NUM!`
- `GAMMALN(0)` -> `#NUM!`

## Compatibility
- All Excel versions. `GAMMALN.PRECISE` is the 2010+ rename.

## Engine requirements
- Lanczos/Spouge ln-Γ approximation, f64.

## Open questions
- Negative x where Γ(x) > 0 mathematically (e.g. x=-0.5 -> ln √π):
  Excel errors per docs — verify.
