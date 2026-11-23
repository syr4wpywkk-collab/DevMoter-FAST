# MMULT

`MMULT(array1, array2)` — returns the matrix product of two arrays.

## Arguments
- `array1`: a x b numeric array. Required.
- `array2`: b x c numeric array. Required.
- The column count of `array1` must equal the row count of `array2`.

## Behavior
- Result is a x c; element (i,j) = sum_k a1[i,k]*a2[k,j].
- `MMULT({1,3;7,2},{5,0;2,3})` -> `{11,9;39,6}`.
- `MMULT({3,0;-3,0;0,2},{2,0;0,1})` -> `{6,0;-6,0;0,2}`.

## Errors
- Column count of `array1` != row count of `array2` -> `#VALUE!`.
- Any blank/text/non-coercible element -> `#VALUE!` (Excel: cells
  containing empty or text return `#VALUE!`; booleans in ranges are
  NOT numbers — confirm whether they error or count as non-numeric).
- Error elements propagate.

## Edge cases
- 1x1 x 1x1 returns scalar array.
- Excel limits output to 5460 rows x columns in legacy CSE mode —
  engine limits per plan array-size caps instead.

## Open questions
- Boolean-element handling inside ranges (error vs ignored).
- Overflow to non-finite values: `#NUM!` vs infinity propagation.
