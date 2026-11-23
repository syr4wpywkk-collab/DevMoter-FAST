# CHISQ.DIST.RT

`CHISQ.DIST.RT(x, deg_freedom)` — right-tailed chi-squared probability
`P(X >= x)` (upper incomplete gamma `Q(df/2, x/2)`).

## Arguments
- `x`: `x >= 0`; non-numeric -> `#VALUE!`.
- `deg_freedom`: `1 <= df <= 10^10`, truncated if non-integer.

## Errors
- `x < 0` -> `#NUM!`; `df` out of range -> `#NUM!`; non-numeric ->
  `#VALUE!`.

## Semantics
- `CHISQ.DIST.RT(x,df) = 1 - CHISQ.DIST(x,df,TRUE)`; implement via
  `Q(a,x)` directly for tail accuracy.

## Examples
- `CHISQ.DIST.RT(18.307,10)` -> `0.04999997...` (≈0.05)
- `CHISQ.DIST.RT(0.5,1)` -> `0.4795001221869535`
- `CHISQ.DIST.RT(3.841,1)` -> `0.0500035...` (≈0.05)
- `CHISQ.DIST.RT(-1,3)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `CHIDIST` identical signature/semantics.

## Engine requirements
- **Distribution numerics**: incomplete gamma (see `CHISQ.DIST`).

## Open questions
- Same `df` bound question as `CHISQ.DIST`.
