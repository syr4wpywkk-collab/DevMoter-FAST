# ISNA

`ISNA(value)` — TRUE if `value` is the `#N/A` error specifically.

v3 expansion (track S10). Consumes the error argument rather than
propagating it (same family as `ISERROR`/`ISERR`).

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- `ISNA(#N/A)` -> TRUE; `ISNA(NA())` -> TRUE.
- Any other error -> FALSE: `ISNA(1/0)` -> FALSE.
- Non-error values -> FALSE.

## Errors
- Never errors itself.

## Edge cases
- Idiomatic lookup guard: `IF(ISNA(MATCH(...)), "not found", ...)`.
  `IFNA` covers the same use with less nesting.
- Distinguishing `#N/A` produced by `NA()` vs propagated from a
  lookup: none — both are the same error value.

## Examples
- `=ISNA(NA())` -> `TRUE`
- `=ISNA(1/0)` -> `FALSE`
- `=ISNA(VLOOKUP("q",B1:C10,2,FALSE))` (no match) -> `TRUE`
- `=ISNA(0)` -> `FALSE`

## Open questions
- None.
