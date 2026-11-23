# ROW

`ROW([reference])` — returns the row number(s) of a reference.

v2 plan §2 (053): row number of a reference; return shape for
multi-row references.

## Arguments
- `reference`: optional. Omitted -> row of the cell containing the
  formula (implicit caller context required).
- May be a single cell, a multi-cell range, or (in Excel) an implicit
  intersection of a range.

## Behavior
- `ROW(A5)` -> 5; `ROW()` in B3 -> 3.
- `ROW(A5:A7)` -> in Excel with dynamic arrays returns `{5;6;7}`;
  in legacy Excel implicit-intersects to a single row. Engine has no
  spill yet — **open** (see `INDEX.md` precedent; may return first
  row or `#VALUE!` meanwhile).

## Errors
- Invalid/deleted reference -> `#REF!`.
- Non-reference argument (e.g. `ROW(3)`) -> `#VALUE!` (Excel requires
  a reference; confirm error code).

## Edge cases
- Reference on another sheet -> that sheet's row numbers.
- Full-column/whole-row references unsupported engine-wide
  (`docs/SPEC-OPEN.md` item 5).

## Open questions
- Multi-cell reference return shape pending spill support.
- Omitted-argument caller context plumbing in the evaluator.
