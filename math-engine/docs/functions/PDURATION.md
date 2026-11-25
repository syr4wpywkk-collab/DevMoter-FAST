# PDURATION

`PDURATION(rate, pv, fv)` — number of periods for an investment
growing at `rate` per period to grow from `pv` to `fv` (no payments).

## Arguments
- `rate`: required; growth per period, must be `> 0`.
- `pv`: required; must be `> 0`.
- `fv`: required; must be `> 0`.

## Semantics
- `PDURATION = (log(fv) - log(pv)) / log(1 + rate)`.
- May return fractional periods; Excel does not round.
- Introduced in Excel 2013 (web-app era); no legacy variant.

## Coercion
- Direct-scalar coercion; errors propagate; non-coercible -> `#VALUE!`.

## Errors
- Any arg `<= 0` -> `#NUM!` (Excel returns `#NUM!` for
  nonpositive arguments).
- `fv = pv` -> `0` regardless of rate.
- Non-numeric -> `#VALUE!`.

## Examples
- `PDURATION(0.025, 1000, 2000)` -> `28.0710...` (ln 2 / ln 1.025).
- `PDURATION(0.1, 100, 110)` -> `1`.
- `PDURATION(0.05, 100, 100)` -> `0`.
- `PDURATION(-0.1, 100, 50)` -> `#NUM!` (rate <= 0; also confirms
  domain — negative rate with fv<pv would solve mathematically but
  Excel requires rate > 0 — confirm).

## Open questions
- Whether negative `rate` with `fv < pv` errors in Excel (docs say all
  args must be positive -> `#NUM!` expected).
- Whether `rate`/`pv`/`fv` of exactly 0 map to `#NUM!` vs `#DIV/0!`.
