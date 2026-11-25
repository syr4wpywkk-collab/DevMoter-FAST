# RANDARRAY

`RANDARRAY([rows], [columns], [min], [max], [whole_number])` — returns
an array of random numbers.

## Arguments
- `rows`: optional integer, default 1. `columns`: optional integer,
  default 1.
- `min`: optional lower bound, default 0.
- `max`: optional upper bound, default 1.
- `whole_number`: optional boolean; FALSE (default) -> decimals,
  TRUE -> integers.
- Integer arguments are truncated toward zero (confirm).

## Behavior
- **Volatile**: recalculates every pass; RNG lives in the workbook
  evaluation context with a seedable test mode (see `RAND.md`).
- Decimal mode: uniform in `[min, max)`.
- Integer mode: uniform integers in `[min, max]` inclusive —
  e.g. `RANDARRAY(1,1,1,10,TRUE)` produces an integer 1..10.
- `RANDARRAY(3,4)` -> 3x4 array of decimals in [0,1); spills.
- Omitted-all `RANDARRAY()` -> single decimal in [0,1).

## Errors
- `rows`/`columns` < 1 or non-integer -> `#VALUE!` (Excel: `#CALC!`
  for 0-size? — confirm; documented as `#VALUE!` for negative).
- `min` > `max` -> `#VALUE!`.
- Integer mode with `min`/`max` non-integers: bounds are... confirm
  truncation policy.
- Coercion failures -> `#VALUE!`; errors propagate.

## Compatibility
- Excel 365 / Excel 2021+ only. Requires dynamic-array spill support
  and the volatile-function machinery.

## Engine requirements
- Per-workbook RNG with injectable seed; dynamic arrays.

## Open questions
- Exact error kind for `rows`=0 (`#CALC!` vs `#VALUE!`).
- Truncation of non-integer `rows`/`columns`/`min`/`max`.
