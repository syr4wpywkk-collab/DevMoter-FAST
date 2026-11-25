# TDIST

`TDIST(x, deg_freedom, tails)` — Student's t-distribution
probability; legacy signature differs from modern `T.DIST`.

Legacy compatibility function; modern equivalents are `T.DIST`,
`T.DIST.RT`, `T.DIST.2T`. Key legacy constraints: `x` must be
`>= 0` and `tails` is a required `1|2` argument — semantics map to
`T.DIST.2T` (tails=2) / `T.DIST.RT` (tails=1).

## Arguments
- `x`: required scalar, `>= 0` (negative `x` -> `#NUM!`, unlike
  modern `T.DIST` which accepts negatives).
- `deg_freedom`: required; truncated to integer, `>= 1`.
- `tails`: required; truncated to integer; `1` -> one-tailed
  `P(X >= x)`; `2` -> two-tailed `P(|X| >= x)`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `tails=1`: `0.5 * I_{v/(v+x^2)}(v/2, 1/2)`; `tails=2`: twice
  that (equivalently `I_{v/(v+x^2)}(v/2, 1/2)`).

## Errors
- `x < 0`, `deg_freedom < 1`, or `tails` not in `{1,2}` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Regularized incomplete beta function (shared with `BETADIST`).

## Examples
- `TDIST(1.959999998, 60, 2)` -> `0.054645` (Microsoft docs
  example)
- `TDIST(1.959999998, 60, 1)` -> `0.027322` (half of two-tailed)
- `TDIST(0, 10, 2)` -> `1`
- `TDIST(-1, 10, 2)` -> `#NUM!`
- `TDIST(1, 10, 3)` -> `#NUM!`

## Open questions
- `tails` values after truncation (e.g. `1.9` -> `1`) — confirm.
