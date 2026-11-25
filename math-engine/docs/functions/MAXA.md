# MAXA

`MAXA(value1, [value2], ...)` — largest value, counting booleans and
text in ranges (`TRUE` = 1, `FALSE`/text = 0). Legacy of `MAX`;
Excel 2003+.

## Arguments
- `value1`: required; `value2..N`: optional (up to 255). Each may be a
  scalar, range, or array.

## Coercion (differs from `MAX`)
- Range/array cells: numbers count at face value; `TRUE` counts as `1`;
  `FALSE`, text (including numeric-looking text), and blanks count as
  `0`. Empty cells contribute `0` — so `MAXA` of an all-blank range is
  `0`, never `#VALUE!`/empty.
- Direct scalar args: booleans and numeric text coerce
  (`MAXA("3") = 3`); non-numeric text -> `#VALUE!`? — confirm; some
  docs say text args coerce or error.
- Error cells/args propagate.

## Return value
- Largest value after coercion. If the largest is negative, negative
  result; no implicit floor at 0 (unlike `MINA`'s floor of 0 —
  symmetric rule: `MAXA` can return negative).

## Errors
- No values at all (empty arg list is an arity error; a wholly empty
  single range yields `0`).
- Error in any cell -> propagates.

## Examples
- `MAXA(1, 3, 2)` -> `3`.
- `MAXA(A1:A3)` with `A1=TRUE, A2=0.1, A3="x"` -> `1`.
- `MAXA({-5;-3})` -> `-3`.
- `MAXA("")` — empty-string direct arg: Open question (`#VALUE!` vs 0).

## Open questions
- Whether non-numeric direct text is `#VALUE!` (like `MAX`) or counted
  as `0`.
- Blank handling inside arrays vs ranges (consistent with `COUNTA`?).
