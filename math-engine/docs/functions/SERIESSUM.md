# SERIESSUM

`SERIESSUM(x, n, m, coefficients)` — returns the sum of a power
series: SUM_i coefficients[i] * x^(n + (i-1)*m).

## Arguments
- `x`: numeric scalar — the power-series input value.
- `n`: numeric scalar — exponent for the first term.
- `m`: numeric scalar — exponent step per term.
- `coefficients`: 1-D (or any-shape iterated row-major?) array/range
  of numeric coefficients; count determines number of terms.

## Behavior
- `SERIESSUM(x,n,m,{a1..ak}) = a1*x^n + a2*x^(n+m) + ... + ak*x^(n+(k-1)m)`.
- `SERIESSUM(PI()/4, 0, 2, {1,-1/6,1/120,-1/5040,1/362880})`
  approximates sin(pi/4) -> 0.707103 (documented Microsoft example;
  verify fixture value).
- Exponents need not be integers.

## Errors
- `x` = 0 with `n` <= 0 -> `#NUM!` (0^0 / negative exponent).
- Any non-numeric coefficient -> `#VALUE!`; coercion failures ->
  `#VALUE!`; errors propagate.
- Overflow -> `#NUM!`.

## Engine requirements
- Coefficient array flattening order (row-major) must be defined;
  confirm 2-D coefficient arrays are accepted or error — **open**.

## Open questions
- 2-D coefficients array: flatten vs `#VALUE!`.
- Blank/text cells inside a coefficient *range* (skip vs error).
