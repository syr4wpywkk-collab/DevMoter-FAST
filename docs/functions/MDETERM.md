# MDETERM

`MDETERM(array)` — returns the matrix determinant of a square numeric
array.

## Arguments
- `array`: required square range or array constant (n x n, 1 <= n).

## Behavior
- `MDETERM({3,8,5;3,-6,1;-8,0,2})` -> 222 (documented Microsoft
  example approx; verify exactly: det = 222).
- `MDETERM({2})` -> 2 (1x1 returns the element).
- `MDETERM({1,2;3,4})` -> -2.

## Errors
- Non-square array -> `#VALUE!`.
- Any element that is blank, text, or non-coercible -> `#VALUE!`
  (Excel: "array must contain only numbers"; blanks/text -> `#VALUE!`).
- Error elements propagate.

## Edge cases
- Singular matrices -> 0 (within floating tolerance).
- Large n: LU decomposition with partial pivoting; document numerical
  accuracy — Excel advertises ~1e-16 relative error and may return
  near-zero instead of exact zero for singular inputs.

## Open questions
- Exact behavior for empty (0x0) arrays: likely `#VALUE!`, confirm.
- Numerical tolerance policy for "singular" results in fixtures.
