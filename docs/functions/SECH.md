# SECH

`SECH(number)` — returns the hyperbolic secant, `1/cosh(number)`.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.

## Behavior
- `SECH(0)` -> 1; `SECH(1)` -> 0.6480542736638853 (approx);
  `SECH(-3)` -> 0.0993279274194332 (approx).
- Range (0, 1]; even function.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- No domain restriction; large |x| -> 0 (no overflow since cosh
  saturates).

## Compatibility
- Introduced in Excel 2013.

## Open questions
- Precision policy when `cosh` overflows for |x| > ~710 (result 0 —
  no error).
