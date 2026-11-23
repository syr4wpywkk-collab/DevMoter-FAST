# NA

`NA()` — returns the `#N/A` error value.

v3 expansion (track S10).

## Arguments
- None. Zero-arity; `NA(x)` is an arity error.

## Semantics
- Produces the literal `#N/A` error. Used to mark "no data" cells so
  charts skip them and lookups visibly fail.
- Not volatile — `NA()` is constant; no recalc dependency needed.

## Errors
- Always returns `#N/A` (that IS its result, not a failure).
- Arity error if called with arguments.

## Interaction notes
- `ISNA(NA())` -> TRUE, `ISERROR(NA())` -> TRUE,
  `ISERR(NA())` -> FALSE, `N(NA())` -> `#N/A`.
- `#N/A` propagates through arithmetic like other errors:
  `NA()+1` -> `#N/A`.

## Examples
- `=NA()` -> `#N/A`
- `=IF(A1="",NA(),A1)` (A1 empty) -> `#N/A`
- `=ISERROR(NA())` -> `TRUE`
- `=NA()+5` -> `#N/A`

## Open questions
- None.
