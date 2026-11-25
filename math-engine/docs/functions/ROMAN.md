# ROMAN

`ROMAN(number, [form])` — converts an Arabic numeral to Roman numeral
as text.

## Arguments
- `number`: required integer in [0, 3999]; non-integers are truncated
  toward zero.
- `form`: optional integer/boolean 0..4 (or TRUE=0, FALSE=4)
  selecting conciseness of the Roman representation:
  - 0/TRUE/omitted: classic form
  - 1: more concise; 2: more concise; 3: more concise
  - 4/FALSE: simplified
  Non-integer `form` is truncated (confirm).

## Behavior
- `ROMAN(499)` -> "CDXCIX" (form 0); form 4 gives "ID".
- `ROMAN(2013)` -> "MMXIII"; `ROMAN(0)` -> "" (empty string — Excel
  returns "" for 0; confirm).
- Negative-style forms only affect subtraction rules, never sign.

## Errors
- `number` < 0 or > 3999 -> `#VALUE!`.
- `form` < 0 or > 4 -> `#VALUE!`.
- Coercion failures -> `#VALUE!`; errors propagate.

## Compatibility
- Legacy function; Roman numeral table is deterministic, no engine
  requirements.

## Open questions
- Exact mappings for forms 1-3 on boundary values (e.g. 999, 1999) —
  build from Microsoft's documented table and pin in fixtures.
- `ROMAN(0)` empty-string result vs error.
