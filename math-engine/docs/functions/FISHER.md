# FISHER

`FISHER(x)` — Fisher transformation `atanh(x) = 0.5 * LN((1+x)/(1-x))`.

## Arguments
- `x`: `-1 < x < 1`; non-numeric -> `#VALUE!`.

## Errors
- `x <= -1` or `x >= 1` -> `#NUM!`.

## Examples
- `FISHER(0.75)` -> `0.9729550745276566`
- `FISHER(0)` -> `0`
- `FISHER(-0.5)` -> `-0.5493061443340548`
- `FISHER(1)` -> `#NUM!`
- `FISHER("a")` -> `#VALUE!`

## Compatibility
- All Excel versions. Inverse: `FISHERINV` = `tanh`.

## Open questions
- None.
