# RANK.AVG

`RANK.AVG(number, ref, [order])` — rank of `number` in `ref`; ties get
the **average** rank. Excel 2010+; contrast `RANK.EQ` (best rank for
ties; see `RANK.EQ.md`).

## Arguments
- `number`: required; value to rank. Need not exist in `ref`? — Excel
  requires it to be present? (`#N/A` if `number` not found — confirm;
  `RANK.EQ` errors `#N/A` when absent).
- `ref`: required range/array; non-numeric cells ignored.
- `order`: optional; `0`/omitted = descending (largest = rank 1);
  nonzero = ascending.

## Semantics
- Descending: rank = 1 + count(values > number) + 0.5*(ties-1) for
  tied values — i.e., the average of positions the tied group would
  occupy.
- Ascending mirrors with `<`.
- `number` not present in `ref` -> `#N/A` (expected; confirm).

## Errors
- `number` non-numeric -> `#N/A`? or `#VALUE!` (confirm).
- Empty `ref` -> `#N/A`.
- Error cells in `ref` propagate? — aggregates ignore? `RANK.*` docs
  say nonnumeric ignored; error propagation expected (confirm).

## Examples
- `RANK.AVG(7, {9;8;7;7;6})` -> `3.5` (two 7s at ranks 3,4 avg).
- `RANK.AVG(2, {1;2;3}, 1)` -> `2`.
- `RANK.AVG(6, {9;8;7;7;6})` -> `5`.
- `RANK.AVG(10, {1;2;3})` -> `#N/A` (absent).

## Open questions
- `number` absent behavior confirmation.
- Boolean `order` coercion (`TRUE` = ascending — nonzero, yes).
