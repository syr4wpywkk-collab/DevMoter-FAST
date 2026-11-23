# PERCENTILE

`PERCENTILE(array, k)` — k-th percentile of the numeric values in
`array`, inclusive linear interpolation.

Legacy compatibility function; modern equivalent is
`PERCENTILE.INC` (identical algorithm). `PERCENTILE.EXC` is a
*different* function (exclusive method, `k` restricted).

## Arguments
- `array`: required range/array; non-numeric values ignored;
  errors propagate.
- `k`: required scalar in `[0, 1]` (fraction, not percent).

## Coercion
- Range elements: text/booleans/blanks ignored; errors propagate.
- `k`: numeric text and booleans coerced; non-numeric -> `#VALUE!`.

## Semantics
- Sort n numeric values ascending; rank `r = k*(n-1)` (0-based).
- Integer `r` -> that element; else linear interpolation between
  `floor(r)` and `ceil(r)`. See `PERCENTILE.INC.md` for the full
  algorithm.

## Errors
- `k` outside `[0,1]` or empty numeric set -> `#NUM!`.
- Non-coercible `k` -> `#VALUE!`.

## Examples
- `PERCENTILE({1,3,2,4}, 0.3)` -> `1.9` (Microsoft docs example)
- `PERCENTILE({1,2,3,4,5}, 0.5)` -> `3` (equals MEDIAN)
- `PERCENTILE({1,2,3,4,5}, 0)` -> `1`; `PERCENTILE(...,1)` -> `5`
- `PERCENTILE({1,2,3}, 1.5)` -> `#NUM!`

## Open questions
- Bit-exact interpolation ordering vs Excel — see
  `PERCENTILE.INC.md` open question.
