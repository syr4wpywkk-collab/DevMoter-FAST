# ACCRINT

`ACCRINT(issue, first_interest, settlement, rate, [par], frequency, [basis], [calc_method])`
— returns the accrued interest for a security that pays periodic interest.

## Arguments
- `issue`: security's issue date (serial number or date-coercible). Required.
- `first_interest`: first coupon date. Required.
- `settlement`: settlement date. Required.
- `rate`: annual coupon rate. Required.
- `par`: par (face) value. Optional; default `1000`.
- `frequency`: coupon payments per year: `1`, `2`, or `4`. Required.
- `basis`: day-count basis `0`-`4`. Optional; default `0`.
- `calc_method`: optional boolean. `TRUE` (default) accrues from `issue`
  to `settlement`; `FALSE` accrues from `first_interest` to `settlement`.
  Added in Excel 2010; earlier versions behave as `TRUE`.

## Day-count basis (shared with all `basis` arguments in this group)
- `0` or omitted: US (NASD) 30/360
- `1`: actual/actual
- `2`: actual/360
- `3`: actual/365
- `4`: European 30/360
Invalid basis (`<0` or `>4`, non-integer truncation) -> `#NUM!`.

## Semantics
`ACCRINT = par * (rate/frequency) * Σᵢ (Aᵢ / NLᵢ)` where `Aᵢ` is the
number of accrued days in the i-th quasi-coupon period and `NLᵢ` its
length, per the `basis` convention. Excel computes the quasi-coupon
schedule from `first_interest` and `issue`; the summation over multiple
quasi-periods is an **Engine requirement** (day-count conventions plus
backward/forward coupon schedule generation).

## Coercion and errors
- Date arguments: numeric serials accepted; date text coercion is
  **SPEC-OPEN** (Excel accepts `"2008-03-01"` typed in a cell; literal
  text arguments inside a formula are coerced via `DATEVALUE` rules).
- Dates are truncated to integers; `rate`, `par`, `frequency` truncated
  where integers are expected.
- `issue >= settlement` -> `#NUM!`.
- `rate <= 0` or `par <= 0` -> `#NUM!`.
- `frequency` not in {1,2,4} -> `#NUM!`.
- Non-numeric text argument -> `#VALUE!`.
- Error-valued arguments propagate.

## Examples
| Formula | Result |
|---|---|
| `ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)` | `16.66666667` |
| `ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,3)` | `16.71232877` |
| `ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,,2,0)` | `16.66666667` (default `par`=1000) |
| `ACCRINT(DATE(2008,5,1),DATE(2008,8,31),DATE(2008,3,1),0.1,1000,2,0)` | `#NUM!` |

## Open questions
- Exact quasi-coupon schedule construction when `first_interest` is not
  `issue + 12/frequency` months (odd first period) — needs reference
  confirmation.
- Whether text dates are coerced directly or only via serials.
- `calc_method` semantics on odd-first-period bonds.
