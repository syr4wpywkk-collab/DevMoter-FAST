# DDB

`DDB(cost, salvage, life, period, [factor])` — returns the depreciation
of an asset for a specified period using the double-declining-balance
method (or another specified factor).

## Arguments
- `cost`, `salvage`, `life`, `period`: as `DB`, but `period` is a real
  number (fractional periods are prorated — **confirm**; Excel accepts
  fractional `period` and interpolates linearly between whole-period
  amounts).
- `factor`: declining-balance rate multiplier. Optional; default `2`.

## Semantics
Per-period depreciation = `min((cost - accumulated) * factor/life,
cost - salvage - accumulated)`, floored at `0`. Unlike `DB`, the rate is
**not** rounded.

## Coercion and errors
- `cost < 0`, `salvage < 0`, `salvage > cost`, `life <= 0`,
  `period <= 0`, `period > life`, `factor <= 0` -> `#NUM!` (exact set
  per argument — confirm).
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `DDB(2400,300,10,1,2)` | `480` |
| `DDB(2400,300,10,10,2)` | `22.1225472` |
| `DDB(2400,300,3650,1,2)` | `1.315068493` (daily life) |
| `DDB(2400,300,120,1,2)` | `40` (monthly life) |
| `DDB(2400,300,10,1,1.5)` | `360` (150% declining balance) |
| `DDB(2400,300,10,11)` | `#NUM!` (period > life) |

## Compatibility
`VDB` is the more general version (period ranges + straight-line switch);
`DDB` never switches to straight-line, so the book value may not reach
`salvage`.

## Open questions
- Fractional `period` interpolation rule.
- `salvage = 0` / `cost = 0` boundary handling.
