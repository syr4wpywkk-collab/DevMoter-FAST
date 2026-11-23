# SIN

`SIN(number)` — returns the sine of an angle in radians.

## Arguments
- `number`: angle in radians, coerced per the direct-argument model.

## Behavior
- `SIN(PI())` -> 0 (approx; f64 result 1.22e-16 — document tolerance);
  `SIN(PI()/2)` -> 1; `SIN(30*PI()/180)` -> 0.5 (approx).
- For degrees: `SIN(RADIANS(x))`.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- Very large |x| (>= 2^27? ) — argument-reduction accuracy degrades;
  Excel has no documented error; flag **SPEC-OPEN** for parity with
  `SEC`/`COS` policy.

## Edge cases
- `SIN(PI())` is NOT exactly 0 in f64 — fixtures need tolerance, or
  engine may special-case multiples of pi (decision recorded here:
  no special-casing unless reference requires it).

## Open questions
- Large-argument domain policy (shared trig question).
