# IFERROR

`IFERROR(value, value_if_error)` — evaluates `value`; if it produces any
error, returns `value_if_error` instead. Lazy: `value_if_error` only
evaluated on error.

## Caught errors
All engine error codes: `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`,
`#N/A`, `#NULL!`, `#SPILL!`, `#CALC!`, `#CIRC!` — confirm Excel catches
each (in particular `#SPILL!`/`#CALC!` are catchable in Excel).

## Behavior
- Non-error `value` -> returned as-is (including blank/text/boolean).
- Nested `IFERROR` works (P1-IFERROR-010).
- Errors in `value_if_error` propagate (it is itself a normal expression).

## Edge cases
- `IFERROR(A1,"f")` with blank A1 -> `0` (blank->0, not an error;
  specOpen P1-IFERROR-009 to confirm the 0 coercion).
- **SPEC-OPEN** (P1-IFERROR-011): `IFERROR(1/0)` missing second arg —
  Excel may reject at parse time (too few args); do not assume 0.

## Confirm against reference
- Arity rule, `#N/A` vs `IFNA` distinction (IFERROR catches more),
  catchability of every error code.
