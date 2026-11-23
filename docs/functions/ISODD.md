# ISODD

`ISODD(number)` — TRUE if `number` is odd.

v3 expansion (track S10). Paired with `ISEVEN`; identical coercion and
truncation rules.

## Arguments
- `number`: required. Standard numeric coercion (numeric text,
  booleans as 1/0 when passed as direct literals — confirm).

## Semantics
- Non-integers truncated toward zero first: `ISODD(3.9)` -> TRUE,
  `ISODD(-3.9)` -> TRUE, `ISODD(2.5)` -> FALSE.
- `ISODD(0)` -> FALSE.
- Negative odd -> TRUE: `ISODD(-3)` -> TRUE.
- Non-numeric text -> `#VALUE!`.
- Blank -> treated as 0 -> FALSE (confirm, same question as ISEVEN).

## Errors
- `#VALUE!` for non-numeric text.
- Propagates error arguments.

## Examples
- `=ISODD(3)` -> `TRUE`
- `=ISODD(4)` -> `FALSE`
- `=ISODD(-2.5)` -> `FALSE`
- `=ISODD("4")` -> `FALSE`

## Compatibility notes
- Pre-2007 Analysis ToolPak origin, now a core function.

## Open questions
- Same blank/coercion/precision questions as `ISEVEN.md`.
