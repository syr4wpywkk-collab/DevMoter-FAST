# ISERROR

`ISERROR(value)` — TRUE if `value` is any error value, **including**
`#N/A`.

v3 expansion (track S10). Consumes error arguments rather than
propagating them — the classic `IF(ISERROR(VLOOKUP(...)),...)` guard.

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- TRUE for every `CalcError` variant the engine can produce:
  `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#N/A`, `#NULL!`,
  `#SPILL!`, `#CALC!`, `#CIRC!`.
- FALSE for all non-error values including blank, `0`, `""`, `FALSE`.

## Errors
- Never errors; error argument -> TRUE.

## Edge cases
- `ISERROR(NA())` -> TRUE (this is what distinguishes it from `ISERR`).
- Prefer `IFERROR`/`IFNA` in new code; `ISERROR` is kept for legacy
  compatibility and for constructing `TRUE`/`FALSE` flags.

## Examples
- `=ISERROR(1/0)` -> `TRUE`
- `=ISERROR(NA())` -> `TRUE`
- `=ISERROR(A1)` (A1 = `"x"`) -> `FALSE`
- `=ISERROR(VLOOKUP("q",B1:C10,2,FALSE))` (no match) -> `TRUE`

## Open questions
- None beyond the shared array-evaluation question for range
  arguments.
