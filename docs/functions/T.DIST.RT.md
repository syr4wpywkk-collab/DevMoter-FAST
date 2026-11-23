# T.DIST.RT

`T.DIST.RT(x, deg_freedom)` — **right-tailed** t probability
`P(T >= x)`. Excel 2010+; numerically this is the modern
counterpart of legacy `TDIST(x, df, 1)`.

## Arguments
- `x`: required; any real (negative allowed — returns `> 0.5`).
- `deg_freedom`: required; `>= 1` else `#NUM!`.

## Semantics
- `T.DIST.RT(x, df) = 1 - T.DIST(x, df, TRUE)`.
- `T.DIST.RT(0, df) = 0.5`.
- Should be computed as the upper tail of the incomplete-beta form for
  accuracy (not literally `1 - CDF` in the far right tail — record
  implementation choice).

## Errors
- `df < 1` -> `#NUM!`; non-numeric -> `#VALUE!`.

## Examples
- `T.DIST.RT(1.959999998, 60)` -> `0.027322465` (doc example
  `0.027322`).
- `T.DIST.RT(0, 10)` -> `0.5`.
- `T.DIST.RT(-1.812, 10)` -> `~0.95`.
- `T.DIST.RT(1.812, 10)` -> `~0.05`.

## Open questions
- df truncation (same as `T.DIST`).
- Upper-tail accuracy method.

## Engine requirements
- Shared incomplete-beta implementation with `T.DIST`/`T.INV`.
