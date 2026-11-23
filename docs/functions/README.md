# Phase 1 function specifications

One document per Phase 1 function (implementation plan §6). Each records:
signature, argument handling, type-coercion rules, blank/empty-string/text
treatment, error conditions, edge cases, and the points that must be
confirmed against a reference implementation (Excel / LibreOffice) before
the behavior is frozen — these are tagged **SPEC-OPEN** and tracked in
`docs/SPEC-OPEN.md`.

General coercion model assumed below (confirm per function where flagged):

- **Range arguments** (e.g. `A1:A10`): text cells (including numeric-looking
  text), boolean cells, and blank cells are *ignored* by the aggregating
  Phase 1 functions. Error cells *propagate*.
- **Direct scalar arguments** (e.g. `SUM("3", TRUE)`): numeric-looking text
  and booleans are *coerced* to numbers; non-numeric text yields `#VALUE!`.
- `Blank` (empty cell) and `Text("")` (empty string) are distinct values
  (plan §3.1) and are treated differently by `COUNTA`/`IF`.
