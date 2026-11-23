# T.DIST.2T

`T.DIST.2T(x, deg_freedom)` — **two-tailed** t probability
`P(|T| >= x)`. Excel 2010+.

## Arguments
- `x`: required; must be `>= 0`? — Excel docs say `x < 0` -> `#NUM!`
  (negative x is an error even though the statistic is symmetric —
  confirm).
- `deg_freedom`: required; `>= 1` else `#NUM!`.

## Semantics
- `T.DIST.2T(x, df) = 2 * (1 - T.DIST(|x|, df, TRUE)) = 2 * T.DIST.RT(x, df)`.
- Result in `(0, 1]`; `x = 0` -> `1`.

## Errors
- `x < 0` -> `#NUM!` (expected; confirm).
- `df < 1` -> `#NUM!`; non-numeric -> `#VALUE!`.

## Examples
- `T.DIST.2T(1.959999998, 60)` -> `0.054644930` (Excel doc example
  `0.054645`).
- `T.DIST.2T(0, 10)` -> `1`.
- `T.DIST.2T(2.228, 10)` -> `~0.05` (t_{0.025,10} = 2.2281).
- `T.DIST.2T(-1, 10)` -> `#NUM!`.

## Open questions
- Negative-x error vs implicit `|x|`.
- df non-integer truncation.
