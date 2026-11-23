# ODDLPRICE

`ODDLPRICE(settlement, maturity, last_interest, rate, yld, redemption,
frequency, [basis])` — price per $100 face of a security with an odd
last coupon period.

## Arguments
- `settlement`, `maturity`, `last_interest`: required date serials;
  `maturity > settlement > last_interest`.
- `rate`, `yld`: `>= 0`; `redemption`: per $100 face.
- `frequency`: {1,2,4}; `basis`: optional 0..4 default 0.

## Semantics
- Microsoft published formula:
  `PRICE = (redemption + sum_i DC_i/NL_i * 100*rate/freq) /
   (1 + sum_i ... ) ` — the doc gives:
  `PRICE = [redemption + (DC_last/NL_last... )]` transcribe exactly:
  `ODDLPRICE = ( redemption + 100*rate/freq * DCl/NLl ) /
   ( (1 + yld/freq)^(DSC/E + N - 1) )` plus coupon-sum corrections
  per the multi-quasi-period expansion in the docs. Implement the
  documented formula verbatim; both short-odd and long-odd last
  periods covered.

## Errors
- Date ordering violated -> `#NUM!`.
- `rate<0`/`yld<0` -> `#NUM!`; `frequency`/`basis` invalid -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `ODDLPRICE(39485, 39594, 39384, 0.075, 0.055, 100, 2, 0)` ->
  `99.8782...`? Excel doc example: settlement 2008-02-07, maturity
  2008-06-15, last_interest 2007-10-15, rate 3.75%, yld 4.05% ->
  `99.87829`. Verify.
- `ODDLPRICE` with `last_interest` exactly one period before maturity
  should equal `PRICE` for the regular tail — cross-check fixture.
- `ODDLPRICE(45000, 46000, 46000, 0.05, 0.05, 100, 2)` -> `#NUM!`.

## Engine requirements
- Day-count conventions + quasi-coupon logic (see `PRICE.md`).

## Open questions
- Quasi-coupon counting (`NC`, `NL_i`) edge cases across leap years.
- Basis-1 year length.
