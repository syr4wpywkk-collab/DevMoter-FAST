# PRICE

`PRICE(settlement, maturity, rate, yld, redemption, frequency, [basis])` —
price per $100 face value of a periodic-interest security.

## Arguments
- `settlement`: required date serial; the settlement (purchase) date.
- `maturity`: required date serial; `maturity > settlement`.
- `rate`: required; annual coupon rate, `>= 0`.
- `yld`: required; annual yield, `>= 0`? (negative yields are now
  accepted by real Excel — **confirm**; docs historically say
  yld < 0 -> `#NUM!`).
- `redemption`: required; redemption value per $100 face, `> 0`.
- `frequency`: required; `1`, `2`, or `4` (annual/semiannual/
  quarterly).
- `basis`: optional, default `0`; day-count basis:
  `0` US 30/360, `1` actual/actual, `2` actual/360, `3` actual/365,
  `4` European 30/360.

## Semantics
- Standard bond-pricing formula over `N` remaining coupons:
  `PRICE = sum_{k=1..N} (100*rate/freq)/(1+yld/freq)^(k-1+E) +
  redemption/(1+yld/freq)^(N-1+E)` adjusted for the fractional first
  period `E = DSC/C` (days from settlement to next coupon / days in
  coupon period per `basis`), minus accrued interest
  `A = (C-E)*(100*rate/freq)/C`-style term: `PRICE = [discount curve
  over coupon dates] - accrued` where accrued = `100*rate/freq *
  (DCS/C)` with `DCS` = days from previous coupon to settlement.
- Coupon dates step backward from `maturity` by `12/frequency`
  months (end-of-month clinging).
- Returns dirty price (includes accrued interest).

## Coercion
- Date args: serials; fractional parts truncated (confirm — consistent
  with COUP* family).
- `basis`/`frequency` truncated to integer.
- Non-coercible -> `#VALUE!`; errors propagate.

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `yld < 0` or `rate < 0` -> `#NUM!` (see negative-yield question).
- `basis` outside `0..4` -> `#NUM!`.
- `frequency` outside `{1,2,4}` -> `#NUM!`.
- `redemption <= 0`? docs don't bound; likely `#NUM!` if <=0 —
  confirm.

## Examples
- `PRICE(39448, 40179, 0.08, 0.09, 100, 2, 0)` -> `90.8386...`? —
  Excel doc example: settlement 2008-02-15, maturity 2017-11-15,
  coupon 5.75%, yld 6.5%, freq 2, basis 0 -> `94.63436...`. Verify
  all fixtures against reference.
- `PRICE(45000, 46800, 0.10, 0.10, 100, 2, 0)` -> `~100` (par when
  yld = coupon and settlement is a coupon date — choose a real coupon
  date).
- `PRICE(45000, 45365, 0, 0.05, 100, 1, 3)` -> zero-coupon one-year
  `100/1.05` approx `95.238` (basis 3, actual days — verify).

## Engine requirements
- Day-count conventions (30/360 US+EU, act/act, act/360, act/365) and
  coupon-date stepping logic shared across PRICE/YIELD/ACCRINT/COUP*
  families — must exist in the engine as a shared utility.

## Open questions
- Negative `yld` domain in modern Excel.
- Whether `settlement` exactly on a coupon date has E=0 vs 1 handling.
- Truncation of fractional date serials.
