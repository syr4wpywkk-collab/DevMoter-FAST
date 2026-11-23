# SUBTOTAL

`SUBTOTAL(function_num, ref1, [ref2], ...)` — returns an aggregate
(subtotal) over the references, selectable by `function_num`.

## Arguments
- `function_num`: required integer 1-11 or 101-111. Values 1-11
  include manually-hidden rows; 101-111 exclude them.
  - 1/101 AVERAGE, 2/102 COUNT, 3/103 COUNTA, 4/104 MAX, 5/105 MIN,
    6/106 PRODUCT, 7/107 STDEV.S, 8/108 STDEV.P, 9/109 SUM,
    10/110 VAR.S, 11/111 VAR.P.
- `ref1..N`: 1..254 ranges (Excel: up to 254). Non-range scalars are
  rejected — arguments must be references/ranges.

## Behavior
- `SUBTOTAL(9, A1:A5)` sums A1:A5.
- `SUBTOTAL(109, A1:A5)` sums only visible rows (hidden-row support
  is an engine capability — see below).
- Nested SUBTOTALs inside a referenced range are ignored by the outer
  call (documented Excel behavior — confirm).
- Filtered-out rows are excluded for ALL function_nums; manually
  hidden rows are excluded only for 101-111.

## Errors
- `function_num` outside 1-11 / 101-111 -> `#VALUE!`.
- Invalid refs -> `#REF!` propagates; other errors inside ranges
  propagate per the underlying aggregate.

## Engine requirements
- Hidden-row / filter metadata in the workbook model. If no hidden
  state exists, implement 1-11 and alias 101-111 to the same behavior
  with a documented deviation — **SPEC-OPEN**.
- 3-D references and horizontal+vertical mixed shapes: range
  enumeration model must match plan.

## Open questions
- Whether 101-111 can be honored without hidden-row state.
- Error values inside ranges (propagate vs skip per function).
