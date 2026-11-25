# FACT

`FACT(number)` — factorial `n!` of a non-negative integer.

## Arguments
- `number`: required, truncated toward zero to an integer.

## Semantics
- `FACT(0)` -> `1`; `FACT(5)` -> `120`; `FACT(3.9)` -> `6`
  (truncated to 3).
- `FACT(20)` -> `2.43290200817664e18`; `FACT(170)` ->
  `7.257415615307994e306` (largest representable);
  `FACT(171)` -> `#NUM!` (overflow — confirm exact cutoff:
  170 is the max, `FACT(171)` documented `#NUM!`).

## Coercion
- Numeric coercion, truncation. `FACT("4")` -> `24`. Blank -> 0 ->
  `1`. Errors propagate.

## Errors
- `number < 0` after truncation -> `#NUM!`.
- Overflow (> ~170.65, i.e. truncated n > 170) -> `#NUM!`.

## Examples
| Formula | Result |
|---|---|
| `=FACT(5)` | 120 |
| `=FACT(1.9)` | 1 |
| `=FACT(-3)` | #NUM! |

## Compatibility
- All Excel versions. Related: `FACTDOUBLE`, `GAMMA` (continuous
  extension; `GAMMA(n+1) == FACT(n)` for integer n).

## Open questions
- Whether `FACT` of a value truncating to exactly 170 succeeds and
  171 fails (`#NUM!` documented at >170).
- Truncation vs Excel's actual rounding for negative fractions
  (`FACT(-0.9)` -> `#NUM!` or `1`? truncation gives 0 -> `1` —
  confirm).
