# CUMIPMT

`CUMIPMT(rate, nper, pv, start_period, end_period, type)` — returns the
cumulative interest paid on a loan between `start_period` and
`end_period` (inclusive).

## Arguments
- `rate`: interest rate per period. Required.
- `nper`: total number of payment periods. Required; truncated to
  integer.
- `pv`: present value (loan principal). Required.
- `start_period`, `end_period`: 1-based inclusive period range.
  Required; truncated to integers.
- `type`: payment timing — `0` end of period (default in annuity
  convention, but **required here**; omitted argument is an arity error),
  `1` beginning of period.

## Semantics
`Σ IPMT(rate, per, nper, pv, 0, type)` for `per` in
`start..end` — see `IPMT.md`. Returned value is negative when `pv > 0`
(cash outflow), matching Excel's sign convention.

## Coercion and errors
- `rate <= 0`, `nper <= 0`, `pv <= 0` -> `#NUM!`.
- `start_period < 1`, `end_period < 1`, or `start_period > end_period`
  -> `#NUM!`.
- `type` other than `0`/`1` -> `#NUM!`.
- `end_period > nper`: Excel still computes (periods beyond `nper`
  contribute ~0) — **confirm**; may be `#NUM!`.
- Non-numeric text -> `#VALUE!`; blank in a required argument -> `0`
  coercion then likely `#NUM!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `CUMIPMT(0.09/12,360,125000,13,24,0)` | `-11135.23213` |
| `CUMIPMT(0.09/12,360,125000,1,1,0)` | `-937.5` (first payment is all interest) |
| `CUMIPMT(0.09/12,360,125000,13,24,1)` | `-11128.22633` (type 1: payments at period start) |
| `CUMIPMT(0.09/12,360,125000,24,13,0)` | `#NUM!` |

## Compatibility
Former Analysis ToolPak function; since Excel 2007 built-in.

## Open questions
- `end_period > nper` behavior (`#NUM!` vs silent extension).
- Whether `rate = 0` yields `#NUM!` (documented `rate <= 0` is an error)
  even though a zero-rate amortization is mathematically defined.
