# UNIQUE

`UNIQUE(array, [by_col], [exactly_once])` — returns the distinct rows (or columns) of `array` in order of first occurrence. Spilled result.

## Arguments
- `array`: range or array.
- `by_col`: optional boolean; FALSE (default) deduplicates rows, TRUE
  deduplicates columns.
- `exactly_once`: optional boolean; TRUE returns only items occurring
  exactly once; default FALSE returns each distinct item once.

## Result shape & spill
- Result is `u x cols(array)` (or `rows(array) x u` with `by_col`)
  where `u` = number of surviving items; spills like `FILTER` —
  `#SPILL!` on obstruction, resize releases the old range first.
- `exactly_once` with no survivors returns `#CALC!` in Excel (empty
  array) — **SPEC-OPEN** whether this engine returns `#CALC!` or an
  empty spill.
- Order: first-occurrence order is preserved (Excel behavior).

## Equality rules
- Row identity = elementwise equality across all columns.
- Numbers compare by value; text compares **case-insensitively**
  (Excel behavior — confirm) so `"A"` and `"a"` are duplicates; the
  **first** occurrence's value is emitted.
- Booleans equal only same booleans; number `1` != TRUE (type matters).
- Blank vs `""`: Excel treats blank and empty string as equal in
  `UNIQUE` — **SPEC-OPEN** (verify; the data model distinguishes them).
- Error elements: compared by error kind? Excel propagates each
  distinct error? — **SPEC-OPEN**: simplest consistent rule is that
  errors compare equal iff same error kind and are emitted as values.

## Errors
- Argument coercion errors -> `#VALUE!`.
- `#SPILL!` on obstruction; `#CALC!` on empty `exactly_once` result.

## Edge cases
- Single cell -> same single cell.
- All duplicates -> first occurrence only.
- `by_col=TRUE` on a 1-column array -> unchanged.

## Open questions
- Case-insensitivity of text equality (expected insensitive).
- Blank vs `""` equivalence.
- Error deduplication rule.
- Empty-result representation.
