# SKEW.P

`SKEW.P(number1, [number2], ...)` — **population** skewness
(moment-based). Excel 2013+.

## Arguments & coercion
Same argument/coercion rules as `SKEW`.

## Semantics
- `gamma2 = (1/n) * SUM(((x_i - mean)/sigma)^3)` where `sigma` is the
  **population** standard deviation (divide by n, not n-1).
- Relationship: `SKEW.P = G1 * (n-2)/sqrt(n*(n-1))`? — verify formula
  mapping; equivalently `SKEW.P = SKEW * ((n-2)/sqrt(n*(n-1)))` is
  **not** the standard relation. Correct relation:
  `SKEW.P = SKEW * (n-2) / (sqrt(n*(n-1))) * (n-1)/n * (n/(n-2))`…
  **Open question — implement directly from the moment definition
  and verify against Excel, do not derive from `SKEW`.**

## Errors
- `< 3` numeric values? — population skewness is defined for `n >= 1`;
  Excel requires `n >= 3`? Docs say `#DIV/0!` when fewer than three
  data points or sd is zero — same as `SKEW` (confirm).
- `sigma = 0` -> `#DIV/0!`.

## Examples
- `SKEW.P({3;4;5;2;3;4;5;6;4;7})` -> `0.303193` (Excel doc example).
- `SKEW.P({1;1;2;2;3;3})` -> `0`.
- `SKEW.P({5;5;5})` -> `#DIV/0!`.

## Open questions
- Minimum-n error (`n < 3` vs `n < 1`).
- Moment-formula FP agreement tolerance.
