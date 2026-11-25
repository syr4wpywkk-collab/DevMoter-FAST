# AMORDEGRC

`AMORDEGRC(cost, date_purchased, first_period, salvage, period, rate, [basis])`
— returns the depreciation for each accounting period using the French
declining-balance method with a life-dependent acceleration coefficient.

## Arguments
- `cost`: asset cost. Required.
- `date_purchased`: purchase date. Required.
- `first_period`: end date of the first period. Required.
- `salvage`: salvage value at end of life. Required.
- `period`: period index (0-based: period `0` is the first partial
  period). Required; truncated to integer.
- `rate`: depreciation rate per period (as a fraction, e.g. `0.15`).
  Required.
- `basis`: year basis `0`-`4` (same day-count table as `ACCRINT`;
  basis `2` uses actual/360, `1`/`3` actual days / 365 or 360/365 per
  reference). Optional; default `0`.

## Semantics
Declining balance with coefficient applied to `rate`:

| Remaining life | Coefficient |
|---|---|
| 3–4 years | 1.5 |
| 5–6 years | 2.0 |
| > 6 years | 2.5 |

Remaining life is derived as `1/rate` rounded — the exact rounding rule
is an open question below. Period `0` depreciation is prorated by the
fraction of the year between `date_purchased` and `first_period`; each
subsequent period applies `rate * coefficient` to the remaining book
value. In the last two periods the function switches to straight-line so
the book value reaches `salvage` — the exact switch rule is also an open
question.

## Coercion and errors
- `cost <= 0` (Excel: `cost == 0` returns `0`; negative -> `#NUM!`) —
  confirm zero-cost behavior.
- `salvage >= cost`, `rate <= 0` -> `#NUM!`.
- `period < 0` -> `#NUM!`; non-integer truncated.
- `basis` outside `0..4` -> `#NUM!`.
- `first_period <= date_purchased` -> `#NUM!` (confirm).
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)` | `776` (rate 15% → life 6.67y → coeff 2.5) |
| `AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,1)` | `~330` (prorated first period; confirm exact value) |
| `AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15)` | `776` (basis default 0 vs 1 may differ — confirm) |

## Compatibility
French accounting method; distinct from `AMORLINC` (linear). No US-GAAP
equivalent. Added in Excel 2007; stored as `_xlfn`? No — legacy
Analysis ToolPak lineage; see Open questions.

## Engine requirements
Day-count conventions (basis 0–4) between arbitrary dates.

## Open questions
- Exact coefficient lookup vs `1/rate` (rounded or truncated life?).
- Proration divisor for period 0 per basis (Excel appears to use
  actual days / 365 for basis 1 — confirm).
- Straight-line switchover rule in final periods.
- Whether the result is rounded to an integer per period internally
  (LibreOffice/Excel differ subtly).
- Zero-cost and `salvage = 0` boundary behavior.
