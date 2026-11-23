# FV

`FV(rate, nper, pmt, [pv], [type])` — returns the future value of an
investment with periodic constant payments and a constant rate.

## Arguments
- `rate`: rate per period. Required.
- `nper`: total number of periods. Required (real-valued accepted —
  Excel does not truncate? **confirm**).
- `pmt`: payment per period (negative = outflow). Required.
- `pv`: present value / lump sum today. Optional; default `0`.
- `type`: `0` payments at end of period (default), `1` at beginning.
  Optional; any non-zero value is treated as `1` (confirm).

## Semantics
- `rate = 0`: `FV = -(pv + pmt·nper)`
- otherwise: `FV = -(pv·(1+rate)^nper +
  pmt·(1 + rate·type)·((1+rate)^nper − 1)/rate)`

Sign convention: money paid in is negative, money received positive;
`FV` returns the negative of the accumulated value.

## Coercion and errors
- Non-numeric text -> `#VALUE!`.
- `type` coerced: `0`/`FALSE` → end; any non-zero number/`TRUE` →
  beginning. Blank/omitted → `0`.
- Error arguments propagate. No `#NUM!` conditions (all finite real
  inputs produce a result; `rate = -1` yields `0/0` — **confirm**).

## Examples
| Formula | Result |
|---|---|
| `FV(0.06/12,10,-200,-500,1)` | `2581.403374` |
| `FV(0.12/12,12,-1000)` | `12682.50301` |
| `FV(0.11/12,35,-2000,,1)` | `82846.24637` |
| `FV(0,10,-100,-500)` | `1500` |
| `FV(0.005,12,-100)` | `1233.556237` |

## Compatibility
Core annuity function; pairs with `PV`, `PMT`, `RATE`, `NPER` (spec'd
elsewhere).

## Open questions
- Non-integer `nper` handling.
- `rate <= -1` degenerate cases (`(1+rate)` non-positive: `rate = -1`
  with non-integer `nper` → `#NUM!`? NaN propagation?).
