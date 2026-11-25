# STDEVA

`STDEVA(value1, [value2], ...)` — **sample** standard deviation with
`A`-family coercion: text/booleans in ranges count as numbers.

## Arguments
- `value1`: required; up to 255.

## Coercion (A-family)
- Range cells: numbers face value; `TRUE` = 1; `FALSE`, text,
  numeric-looking text, blanks = 0.
- Direct scalars: booleans and numeric text coerce; non-numeric text
  -> `#VALUE!` (confirm; mirrors `MAXA`/`STDEVPA`).

## Semantics
- Sample sd: `sqrt( SUM((v_i - mean)^2) / (n-1) )` over `n` coerced
  values.
- `n < 2` -> `#DIV/0!`.

## Errors
- Fewer than 2 values after coercion (empty/1-value) -> `#DIV/0!` —
  note blanks count as values here, so a range with any cells has
  `n >= 1` regardless; a single cell -> `n=1` -> `#DIV/0!`.
- Error cells propagate.

## Examples
- `STDEVA({1;2;3})` -> `1`.
- `STDEVA(A1:A3)` with `A1=TRUE, A2="x", A3=blank` -> values 1,0,0 ->
  `0.577350269` (sd of {1,0,0}).
- `STDEVA(10)` -> `#DIV/0!`.
- `STDEVA({5;5;5})` -> `0`.

## Open questions
- Whether a single blank cell yields `#DIV/0!` (n=1 -> yes expected).
- Non-numeric direct text behavior.
