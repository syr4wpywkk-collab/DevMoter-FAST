# XIRR

`XIRR(values, dates, [guess])` — internal rate of return for a series
of cash flows at irregular dates (actual/365 basis).

## Arguments
- `values`: required; range/array of cash flows; must contain at
  least one positive and one negative value.
- `dates`: required; parallel range/array of date serials; same
  length as `values`.
- `guess`: optional, default `0.1`.

## Semantics
- Solves `sum_i v_i / (1+rate)^((d_i - d_0)/365) = 0` for `rate`,
  where `d_0` is the earliest... actually Excel uses the first date
  in the list: `d_1 = dates[0]` (payments discounted from the first
  date; all `d_i >= d_1` required — dates need not be sorted but must
  all be >= first? Excel requires the first date to be the earliest;
  other dates may be in any order but not before it -> `#NUM!`).
- Iterative (Newton or bisection-like), up to ~100 iterations, tol
  ~1e-10 (Excel: "within 0.0000001%", i.e. 1e-10? — Excel docs: tries
  up to 100 iterations, 0.000001 accuracy — confirm).
- Day-count: fixed actual/365 regardless of leap years (documented).

## Coercion
- Elements coerced like other range-arg financials: text/bool/blank
  inside ranges skipped or error — **confirm** (likely error/skip per
  IRR-family rules).
- Values/dates length mismatch -> `#NUM!`? Excel gives `#NUM!` —
  confirm (docs: "different number" -> `#NUM!`).

## Errors
- No positive or no negative value -> `#NUM!`.
- Any date before `dates[0]` -> `#NUM!`.
- Invalid date serials -> `#VALUE!`.
- Length mismatch -> `#NUM!`.
- Non-convergence -> `#NUM!`.
- `rate <= -1` during iteration: Excel reports `#NUM!` when the
  result would be <= -1? Actually XIRR can return values < -100% in
  some cases — confirm.

## Examples
- `XIRR({-10000, 2750, 4250, 3250, 2750}, {44562,44697,45047,45375,45761})`
  -> `0.37336...` (Excel doc example ≈ 37.3%).
- `XIRR({-1000, 1100}, {45000, 45365})` -> `0.1` (one-year doubling:
  (1100/1000)^(365/365)-1 = 0.1).
- `XIRR({100, 200}, {45000, 45100})` -> `#NUM!` (no negative flow).

## Engine requirements
- Date serial -> real-date arithmetic (difference in days) — plain
  serial subtraction suffices; no calendar needed beyond serials.

## Open questions
- Exact convergence tolerance/iteration count.
- Whether unsorted dates are allowed or must be chronological.
- Blank/text element handling inside the ranges.
