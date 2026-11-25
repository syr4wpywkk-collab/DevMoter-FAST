# SQRT

`SQRT(number)` — nonnegative square root.

## Arguments
- `number`: required; direct-scalar coercion (numeric text/booleans
  coerce; other text -> `#VALUE!`; blank -> 0 -> `0`).

## Computation
- `f64::sqrt`; correctly rounded, so fixtures can use tight tolerance.

## Errors
- `number < 0` -> `#NUM!`.
- `-0` input -> `0` (Excel returns `0`; `(-0).sqrt()` is `-0` — decide
  whether to normalize signed zero — **SPEC-OPEN**, expected `+0`).
- Errors propagate.

## Edge cases
- `SQRT(0)` -> `0`; `SQRT(2)` tolerance per fixture policy.
- `SQRT` of values near `f64::MAX` -> finite, no error.
- `SQRT` of a perfect square may return `x.999…9` — tolerance policy.

## Open questions
- Signed-zero normalization for `-0` input.
