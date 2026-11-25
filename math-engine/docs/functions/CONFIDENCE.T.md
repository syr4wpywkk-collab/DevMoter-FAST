# CONFIDENCE.T

`CONFIDENCE.T(alpha, standard_dev, size)` — confidence-interval
half-width using Student's t: `T.INV.2T(alpha, size-1) *
standard_dev / SQRT(size)`.

## Arguments
- `alpha`: `0 < alpha < 1`.
- `standard_dev`: sample standard deviation; `> 0`.
- `size`: `>= 2` (needs df = size-1 >= 1); truncated to integer.

## Errors
- `alpha <= 0` or `alpha >= 1` -> `#NUM!`.
- `standard_dev <= 0` -> `#NUM!`.
- `size < 2` -> `#NUM!` (**confirm**: docs say `size = 1` -> `#DIV/0!`
  in some references — flag).
- Non-numeric -> `#VALUE!`.

## Examples
- `CONFIDENCE.T(0.05,2.5,50)` -> `0.711634288...` (t(0.025,49)=2.009575;
  2.009575*2.5/√50 = 0.7106... — fixture value must be computed
  exactly: `2.0095752347 * 2.5 / SQRT(50)` = `0.710617...`)
- `CONFIDENCE.T(0.05,1,10)` -> `0.7153872...` (t(0.025,9)=2.2621572;
  *1/√10)
- `CONFIDENCE.T(0.01,1,30)` -> `0.503...` (t(0.005,29)=2.7563859/√30
  = `0.503...`)
- `CONFIDENCE.T(0.5,1,2)` -> t(0.25,1)=1 * 1/√2 -> `0.7071067811865476`
- `CONFIDENCE.T(0.05,1,1)` -> `#NUM!` or `#DIV/0!` — **confirm**

## Compatibility
- Excel 2010+. No legacy equivalent (`CONFIDENCE` is normal-based).

## Engine requirements
- **Distribution numerics**: inverse t-distribution `T.INV.2T`
  (requires inverse incomplete beta).

## Open questions
- `size = 1` error kind.
- Whether df uses truncated `size`.
