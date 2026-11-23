# ROUND

`ROUND(number, num_digits)` — rounds half away from zero at the given
decimal digit (Excel semantics; NOT banker's rounding).

## Behavior
- `num_digits > 0`: decimal places; `= 0`: integer; `< 0`: tens/hundreds.
- Half away from zero: `ROUND(2.5,0)=3`, `ROUND(-2.5,0)=-3`.

## Coercion / errors
- Non-numeric argument -> `#VALUE!` (direct args coerce like SUM).
- `num_digits` truncated to integer (verify) — e.g. `ROUND(1.234,1.9)`
  **SPEC-OPEN** candidate.

## Edge cases — floating point
- `ROUND(1.005,2)`: binary 1.005 ≈ 1.00499…; Excel's documented behavior
  may differ from naive IEEE rounding. Fixture P1-ROUND-009 is marked
  `specOpen`; do NOT fix the expected value from Rust `round` alone
  (plan §10.2 explicitly forbids language-default rounding as the oracle).
- `ROUND(2.345,2)=2.35` recorded with tolerance; confirm empirically.
- Very large `num_digits` (>~14) — confirm clamping behavior.

## Implementation note
`f64::round` is insufficient; a decimal-aware path (e.g. format-then-parse
or scaled integer rounding) must be validated against these fixtures.

## Confirm against reference
- Negative/huge `num_digits`, half-way binary-representation cases,
  truncation of fractional `num_digits`.
