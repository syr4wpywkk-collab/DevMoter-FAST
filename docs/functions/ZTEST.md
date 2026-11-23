# ZTEST

`ZTEST(array, x, [sigma])` — one-tailed probability of a z-test:
the probability that the sample mean is greater than the observed
`AVERAGE(array)` under hypothesized population mean `x`.

Legacy compatibility function; modern equivalent is `Z.TEST`
(identical signature).

## Arguments
- `array`: required range/array of numeric data; non-numerics
  ignored; errors propagate.
- `x`: required; hypothesized population mean.
- `sigma`: optional population standard deviation; if omitted,
  the **sample** standard deviation of `array` is used.

## Coercion
- Range rules for `array` (text/blank/bool ignored, errors
  propagate); scalar coercion for `x`/`sigma`.

## Semantics
- `ZTEST = 1 - NORMSDIST((AVERAGE(array) - x) / (sigma /
  sqrt(n)))`, where `n` is the numeric count.
- With `sigma` omitted, uses `STDEV` of the array in place of
  `sigma`.
- Note: returns the **one-tailed** upper-tail probability; when
  the observed mean is below `x`, the value exceeds 0.5 (and the
  two-tailed p-value is `2 * min(ZTEST, 1 - ZTEST)`).

## Errors
- Empty numeric array -> `#N/A`.
- `sigma <= 0` -> `#NUM!`.
- Zero sample standard deviation with `sigma` omitted -> `#DIV/0!`
  (confirm).
- Non-numeric `x`/`sigma` -> `#VALUE!`.

## Engine requirements
- `NORMSDIST` numerics; `AVERAGE`/`STDEV` primitives.

## Examples
- `ZTEST({3,6,7,8,6,5,4,2,1,9}, 4)` -> `0.090574` (Microsoft docs
  example, sigma omitted)
- `ZTEST({3,6,7,8,6,5,4,2,1,9}, 6)` -> `0.863043` (Microsoft docs
  example)
- `ZTEST({3,6,7,8,6,5,4,2,1,9}, 4, 2)` -> `0.04100` (approx:
  `1 - NORMSDIST((5.1-4)/(2/sqrt(10)))` = `1 - NORMSDIST(1.7392)`)
- `ZTEST(A1:A5, 4)` on empty range -> `#N/A`

## Open questions
- Zero-stdev omitted-sigma behavior (`#DIV/0!` expected).
- Exact definition when `n = 1` (`STDEV` -> `#DIV/0!` propagates
  vs defined result) — confirm.
