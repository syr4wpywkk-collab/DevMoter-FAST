# MIRR

`MIRR(values, finance_rate, reinvest_rate)` — returns the modified
internal rate of return with explicit financing and reinvestment rates.

## Arguments
- `values`: array/range of periodic cash flows; must contain at least
  one negative and one positive value.
- `finance_rate`: rate paid on the negative flows. Required.
- `reinvest_rate`: rate earned on reinvested positive flows. Required.

## Semantics
`MIRR = (−FV(positive flows, reinvest_rate) /
 PV(negative flows, finance_rate))^(1/(n−1)) − 1`
where `n` is the count of flows, `PV` discounts negatives to period 0 at
`finance_rate`, and `FV` compounds positives to period `n−1` at
`reinvest_rate`.

## Coercion and errors
- Range `values`: text, logical, blank cells ignored (same as `IRR`).
- No sign change in `values` -> `#DIV/0!` (documented Excel behavior,
  unlike `IRR`'s `#NUM!` — confirm).
- Non-numeric `finance_rate`/`reinvest_rate` -> `#VALUE!`.
- Error cells propagate.

## Examples
| Formula | Result |
|---|---|
| `MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)` | `0.12609413` |
| `MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.14)` | `0.13475911` |
| `MIRR({-120000,39000,30000,21000,37000,46000},0.12,0.1)` | `0.11750926` |
| `MIRR({120000,39000},0.1,0.12)` | `#DIV/0!` (no negative flow) |

## Compatibility
Former Analysis ToolPak; built-in since Excel 2007.

## Open questions
- `#DIV/0!` vs `#NUM!` for all-positive/all-negative flows.
- `n = 2` degenerate case and zero-length `values`.
- Whether `values` literal arrays coerce text elements (range coercion
  vs scalar coercion asymmetry).
