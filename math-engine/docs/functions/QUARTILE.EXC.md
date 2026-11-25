# QUARTILE.EXC

`QUARTILE.EXC(array, quart)` — quartile using the **exclusive**
method. Excel 2010+; contrast `QUARTILE.INC` (legacy `QUARTILE`).

## Arguments
- `array`: required.
- `quart`: required; integer `1`, `2`, or `3` only (`0`/`4` allowed by
  `.INC` are **invalid** here — `quart < 1` or `> 3` -> `#NUM!`).
  Truncated to integer? (confirm).

## Semantics
- `QUARTILE.EXC(array, q) = PERCENTILE.EXC(array, q/4)`.
- Same interpolation, coercion, and out-of-range `#NUM!` rules as
  `PERCENTILE.EXC` — notably small arrays (`n < 3` for `quart=1`/`3`)
  produce `#NUM!` where `.INC` returns a value.

## Errors
- `quart` not in `{1,2,3}` -> `#NUM!`.
- Empty array / insufficient `n` -> `#NUM!`.
- Non-numeric `quart` -> `#VALUE!`.

## Examples
- `QUARTILE.EXC({1;2;3;4;5;6;7;8;9;10;11}, 1)` -> `3` (h = 12/4).
- `QUARTILE.EXC({1;2;3;4;5;6;7;8;9;10;11}, 3)` -> `9`.
- `QUARTILE.EXC({1;2;3;4}, 1)` -> `1.25` (h = 1.25).
- `QUARTILE.EXC({1;2}, 1)` -> `#NUM!` (h = 0.75 out of range).
- `QUARTILE.EXC({1;2;3;4;5}, 0)` -> `#NUM!`.

## Open questions
- Truncation of non-integer `quart` (expected, same as `.INC`).
