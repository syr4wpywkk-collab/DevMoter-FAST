# BINOM.DIST.RANGE

`BINOM.DIST.RANGE(trials, probability_s, number_s, [number_s2])` —
probability of a range of successes: `P(k1 <= X <= k2)` (or
`P(X = k1)` when `number_s2` is omitted).

## Arguments
- `trials`: non-negative integer (truncated).
- `probability_s`: `0 <= p <= 1`.
- `number_s`: lower bound of successes `k1`; `0 <= k1 <= trials`
  (truncated).
- `number_s2`: optional upper bound `k2`; `k1 <= k2 <= trials`
  (truncated). Defaults to `k1`.

## Semantics
- `sum_{i=k1}^{k2} C(n,i) p^i (1-p)^(n-i)`.

## Errors
- Any of `trials`, `k1`, `k2` out of range, `k2 < k1`, or `p` outside
  `[0,1]` -> `#NUM!`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `BINOM.DIST.RANGE(10,0.5,6)` -> `0.205078125`
- `BINOM.DIST.RANGE(10,0.5,4,6)` -> `0.65625` (0.205078125+0.24609375+0.205078125)
- `BINOM.DIST.RANGE(50,0.6,40,50)` -> `0.12237134...` (≈0.1224)
- `BINOM.DIST.RANGE(10,0.5,7,3)` -> `#NUM!`

## Compatibility
- Excel 2013+. No legacy equivalent.

## Engine requirements
- **Distribution numerics**: same machinery as `BINOM.DIST`
  (`GAMMALN`-based PMF sum).

## Open questions
- Whether `k1 > k2` is `#NUM!` or `0` — expected `#NUM!`, confirm.
