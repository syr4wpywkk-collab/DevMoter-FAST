# QUARTILE.INC

`QUARTILE.INC(array, quart)` — returns the quartile of `array`;
equivalent to PERCENTILE.INC with `k = quart/4`.

## Arguments
- `array`: same coercion as PERCENTILE.INC.
- `quart`: integer 0..4. 0=min, 1=Q1, 2=median, 3=Q3, 4=max.
  Non-integer `quart` is truncated.

## Behavior
- Delegates to the PERCENTILE.INC algorithm: `quart/4` -> k.
- `QUARTILE.INC({1,2,4,7},2)` -> `3` (median).

## Errors
- `#NUM!` when `quart` < 0 or > 4 (after truncation), or empty numeric
  set.
- `#VALUE!` for non-numeric `quart`.

## Edge cases
- `quart` truncation: `QUARTILE.INC(a,1.9)` behaves as quart=1
  (verify vs Excel).

## Open questions
- Truncation of `quart` vs rounding — confirm against reference.
