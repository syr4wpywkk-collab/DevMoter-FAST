# AMORLINC

`AMORLINC(cost, date_purchased, first_period, salvage, period, rate, [basis])`
— returns the depreciation for each accounting period using the French
linear (straight-line) method, prorated for the first partial period.

## Arguments
Same argument list as `AMORDEGRC` (see `AMORDEGRC.md`): `cost`,
`date_purchased`, `first_period`, `salvage`, `period` (0-based), `rate`,
optional `basis` (`0`-`4`, default `0`).

## Semantics
- Period `0`: `cost * rate * (days from date_purchased to first_period
  / days-in-year per basis)` — prorated partial period.
- Periods `1..n`: `cost * rate` (full straight-line charge), until the
  accumulated depreciation reaches `cost - salvage`; the final period is
  the remainder.
- No acceleration coefficient (that is `AMORDEGRC`).

## Coercion and errors
Same error surface as `AMORDEGRC`: `#NUM!` for non-positive `rate`,
`basis` out of range, negative `period`, `salvage >= cost`;
`#VALUE!` for non-numeric text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)` | `360` (full year: 2400 × 15%) |
| `AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,1)` | `~132` (134 days prorated; confirm exact) |
| `AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,6,0.15,1)` | terminal partial period (confirm value) |

## Compatibility
French linear method; paired with `AMORDEGRC`. Added in Excel 2007
(previously Analysis ToolPak `AMORLINC`).

## Engine requirements
Day-count conventions (basis 0–4).

## Open questions
- Exact proration divisor per basis for period 0.
- Whether intermediate per-period results are rounded.
- Depreciation returned for `period` beyond asset life (expected `0`
  or remainder — confirm).
