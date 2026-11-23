# PRODUCT

`PRODUCT(number1, [number2], ...)` — multiplies all numeric arguments.

v2 plan §2 (039): product of numeric arguments; treatment of blanks,
text, and text inside arrays fixed by compatibility testing.

## Arguments
- 1..255 arguments. Each may be a scalar, cell ref, or range.

## Type coercion
Same model as `SUM` (see `SUM.md`):

| Input | Range argument | Direct argument |
|---|---|---|
| number | multiplied | multiplied |
| numeric text (`"3"`) | ignored | coerced |
| other text | ignored | `#VALUE!` |
| boolean | ignored | coerced (TRUE=1) |
| blank | ignored | coerced to 1? — see open questions |
| error | propagates | propagates |

## Errors
- `#VALUE!` for non-coercible direct text.
- Any error value in inputs propagates unchanged.

## Edge cases
- No numeric values at all -> `1` (Excel returns 1 for `PRODUCT()` over
  only-empty ranges; confirm).
- `PRODUCT(0, huge_range)` short-circuits to `0` only after scanning for
  errors — an error cell anywhere still propagates (confirm).
- Overflow to `> ~1.8e308` yields `#NUM!` in Excel; confirm whether the
  engine returns `inf` or `#NUM!`.

## Open questions
- Does a direct blank argument coerce to 0 (making the product 0) or is
  it treated as 1 / `#VALUE!`? Excel: `PRODUCT(A1)` with blank A1 -> 0.
- Text-in-range ignoring confirmed identical to `SUM`.
- Overflow result: `inf` vs `#NUM!`.
