# XNPV

`XNPV(rate, values, dates)` — present value of irregularly dated cash
flows, discounting from `dates[0]`.

## Arguments
- `rate`: required; annual discount rate (actual/365).
- `values`: required; cash flows (first is typically the t0
  investment, negative).
- `dates`: required; parallel date serials, same length.

## Semantics
- `XNPV = sum_i v_i / (1+rate)^((d_i - d_1)/365)`.
- Unlike `NPV`, the first flow is not discounted (exponent 0).
- `dates` must all be >= `dates[0]`? — Excel requires first date to
  be earliest; others unordered but >= first? Per docs: "first date
  is the start"; subsequent dates may be in any order but must be
  later than first? Confirm: docs say dates "need not be in
  chronological order" — but a date earlier than the first ->
  `#NUM!`? Actually docs say: if any number in dates precedes the
  starting date -> `#NUM!`.

## Coercion
- As `XIRR`; non-numeric/non-date elements -> `#VALUE!`; errors
  propagate.

## Errors
- Length mismatch -> `#NUM!`.
- Any date < `dates[0]` -> `#NUM!`.
- `rate <= -1` -> `#NUM!`? Docs: "rate <= -1" not listed; likely
  still computed or `#NUM!` — confirm.
- Non-numeric -> `#VALUE!`.

## Examples
- `XNPV(0.09, {-10000, 2750, 4250, 3250, 2750},
  {44562,44697,45047,45375,45761})` -> `2086.65...` (Excel doc
  example ≈ 2,086.65).
- `XNPV(0.1, {-1000, 1100}, {45000, 45365})` -> `0` (1100/1.1 - 1000).
- `XNPV(0, {100, 200}, {45000, 45100})` -> `300`.

## Open questions
- `rate <= -1` error class.
- Skipped-element semantics inside ranges (same question as `NPV`).
