# T.DIST

`T.DIST(x, deg_freedom, cumulative)` — **left-tailed** Student's t
distribution. Excel 2010+. Legacy `TDIST` was a different,
positive-x-only right-tailed function — do not alias them.

## Arguments
- `x`: required; any real (unlike legacy `TDIST`, negative x allowed).
- `deg_freedom`: required; `>= 1` else `#NUM!`; truncated to integer?
  (docs: truncated — confirm like other df args).
- `cumulative`: required boolean.

## Semantics
- CDF: `P(T <= x)` for T ~ t_df.
- PDF: `(Gamma((df+1)/2) / (sqrt(df*pi)*Gamma(df/2))) * (1 + x^2/df)^(-(df+1)/2)`.
- `T.DIST(0, df, TRUE) = 0.5` (enforce symmetry; `T.DIST(-x,df,TRUE) =
  1 - T.DIST(x,df,TRUE)`).

## Errors
- `deg_freedom < 1` -> `#NUM!`; non-numeric -> `#VALUE!`.

## Examples
- `T.DIST(60, 1, TRUE)` -> `0.994695326` (Excel doc example
  `0.99469533`).
- `T.DIST(8, 3, FALSE)` -> `0.000736906...`? (verify against doc `T.DIST`
  PDF example `0.000736907`).
- `T.DIST(0, 10, TRUE)` -> `0.5`.
- `T.DIST(-1.812, 10, TRUE)` -> `~0.05`.

## Open questions
- df truncation and `df < 1` boundary (`df` between 0 and 1 errors).
- Accuracy target in tails vs Excel's own approximation.

## Engine requirements
- Needs regularized incomplete beta `I_x(a,b)` (t-CDF kernel) +
  log-gamma in `calc-core` (std only). Flag as distribution-numerics
  dependency.
