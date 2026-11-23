# LOGINV

`LOGINV(probability, mean, standard_dev)` — inverse of the
lognormal cumulative distribution: `x` with
`LOGNORMDIST(x, mean, standard_dev) = probability`.

Legacy compatibility function; modern equivalent is `LOGNORM.INV`.

## Arguments
- `probability`: required scalar in `[0, 1]`.
- `mean`: required mean of `ln(x)`.
- `standard_dev`: required standard deviation of `ln(x)`, `> 0`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `LOGINV(p, m, s) = exp(m + s * NORMSINV(p))`.

## Errors
- `probability <= 0` or `probability >= 1` -> `#NUM!`.
- `standard_dev <= 0` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- `NORMSINV` numerics (see `NORMSINV.md`).

## Examples
- `LOGINV(0.5, 3.5, 1.2)` -> `33.11545196` (`e^3.5`)
- `LOGINV(0.039084, 3.5, 1.2)` -> `4.0000` (approximately;
  Microsoft docs example pair with `LOGNORMDIST(4,3.5,1.2)`)
- `LOGINV(0.5, 0, 1)` -> `1`
- `LOGINV(0, 3.5, 1.2)` -> `#NUM!`

## Open questions
- Whether `probability` boundaries are `<`/`>` or `<=`/`>=` for the
  `#NUM!` (docs show <= 0 or >= 1; confirm `p=1` errors rather than
  returning `inf`).
