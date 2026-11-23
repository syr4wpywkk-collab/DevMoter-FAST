# PI

`PI()` — returns the constant pi to 15 digits, 3.14159265358979.

## Arguments
- None. `PI(x)` is an arity error.

## Behavior
- `PI()` -> 3.14159265358979 (Excel displays 15 digits; the stored
  value is the f64 nearest to pi, 3.14159265358979311599...).
- `PI()/2` -> 1.5707963267948966 (approx).

## Errors
- None besides arity.

## Edge cases
- Use `std::f64::consts::PI`.

## Open questions
- None.
