# BINOM.INV

`BINOM.INV(trials, probability_s, alpha)` — smallest `k` such that
`P(X <= k) >= alpha` (the CDF inverse of the binomial).

## Arguments
- `trials`: non-negative integer (truncated).
- `probability_s`: `0 <= p <= 1`.
- `alpha`: criterion; `0 <= alpha <= 1`.

## Semantics
- Returns the smallest integer `k` in `[0, trials]` with
  `BINOM.DIST(k, trials, p, TRUE) >= alpha`.
- `alpha = 0` -> `0`? Edge behavior **confirm** (Excel: smallest k;
  at `alpha=0` returns 0).

## Errors
- `trials < 0`, `p` outside `[0,1]`, or `alpha` outside `[0,1]` ->
  `#NUM!` (documented: `alpha` and `p` bounds; `trials` bound
  **confirm**).
- Non-numeric args -> `#VALUE!`.

## Examples
- `BINOM.INV(10,0.5,0.5)` -> `5` (CDF at 5 is 0.6230 >= 0.5; at 4 is
  0.3770 < 0.5)
- `BINOM.INV(10,0.5,0.83)` -> `6` (CDF(6)=0.828125 < 0.83 -> 7?
  Careful: 0.828125 < 0.83 so result is `7` — fixture must use a
  value above: `BINOM.INV(10,0.5,0.82)` -> `6`)
- `BINOM.INV(6,0.5,0.75)` -> `4` (CDF: k=3 -> 0.65625, k=4 -> 0.890625)
- `BINOM.INV(10,1.5,0.5)` -> `#NUM!`
- `BINOM.INV(10,0.5,-0.1)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `CRITBINOM` (same signature).

## Engine requirements
- **Distribution numerics**: binomial CDF (see `BINOM.DIST`).

## Open questions
- `alpha = 0` and `alpha = 1` boundary results (`0` and `trials`).
