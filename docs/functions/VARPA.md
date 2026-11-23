# VARPA

`VARPA(value1, [value2], ...)` — **population** variance with
`A`-family coercion. Legacy.

## Arguments & coercion
Same as `VARA`/`STDEVPA`.

## Semantics
- `SUM((v-mean)^2)/n`; `n = 0` values -> `#DIV/0!`; `n = 1` -> `0`.

## Errors
- No values -> `#DIV/0!`; errors propagate.

## Examples
- `VARPA({1;2;3})` -> `0.6666667`.
- `VARPA(10)` -> `0`.
- `VARPA(A1:A2)` with `A1=TRUE, A2=blank` -> {1,0} -> `0.25`.
- `VARPA({5;5;5})` -> `0`.

## Open questions
- Same A-family direct-text question.
