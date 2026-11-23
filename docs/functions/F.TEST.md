# F.TEST

`F.TEST(array1, array2)` — two-tailed p-value of the F-test for equal
variances: `2 * min(F.DIST.RT(s1²/s2²), F.DIST.RT(s2²/s1²))` evaluated
at the observed variance ratio.

## Arguments
- `array1`, `array2`: ranges/arrays of numbers; each must contain at
  least 2 numeric values (variances must be defined).

## Coercion
- Text/logical/blank cells inside ranges are ignored (only numerics
  counted); errors propagate; arrays must be non-empty of numerics.

## Errors
- Fewer than 2 numeric values in either array, or zero variance ->
  `#DIV/0!`.
- Non-numeric arrays -> `#DIV/0!` (documented) — **confirm** vs
  `#VALUE!`.
- Array sizes may differ (unlike `T.TEST`-paired? actually F.TEST
  allows different sizes — confirm).

## Examples
- `F.TEST({6,8,10,12},{4,6,8,10})` -> compute: s1²=20/3? Let fixture
  use exact: s1²=6.6667? Compute: data1 {6,8,10,12}: mean 9,
  s²=20/3≈6.6667; data2 {4,6,8,10}: mean 7, s²=20/3. Ratio 1 ->
  p = `1.0`? No — ratio exactly 1 gives 2*min(F.RT(1,3,3))... not 1.
  **Fixture note: compute exact value before use.**
- `F.TEST({1,2,3},{2,4,6,8})` -> compute exactly.
- `F.TEST({5},{1,2})` -> `#DIV/0!`

## Compatibility
- Excel 2010+. Legacy `FTEST` identical.

## Engine requirements
- **Distribution numerics**: F right tail (incomplete beta).

## Open questions
- Exact formula Excel uses (single-tail ×2 vs direct two-tailed).
- Whether different-length arrays are accepted (expected yes).
- Error kind for non-numeric input.
