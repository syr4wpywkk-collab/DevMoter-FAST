# ISERR

`ISERR(value)` — TRUE if `value` is any error value **except** `#N/A`.

v3 expansion (track S10). Unlike most IS functions, `ISERR` does NOT
propagate error arguments — it inspects them.

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- `ISERR(#DIV/0!)` -> TRUE. Same for `#VALUE!`, `#REF!`, `#NAME?`,
  `#NUM!`, `#NULL!`, and (presumably) newer errors such as `#SPILL!`,
  `#CALC!`, `#CIRC!` — see Open questions.
- `ISERR(#N/A)` -> **FALSE** — this is the sole excluded error.
- Non-error values -> FALSE: `ISERR(0)` -> FALSE,
  `ISERR("")` -> FALSE, `ISERR(blank)` -> FALSE,
  `ISERR(TRUE)` -> FALSE.

## Errors
- Never errors itself; an error argument is consumed and reported as
  TRUE (except `#N/A` -> FALSE).

## Edge cases
- The pair `ISERR`/`ISERROR` historically guards lookups:
  `IF(ISERR(x), ...)` catches hard errors while letting `#N/A`
  through — the inverse of the `IFNA`/`IFERROR` split.
- Error inside an array element: whether array-mode `ISERR` is
  elementwise depends on array/spill support (Open question, shared
  with the whole IS family).

## Examples
- `=ISERR(1/0)` -> `TRUE`
- `=ISERR(NA())` -> `FALSE`
- `=ISERR("text")` -> `FALSE`
- `=ISERR(#REF!)` -> `TRUE`

## Open questions
- Treatment of error types added after the function was defined
  (`#SPILL!`, `#CALC!`, `#BLOCKED!`, `#CONNECT!`, `#UNKNOWN!`,
  `#FIELD!`): expected TRUE (only `#N/A` is excluded) — confirm
  against a modern Excel reference.
