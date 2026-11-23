# COMBINA

`COMBINA(number, number_chosen)` — number of combinations **with
repetition** of `number` items taken `number_chosen` at a time.

## Arguments
- `number`: `n`, required, truncated to integer.
- `number_chosen`: `k`, required, truncated to integer.

## Semantics
- `COMBINA(n,k) = C(n+k-1, k) = (n+k-1)! / (k! * (n-1)!)`.
- `COMBINA(4,3)` -> `20`; `COMBINA(10,3)` -> `220`.
- `n = 0` edge: `COMBINA(0,0)` -> `1`? (**SPEC-OPEN** — formula gives
  C(-1,0); Excel documents result `1` for `COMBINA(0,0)` — confirm).

## Coercion
- Same as `COMBIN`: numeric coercion + truncation, `#VALUE!` on
  failure.

## Errors
- `n < 0` or `k < 0` after truncation -> `#NUM!`.
- Unlike `COMBIN`, `k > n` is **allowed** (`COMBINA(2,5)` -> `6`).

## Examples
| Formula | Result |
|---|---|
| `=COMBINA(4,3)` | 20 |
| `=COMBINA(10,3)` | 220 |
| `=COMBINA(2,5)` | 6 |

## Compatibility
- **Excel 2013+** (`_xlfn.COMBINA`).

## Open questions
- `COMBINA(0,0)` and `COMBINA(0,k)` exact results.
- Overflow threshold.
