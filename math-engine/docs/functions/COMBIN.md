# COMBIN

`COMBIN(number, number_chosen)` — number of combinations (binomial
coefficient) of `number` items taken `number_chosen` at a time,
without repetition and without regard to order.

## Arguments
- `number`: total items `n`, required. Non-integer values are
  **truncated** to integers (documented).
- `number_chosen`: subset size `k`, required, truncated likewise.

## Semantics
- `COMBIN(n,k) = n! / (k! * (n-k)!)`.
- `COMBIN(8,2)` -> `28`; `COMBIN(8,0)` -> `1`; `COMBIN(0,0)` -> `1`.
- Must be computed stably (multiplicative or gcd-reduced), not via
  raw `FACT` — `COMBIN(2000,2)` is valid (1,999,000) even though
  `2000!` overflows.

## Coercion
- Numeric coercion; non-numeric -> `#VALUE!`. Truncation toward zero
  for fractional args (confirm negative-fraction truncation direction:
  `COMBIN(8.9,2)` -> `28` documented via truncation).

## Errors
- `n < 0`, `k < 0`, or `k > n` (after truncation) -> `#NUM!`.
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=COMBIN(8,2)` | 28 |
| `=COMBIN(8,3)` | 56 |
| `=COMBIN(4.9,1)` | 4 |

## Compatibility
- All Excel versions. See `COMBINA` (2013, with repetition).

## Open questions
- Upper bound before `#NUM!` (large `n` where result overflows f64 —
  confirm threshold and error vs infinity).
