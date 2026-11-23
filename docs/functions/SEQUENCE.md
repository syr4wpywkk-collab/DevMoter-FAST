# SEQUENCE

`SEQUENCE(rows, [columns], [start], [step])` — returns a spilled array
of sequential numbers.

## Arguments
- `rows`, `columns`: counts; defaults 1. Truncated to integers; must be
  >= 1.
- `start`: default 1. `step`: default 1.
- All four coerce to numbers; non-numeric -> `#VALUE!`.

## Behavior
- Fills row-major: `SEQUENCE(2,3,1,1)` -> `[[1,2,3],[4,5,6]]`.
- Negative `step` allowed: `SEQUENCE(3,1,10,-2)` -> `[[10],[8],[6]]`.
- Result is a spilled dynamic array (see Spill semantics).

## Spill semantics
- Spills into `rows` x `columns` cells. If any target cell is non-blank,
  the whole call returns `#SPILL!` and nothing is written (atomic).
- Output is bounded by the engine's per-array cell limit (plan §3: 配列
  セル数上限); exceeding it -> `#SPILL!` (or `#NUM!` — see open
  question).

## Errors
- `#VALUE!` for non-numeric args; `#NUM!`/limit error for `rows` or
  `columns` < 1 or exceeding the size cap.

## Open questions
- Error type when the result exceeds the array-size cap (`#SPILL!`,
  `#NUM!`, or a dedicated limit error — consistent with SPEC-OPEN item 6
  on array-limit error kinds).
- Whether fractional `rows`/`columns` truncate (Excel truncates;
  verify).
