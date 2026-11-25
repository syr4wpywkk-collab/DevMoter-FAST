# ISEVEN

`ISEVEN(number)` — TRUE if `number` is even.

v3 expansion (track S10). Paired with `ISODD`.

## Arguments
- `number`: required. Coerced via the standard numeric coercion:
  numeric text `"4"` -> 4, `TRUE` -> 1, `FALSE` -> 0 (confirm direct
  literal coercion rules vs cell-value rules in `common/coercion`).

## Semantics
- Non-integer arguments are **truncated** toward zero before the
  parity test: `ISEVEN(2.9)` -> TRUE, `ISEVEN(-2.9)` -> TRUE
  (truncation, not rounding — `ISEVEN(2.5)` -> TRUE because
  trunc(2.5)=2).
- Negative even numbers -> TRUE: `ISEVEN(-4)` -> TRUE.
- `ISEVEN(0)` -> TRUE.
- Non-numeric text -> `#VALUE!`: `ISEVEN("abc")` -> `#VALUE!`.
- Blank argument / blank cell reference: Excel treats blank as 0 ->
  TRUE (confirm).

## Errors
- `#VALUE!` for non-numeric text.
- Propagates error arguments.

## Edge cases
- `ISEVEN(TRUE)` -> FALSE (coerces to 1, odd) — confirm; Excel help
  documents logicals as coercible.
- `ISEVEN(4.99999)` -> TRUE (truncation, not round-half).
- Very large magnitudes: parity of `2^53+1` is unrepresentable in f64
  — note precision limit, expected truncation then parity of the f64
  value.

## Examples
- `=ISEVEN(4)` -> `TRUE`
- `=ISEVEN(3)` -> `FALSE`
- `=ISEVEN(-2.5)` -> `TRUE`
- `=ISEVEN("six")` -> `#VALUE!`

## Compatibility notes
- Legacy function (pre-2007 Analysis ToolPak origin); in modern Excel
  the parity branch is usually written `MOD(n,2)=0`. Keep for
  compatibility.

## Open questions
- Blank argument handling (blank-as-0 vs arity error).
- Whether the parity test uses trunc toward zero on the coerced f64
  (expected; matches ISODD docs).
