# RADIANS

`RADIANS(angle)` — converts degrees to radians.

## Arguments
- `angle`: numeric scalar in degrees, coerced per the direct-argument
  model.

## Behavior
- `RADIANS(270)` -> 4.71238898038469 (approx, = 3*pi/2).
- `RADIANS(180)` -> 3.141592653589793.
- `RADIANS(-90)` -> -1.5707963267948966.
- Result = `angle * PI() / 180`.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.

## Open questions
- None.
