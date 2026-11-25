# VARA

`VARA(value1, [value2], ...)` — **sample** variance with `A`-family
coercion (`TRUE`=1, `FALSE`/text/blank=0 in ranges). Legacy.

## Arguments & coercion
Same as `STDEVA`: range cells coerced (TRUE=1; FALSE/text/blank=0);
direct scalars coerce; error cells propagate.

## Semantics
- `SUM((v-mean)^2)/(n-1)`; `n < 2` -> `#DIV/0!`.

## Errors
- `n < 2` after coercion -> `#DIV/0!`; non-numeric direct text ->
  `#VALUE!` (confirm); errors propagate.

## Examples
- `VARA({1;2;3})` -> `1`.
- `VARA(A1:A3)` with `A1=TRUE, A2="x", A3=blank` -> {1,0,0} ->
  `0.333333` (sample var of {1,0,0} = 1/3).
- `VARA(5)` -> `#DIV/0!`.
- `VARA({5;5;5})` -> `0`.

## Open questions
- Direct non-numeric text: error vs 0 (same A-family question).
