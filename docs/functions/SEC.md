# SEC

`SEC(number)` — returns the secant of an angle in radians,
`1/cos(number)`.

## Arguments
- `number`: angle in radians, coerced per the direct-argument model.

## Behavior
- `SEC(45 * PI() / 180)` -> 1.4142135623730951 (approx, = sqrt(2)).
- `SEC(0)` -> 1.
- `SEC(2)` -> -2.402997961722381 (approx; verify fixture).

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- Angles where cos -> 0 produce huge finite values (Excel does not
  error; document magnitude) — exact multiples of pi/2 depend on f64
  `cos` never being exactly 0 for `PI()/2`.
- |number| >= 2^27: Excel historically returns `#NUM!` for trig args
  beyond ~2^27? — confirm; LibreOffice does. **SPEC-OPEN**.

## Compatibility
- Introduced in Excel 2013.

## Open questions
- Domain limit / `#NUM!` for very large arguments.
