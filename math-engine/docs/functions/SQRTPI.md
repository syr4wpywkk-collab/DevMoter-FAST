# SQRTPI

`SQRTPI(number)` — returns `sqrt(number * pi)`.

## Arguments
- `number`: non-negative numeric scalar, coerced per the
  direct-argument model.

## Behavior
- `SQRTPI(1)` -> 1.772453850905516 (approx);
  `SQRTPI(2)` -> 2.5066282746310002 (approx).
- Equivalent to `SQRT(PI()*number)` — single-op convenience.

## Errors
- `number` < 0 -> `#NUM!`.
- Coercion failures -> `#VALUE!`; errors propagate.

## Compatibility
- Excel 2003 and earlier required Analysis ToolPak; native since
  Excel 2007.

## Open questions
- None.
