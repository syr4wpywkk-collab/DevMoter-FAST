# GAMMA.INV

`GAMMA.INV(probability, alpha, beta)` — inverse of the gamma CDF:
`x` with `P(alpha, x/beta) = probability`.

## Arguments
- `probability`: `0 <= p <= 1` (`p=0` -> `0`, `p=1` -> `#NUM!`?
  **confirm**).
- `alpha`, `beta`: `> 0`.

## Errors
- `p` outside `[0,1]` -> `#NUM!`; `alpha <= 0` or `beta <= 0` ->
  `#NUM!`; non-numeric -> `#VALUE!`.

## Semantics
- Iterative inversion of `P(a, x/b)` (Newton + bisection with
  Wilson–Hilferty / Best–Roberts initial guess).

## Examples
- `GAMMA.INV(0.068094,9,2)` -> ≈`10.0000113` (round-trip of
  `GAMMA.DIST` example)
- `GAMMA.INV(0.5939941502901619,2,2)` -> `4`
- `GAMMA.INV(0.5,1,1)` -> `0.6931471805599453` (exponential median
  ln2)
- `GAMMA.INV(-0.1,1,1)` -> `#NUM!`
- `GAMMA.INV(0.5,0,1)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `GAMMAINV` identical.

## Engine requirements
- **Distribution numerics**: incomplete gamma inverse.

## Open questions
- `p = 0/1` boundary results; solver tolerance for fixtures.
