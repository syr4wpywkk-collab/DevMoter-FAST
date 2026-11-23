# TRIMMEAN

`TRIMMEAN(array, percent)` — mean of the interior after excluding
`percent/2` of data points from each tail.

## Arguments
- `array`: required range/array.
- `percent`: required; `0 <= percent < 1` else `#NUM!` (docs: `<0` or
  `>=1` -> `#NUM!`).

## Semantics
- `n` numeric values sorted; number excluded per tail =
  `floor(n * percent / 2)`? — Excel docs: count excluded is
  `n*percent` rounded **down to nearest even** then split between
  tails: `k = 2*floor(n*p/2)`? Documented: "number of excluded data
  points is n*percent rounded down to the nearest multiple of 2".
  So each tail drops `floor(n*p/2)`? — verify: for n=10, p=0.2 ->
  excluded total 2 -> one per tail.
- Result is the arithmetic mean of remaining values.

## Coercion
- Standard aggregate rules: range text/boolean/blank ignored; direct
  scalars coerce; error cells propagate.

## Errors
- `percent < 0` or `>= 1` -> `#NUM!`.
- All values trimmed (n*p >= n handled by even-rounding — can't fully
  empty for p<1? if it could, `#DIV/0!`).
- No numeric values -> `#DIV/0!`? (confirm).
- Non-numeric `percent` -> `#VALUE!`.

## Examples
- `TRIMMEAN({4;5;6;7;2;3;4;5;1;2;3}, 0.2)` -> `3.777778` (Excel doc
  example: trims 2 values -> mean of 9 = `3.777778`).
- `TRIMMEAN({1;2;3;4;100}, 0)` -> `22` (plain mean).
- `TRIMMEAN({1;2;3;4;5}, 0.4)` -> `3` (drop 1 per tail).
- `TRIMMEAN({1;2;3}, 1)` -> `#NUM!`.

## Open questions
- Exact rounding rule for the excluded count (verify vs doc wording).
- Empty-after-trim behavior.
