# MINA

`MINA(value1, [value2], ...)` — smallest value, counting booleans and
text in ranges (`TRUE` = 1, `FALSE`/text = 0). Legacy of `MIN`.

## Arguments
- `value1`: required; `value2..N`: optional (up to 255). Scalars,
  ranges, or arrays.

## Coercion (differs from `MIN`)
- Range/array cells: numbers at face value; `TRUE` = `1`; `FALSE`,
  text (including numeric-looking text), and blanks = `0`. All-blank
  range -> `0`.
- Direct scalars: booleans and numeric text coerce; non-numeric text
  handling -> `#VALUE!`? — **Open question** (mirrors `MAXA`).
- Error cells/args propagate.

## Return value
- Minimum after coercion; can be negative (no floor at 0 — e.g.
  `MINA({-5;-3}) = -5`).

## Examples
- `MINA(4, 7, 5)` -> `4`.
- `MINA(A1:A3)` with `A1=FALSE, A2=0.5, A3="x"` -> `0`.
- `MINA({-5;-3})` -> `-5`.
- `MINA(A1:A2)` with both blank -> `0`.

## Open questions
- Non-numeric direct text: `#VALUE!` vs counted as `0`.
- Blank vs `Text("")` distinction inside ranges.
