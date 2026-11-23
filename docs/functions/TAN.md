# TAN

`TAN(number)` — returns the tangent of an angle in radians.

## Arguments
- `number`: angle in radians, coerced per the direct-argument model.

## Behavior
- `TAN(0.785)` -> 0.99920 (approx); `TAN(45*PI()/180)` -> 1.0;
  `TAN(0)` -> 0.
- Near odd multiples of pi/2 the result is huge but finite in f64;
  no error (unless the large-argument policy below applies).

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- Very large |x|: argument-reduction accuracy degrades — same
  **SPEC-OPEN** as `SIN` (Excel appears not to error; LibreOffice
  limits at 2^27).

## Open questions
- Large-argument domain policy (shared trig question).
