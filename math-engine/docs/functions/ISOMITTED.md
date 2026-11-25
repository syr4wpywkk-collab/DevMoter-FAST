# ISOMITTED

`ISOMITTED(argument)` — TRUE if an optional parameter of an enclosing
`LAMBDA` was omitted by the caller.

v3 expansion (track S10). Introduced in Excel 2024/365; only
meaningful inside a `LAMBDA` body where `argument` is one of the
lambda's parameter names.

## Engine requirements
- Requires `LAMBDA` (already scoped) plus the ability for the
  evaluator to distinguish "parameter bound to a value" from
  "parameter position not supplied by the caller" — optional lambda
  parameters are a new capability (`LAMBDA(x,[y],...)` optional-arg
  syntax). If optional lambda parameters are not supported,
  `ISOMITTED` should parse but always return `#VALUE!`/`#NAME?`
  outside its context (open question).

## Arguments
- `argument`: must be a parameter name of the immediately enclosing
  `LAMBDA`. Any other expression is invalid.

## Behavior
- `LAMBDA(x,[y],ISOMITTED(y))(5)` -> TRUE (y not supplied).
- `LAMBDA(x,[y],ISOMITTED(y))(5,10)` -> FALSE.
- `ISOMITTED` used outside a `LAMBDA` -> `#VALUE!` (confirm; Microsoft
  docs describe it as LAMBDA-helper; exact error type unconfirmed).
- `ISOMITTED(name)` where `name` is not a lambda parameter -> error
  (type unconfirmed — likely `#VALUE!` or `#NAME?`).

## Errors
- Error when not lexically inside a LAMBDA (exact type unconfirmed).
- Error when `argument` is not a declared parameter of the enclosing
  lambda (unconfirmed type).

## Examples
- `=LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(3)` -> `3`
- `=LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(3,4)` -> `7`
- `=LAMBDA([a],[b],[c],ISOMITTED(b))(1,,3)` -> `TRUE` (middle
  parameter omitted while later one supplied — confirm that Excel
  allows skipping optional args positionally with empty argument
  slots)

## Compatibility notes
- New (Excel 365/2024). No pre-dynamic-array equivalent.

## Open questions
- Exact error values for misuse (outside LAMBDA, non-parameter name).
- Whether omitted trailing args vs explicitly-passed empty slots
  differ semantically.
- Interaction with named-lambda (Name Manager) calls — presumably
  identical.
