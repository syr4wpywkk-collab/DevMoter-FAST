# MOD

`MOD(number, divisor)` — returns the remainder after division, with the
sign of `divisor`.

v2 plan §2 (040): divisor zero, sign convention for negatives matches
Excel; do NOT use Rust `%` directly.

## Arguments
- `number`, `divisor`: numeric scalars, coerced per the direct-argument
  model (numeric text, booleans coerce; other text -> `#VALUE!`;
  blank -> 0).

## Behavior
- Result = `number - divisor * floor(number / divisor)` (Excel
  semantics; result sign follows `divisor`).
- `MOD(3, 2)` -> 1; `MOD(-3, 2)` -> 1; `MOD(3, -2)` -> -1;
  `MOD(-3, -2)` -> -1.
- Non-integer inputs work: `MOD(5.5, 2)` -> 1.5.

## Errors
- `divisor` = 0 -> `#DIV/0!`.
- Coercion failures -> `#VALUE!`.
- Error inputs propagate.

## Edge cases
- Very large `number` with small `divisor`: floating-point floor
  division loses precision — e.g. `MOD(1e17+0.5, 3)`; document
  tolerance in fixtures (Excel itself is imprecise here).
- `MOD(0, x)` -> 0.
- Negative zero result: Excel displays `0`; normalize `-0.0` to `0.0`.

## Open questions
- Confirm formula form `n - d*floor(n/d)` vs alternative that avoids
  intermediate rounding for large magnitudes.
- `-0.0` normalization policy shared with other math functions.
