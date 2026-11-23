# RANK.EQ

`RANK.EQ(number, ref, [order])` — returns the rank of `number` within
the numeric values of `ref`; ties share the best rank.

## Arguments
- `number`: the value to rank; must be numeric (coerced per direct-arg
  rules) and present-or-comparable within `ref`.
- `ref`: range/array of candidates; non-numeric values ignored.
- `order`: optional. 0/omitted -> descending (largest is rank 1);
  nonzero -> ascending.

## Behavior
- Ties get the same (best) rank; the next distinct value skips:
  `{10,10,5}` descending -> ranks 1,1,3.
- `number` not among the values -> `#N/A` (Excel behavior).

## Errors
- `#N/A` when `number` is absent from `ref` (or `ref` has no numbers).
- `#VALUE!` for non-numeric `number`.

## Edge cases
- Empty numeric `ref` -> `#N/A`.
- `RANK.EQ` uses exact equality of f64 values for membership —
  floating-point near-misses are `#N/A` (document; see open question).

## Open questions
- Whether membership uses bit equality or an epsilon — Excel uses exact
  comparisons; verify with a fixture like `RANK.EQ(0.1+0.2,{0.3})`.
