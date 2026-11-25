# RRI

`RRI(nper, pv, fv)` — equivalent constant growth rate taking `pv` to
`fv` in `nper` periods. `RRI(n,p,f) = (f/p)^(1/n) - 1`.

## Arguments
- `nper`: required; must be `> 0`.
- `pv`: required; must be `> 0`.
- `fv`: required; must be `> 0`.

## Semantics
- Closed form — no iteration. Result may be negative when `fv < pv`.
- Introduced in Excel 2013; no legacy variant.
- Related: `CAGR` idiom; `RRI` = geometric growth per period.

## Coercion
- Direct-scalar; errors propagate; non-coercible -> `#VALUE!`.

## Errors
- `nper <= 0` -> `#NUM!`.
- `pv <= 0` or `fv <= 0` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `RRI(10, 1000, 2000)` -> `0.071773...` (2^(1/10) - 1).
- `RRI(5, 1000, 500)` -> `-0.129449...` ((0.5)^(1/5) - 1).
- `RRI(1, 100, 110)` -> `0.1`.
- `RRI(0, 100, 200)` -> `#NUM!`.
- `RRI(10, -100, 200)` -> `#NUM!`.

## Open questions
- None significant; error classes per Microsoft docs assumed `#NUM!`
  for nonpositive args — confirm `fv = 0` -> `#NUM!` (0^... vs
  negative root).
