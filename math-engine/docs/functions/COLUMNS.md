# COLUMNS

`COLUMNS(array)` — returns the number of columns in a reference or
array.

v2 plan §2 (056): column count. Mirror of `ROWS`.

## Arguments
- `array`: range reference or array literal (required).

## Behavior
- `COLUMNS(A1:E1)` -> 5; `COLUMNS(A1:C10)` -> 3;
  `COLUMNS({1,2;3,4})` -> 2.
- Contents irrelevant; contained errors do not propagate (confirm).

## Errors
- Scalar argument -> `#VALUE!` (confirm).
- Invalid reference -> `#REF!`.

## Edge cases / open questions
- Same as `ROWS`: whole-row refs unsupported; scalar-input behavior
  open.
