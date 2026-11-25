# DSTDEV

`DSTDEV(database, field, criteria)` — returns the sample standard deviation in the column `field`
of `database`, restricted to rows matching `criteria`.

v3 expansion (track S10). Database-function family; all D* functions
share the argument model below.

## Shared argument model
- `database`: rectangular range **including a header row**; each
  column's header labels the field, data rows follow.
- `field`: column to aggregate. Either text matching a column header
  (case-insensitive — confirm), e.g. `"Height"`, or a 1-based column
  index within `database`. Unknown label or out-of-range index ->
  `#VALUE!`.
- `criteria`: range with >= 1 header row and >= 1 criteria row.
  Header cells must match database column labels; an unmatched
  criteria header -> `#VALUE!` (confirm exact error).
  - Multiple criteria in the **same row** -> AND; criteria in
    **different rows** -> OR.
  - A blank criteria cell imposes no constraint; a criteria block
    with no effective constraint matches all data rows (confirm).
  - Text criteria match as **prefixes** in Excel (`"App"` matches
    `"Apple"`) — documented quirk, distinct from `SUMIF` equality;
    confirm.
  - Comparison prefixes `=` `<>` `>` `>=` `<` `<=` apply to numbers
    and text; `=` followed by anything is also the *computed
    criterion* syntax (formula evaluated per data row in database
    context) — engine capability flag below.
  - Wildcards `?`/`*` in text criteria — support level confirm.

## Engine requirements
- Computed criteria (criteria cells whose content is a formula such
  as `=A2>10`) require evaluating a formula once per candidate row in
  the context of the database range — phased capability.

## Layout used in examples
`A1:C5` = headers `Tree, Height, Age`; rows:
`Apple,18,20`; `Pear,12,12`; `Cherry,13,14`; `Apple,10,15`.
Criteria block `E1:E2` = `Tree` / `Apple` (matches rows 2 and 5);
`E1:F2` = `Tree,Height` / `Apple,18` (matches row 2 only);
`G1:G2` = `Tree` / `Fig` (matches nothing).

## Open questions
- Prefix vs exact text match in criteria (expected prefix — known
  Excel quirk).
- Computed/formula criteria support and per-row evaluation context.
- Wildcard support in criteria text.
- Exact error codes for unmatched criteria headers, and whether
  error cells inside *non-matching* database rows are ignored.
- Whether `field` label matching trims whitespace / is
  case-insensitive (expected insensitive).

## Function-specific semantics
Sample standard deviation (n-1 denominator) of numeric `field`
cells over matching rows. Mirrors `STDEV.S`.
- Fewer than 2 numeric cells in the matched set -> `#DIV/0!`.

## Errors
- Invalid `field` (unknown label / out-of-range index) -> `#VALUE!`.
- Unmatched criteria header -> `#VALUE!` (confirm).
- Error cells inside matching database rows propagate (confirm);
  errors in non-matching rows are ignored (confirm).
- Match-count / empty-set conditions per semantics above.

## Examples
- `=DSTDEV(A1:C5,"Age",E1:E2)` -> stdev.s(20,15) = `3.53553390593274`
- `=DSTDEV(A1:C5,"Age",E1:F2)` -> single value -> `#DIV/0!`
- `=DSTDEV(A1:C5,2,G1:G2)` -> `#DIV/0!`
- `=DSTDEV(A1:C5,"Bad",E1:E2)` -> `#VALUE!`

## Compatibility notes
- Excel heritage back to Excel 5 / Lotus-style database functions;
  semantics unchanged in modern Excel. `SUMIFS`-family functions are
  the modern replacement for most uses, but D* criteria *ranges*
  still have no direct equivalent.
