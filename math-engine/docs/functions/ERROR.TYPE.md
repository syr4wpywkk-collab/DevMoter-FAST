# ERROR.TYPE

`ERROR.TYPE(error_val)` — returns a number identifying the error type
of `error_val`, or `#N/A` if the argument is not an error.

v3 expansion (track S10). Legacy function; mostly superseded by
`IFERROR`/`IFNA` + `ISERROR`/`ISERR`/`ISNA` guards.

## Arguments
- `error_val`: any scalar or expression result.

## Return codes (documented mapping)
| Code | Error |
|---:|---|
| 1 | `#NULL!` |
| 2 | `#DIV/0!` |
| 3 | `#VALUE!` |
| 4 | `#REF!` |
| 5 | `#NAME?` |
| 6 | `#NUM!` |
| 7 | `#N/A` |
| 8 | `#GETTING_DATA` (Excel-internal busy state; unlikely to arise in
  this engine — note only) |

## Semantics
- If `error_val` is NOT an error -> `#N/A`. Notably `ERROR.TYPE` does
  not return FALSE or 0; it errors with `#N/A`, so it composes
  awkwardly (`IFNA(ERROR.TYPE(x),0)` for a "no error" sentinel).
- If `error_val` is an error not in the table (`#SPILL!`, `#CALC!`,
  `#CIRC!`, `#BLOCKED!`, etc.) -> presumably `#N/A` — **open
  question**; the documented list predates dynamic-array errors.

## Errors
- Returns `#N/A` for non-error input — this is a *result*, not a
  propagated failure.

## Examples
- `=ERROR.TYPE(1/0)` -> `2`
- `=ERROR.TYPE(NA())` -> `7`
- `=ERROR.TYPE(5)` -> `#N/A`
- `=ERROR.TYPE(#REF!)` -> `4`

## Open questions
- Code (or `#N/A` result) for post-Excel-2007 error values.
- Whether the engine needs a `#GETTING_DATA`/`#CIRC!` mapping at all.
