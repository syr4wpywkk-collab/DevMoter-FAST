# LOG

`LOG(number, [base])` — logarithm of `number` in the given base.

## Arguments
- `number`: required, coerced per direct-scalar rules (numeric text and
  booleans coerce; non-numeric text -> `#VALUE!`; blank -> 0).
- `base`: optional, default `10`; same coercion.

## Computation
- `ln(number) / ln(base)`; `f64::ln` is fine, fixtures bound accuracy.
- `LOG(100)` -> `2`; `LOG(8,2)` -> `3`.

## Errors
- `number <= 0` -> `#NUM!`.
- `base <= 0` -> `#NUM!`.
- `base = 1` -> `#NUM!` (Excel behavior — confirm; `LOG(x,1)` is
  `#DIV/0!` in some references — **SPEC-OPEN** the exact error kind).
- Errors propagate.

## Edge cases
- `LOG(1, b)` -> `0` for any valid base.
- `number`/`base` exactly at FP boundaries (e.g. base `1 + eps`).
- Very large/small magnitudes — `ln` handles subnormals.

## Open questions
- Exact error for `base = 1` (`#NUM!` vs `#DIV/0!`).
- Whether `base = 0`/negative shares `#NUM!` (expected yes).
