# DB

`DB(cost, salvage, life, period, [month])` — returns the depreciation of
an asset for a specified period using the fixed-declining-balance method.

## Arguments
- `cost`: initial cost. Required.
- `salvage`: value at end of life. Required.
- `life`: number of periods (useful life). Required; truncated.
- `period`: period to compute (1-based; may equal `life + 1` when
  `month < 12`). Required; truncated.
- `month`: months in the first year. Optional; default `12`; truncated;
  must satisfy `1 <= month <= 12`.

## Semantics
Fixed rate `r = round(1 - (salvage/cost)^(1/life), 3)` — the rate is
**rounded to three decimal places**, a documented Excel quirk that must
be replicated exactly (it makes `DB` diverge from unrounded
declining-balance math).

- Period 1: `cost * r * month/12`
- Periods `2..life`: `(cost - prior_total_depreciation) * r`
- Period `life + 1` (only when `month < 12`):
  `((cost - prior_total) * r) * (12 - month)/12`

## Coercion and errors
- `cost < 0`, `salvage < 0`, `life <= 0` -> `#NUM!` (confirm exact set).
- `salvage >= cost` -> `#NUM!` (confirm; may return 0s).
- `period < 1` or `period > life + 1` (or `> life` when `month = 12`)
  -> `#NUM!`.
- `month < 1` or `month > 12` -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples (rate = round(1-(100000/1000000)^(1/6),3) = 0.319)
| Formula | Result |
|---|---|
| `DB(1000000,100000,6,1,7)` | `186083.33` |
| `DB(1000000,100000,6,2,7)` | `259639.42` |
| `DB(1000000,100000,6,7,7)` | `15845.10` (stub period) |
| `DB(1000000,100000,6,1)` | `319000` (month default 12) |
| `DB(1000000,100000,6,8,7)` | `#NUM!` (period > life+1) |

## Compatibility
Legacy function; `DDB`/`VDB` offer unrounded alternatives.

## Open questions
- `salvage = 0` and `salvage >= cost` behavior (`#NUM!` vs `0`).
- Whether `cost = 0` returns `0` or `#NUM!`.
- Rounding mode of the internal rate (documented as 3 decimals —
  confirm round-half-up vs banker's).
