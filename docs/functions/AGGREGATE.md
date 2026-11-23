# AGGREGATE

`AGGREGATE(function_num, options, ref1, [ref2], ...)` — **reference
form** — applies one of 19 aggregate functions to ranges while
optionally ignoring hidden rows, nested subtotals, and errors.

`AGGREGATE(function_num, options, array, [k])` — **array form** — used
by `function_num` 14–19 which take an extra `k`/`quart` parameter.

## Arguments
- `function_num`: 1–19, required. `1` AVERAGE, `2` COUNT, `3` COUNTA,
  `4` MAX, `5` MIN, `6` PRODUCT, `7` STDEV.S, `8` STDEV.P, `9` SUM,
  `10` VAR.S, `11` VAR.P, `12` MEDIAN, `13` MODE.SNGL, `14` LARGE,
  `15` SMALL, `16` PERCENTILE.INC, `17` QUARTILE.INC,
  `18` PERCENTILE.EXC, `19` QUARTILE.EXC.
- `options`: 0–7, required. Bitmask-like ignore flags:
  `0` ignore nested SUBTOTAL/AGGREGATE; `1` also ignore hidden rows;
  `2` also ignore error values; `3` ignore all three; `4` ignore
  nothing; `5` ignore hidden rows; `6` ignore error values;
  `7` ignore hidden rows and errors. (Nested SUBTOTAL/AGGREGATE are
  ignored in options 0–3; 4–7 do not ignore them.)
- `ref1`, `ref2`, ...: 1–253 range references (reference form).
  Values/arrays are accepted in the array form only; 3-D references
  cause `#VALUE!`.
- `k`: required for `function_num` 14–19: rank for LARGE/SMALL,
  percentile `0..1` for PERCENTILE.*, quartile `0..4` for
  QUARTILE.INC / `0<q<4` for QUARTILE.EXC.

## Semantics
- Reference form: `AGGREGATE(9, 6, A1:A10)` sums numeric cells in
  `A1:A10` skipping cells containing errors.
- Array form: `AGGREGATE(14, 6, A1:A10, 2)` = second largest
  non-error value.
- "Hidden rows" means rows hidden by the Hide command or filtered out
  by AutoFilter; hidden *columns* are never ignored.

## Engine requirements
- Requires row-hidden/filtered state to be visible to the evaluator
  (options 1,3,5,7). If the engine has no hidden-row model, implement
  only options 0,2,4,6 and document the limitation.
- Depends on 19 other functions existing first; spec each option as a
  wrapper over the corresponding function's semantics.

## Coercion and errors
- `function_num`/`options`/`k`: numeric coercion, truncated toward
  zero? (**SPEC-OPEN**: Excel truncates non-integer `function_num` —
  confirm) — non-numeric -> `#VALUE!`.
- `function_num` outside 1–19 -> `#VALUE!`; `options` outside 0–7 ->
  `#VALUE!`.
- Missing `k` for `function_num` 14–19 -> `#VALUE!`; a supplied 4th
  arg for `function_num` 1–13 is ignored? (**SPEC-OPEN** — confirm:
  docs say "returns a #VALUE! error" for missing k only).
- Underlying function errors surface after option filtering (e.g.
  `MEDIAN` over an empty set -> `#NUM!`).

## Examples
| Formula | Result |
|---|---|
| `=AGGREGATE(9,4,A1:A3)` with 1,2,3 | 6 |
| `=AGGREGATE(4,6,A1:A3)` with 1,#DIV/0!,3 | 3 |
| `=AGGREGATE(14,4,{10;20;30},2)` | 20 |

## Compatibility
- **Excel 2010+** (`_xlfn.AGGREGATE` for older files). Replaces most
  uses of `SUBTOTAL` which only offers 11 functions and always
  ignores filtered rows.

## Open questions
- Truncation of non-integer `function_num`/`options`/`k`.
- Whether a 4th argument for `function_num` 1–13 is ignored or errors.
- "Hidden rows" source-of-truth in an engine without a view layer.
- Behavior of `k` out of range for LARGE/SMALL (`#NUM!` expected).
