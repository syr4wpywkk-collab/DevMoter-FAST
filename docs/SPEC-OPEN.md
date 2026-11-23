# SPEC-OPEN — undecided compatibility points

Tracked open questions. Each must be confirmed against a reference
implementation (Excel desktop/web, LibreOffice) before the behavior is
frozen. `specOpen: true` cases in `tests/fixtures/golden-phase1.json`
mirror this list.

| Fixture id | Question |
|---|---|
| GEN-005 | LEFT character counting: UTF-16 code units vs Unicode scalars (non-BMP). |
| GEN-009 / GEN-010 | Result encoding for spilled array results (`SORT`/`UNIQUE`). Semantics fixed; representation pending. |
| P1-COUNTA-010 | Is an error produced inside a COUNTA argument counted like an error cell, or propagated? |
| P1-IF-012 | Blank cell as IF condition: coerce to FALSE (expected) or `#VALUE!`? |
| P1-AND-009 | AND/OR error propagation: does `AND(FALSE,1/0)` propagate or return FALSE? (Excel evaluates all args; expected propagation — confirm.) |
| P1-NOT-008 | Blank cell coercion for NOT (expected TRUE via blank->FALSE). |
| P1-ROUND-003 / P1-ROUND-009 | ROUND at binary half-way boundaries (1.005, 2.345): record Excel/LibreOffice empirically; never derive from Rust `round` alone (plan §10.2). |
| P1-ABS-009 | Blank referenced cell coerces to 0 (expected; confirm). |
| P1-IFERROR-009 | Blank referenced cell through IFERROR returns 0 (expected; confirm). |
| P1-IFERROR-011 | Missing `value_if_error`: parse-time arity error vs default 0. |
| (COUNT, no fixture yet) | COUNT over range of error cells: skipped vs propagated — add fixture after recording. |
| (NOT, no fixture yet) | `NOT("TRUE")`: is text-form boolean coerced? Expected `#VALUE!`. |
| (ROUND, no fixture yet) | Fractional `num_digits` truncation (`ROUND(1.234,1.9)`); huge `num_digits` clamping. |
