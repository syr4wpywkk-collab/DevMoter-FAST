# PERCENTRANK.INC

`PERCENTRANK.INC(array, x, [significance])` — rank of `x` as an
inclusive percentage `rank/(n-1)`. Excel 2010+; legacy `PERCENTRANK`.

## Arguments
Same as `PERCENTRANK.EXC` (`array`, `x`, `[significance=3]`).

## Semantics
- `r` = count of values `< x`; position `p = r` (0-based) over `n-1`:
  `PERCENTRANK.INC = p/(n-1)` for exact match.
- Interpolates linearly between adjacent values when `x` is not in the
  array.
- `x` at min -> `0`; at max -> `1`. Outside `[min,max]` -> `#N/A`.
- `n = 1` single value: `x` equal -> `0`? or `#DIV/0!` (n-1=0) —
  Open question.

## Errors
- `x` outside data range -> `#N/A`; `significance < 1` -> `#NUM!`.
- Empty array -> `#N/A` (confirm).
- Non-numeric scalar -> `#VALUE!`/`#N/A` (confirm).

## Examples
- `PERCENTRANK.INC({13;12;11;8;4;3;2;1;1;1}, 2)` -> `0.333` (Excel doc
  example; r=3, n=10 -> 3/9).
- `PERCENTRANK.INC({1;2;3;4;5}, 3)` -> `0.5`.
- `PERCENTRANK.INC({1;2;3;4;5}, 5)` -> `1`.
- `PERCENTRANK.INC({1;2;3;4;5}, 6)` -> `#N/A`.

## Open questions
- Duplicate first-vs-last matching rank.
- Round vs truncate at `significance` digits.
- Single-element array behavior.
