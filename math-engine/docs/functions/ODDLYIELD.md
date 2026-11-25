# ODDLYIELD

`ODDLYIELD(settlement, maturity, last_interest, rate, pr, redemption,
frequency, [basis])` — yield of a security with an odd last coupon
period.

## Arguments
- `settlement`, `maturity`, `last_interest`: required;
  `maturity > settlement > last_interest`.
- `rate`: coupon rate, `>= 0`.
- `pr`: price per $100, `> 0`.
- `redemption`: per $100.
- `frequency`: {1,2,4}; `basis`: optional 0..4 default 0.

## Semantics
- Closed form exists (Microsoft documented):
  `YIELD = ( freq * ( (redemption + 100*rate/freq * sum DC_i/NL_i)
   / (pr + 100*rate/freq * DC/NL) - 1 ) )` — the documented formula:
  `ODDLYIELD = (redemption + DC term - pr - accrued term) / (pr +
  accrued term) * freq * E/DSM`-style; transcribe the exact published
  expression (`sum over quasi-coupon periods i=1..NC`, `DC_i`,
  `NL_i`, `A_i`) during implementation.
- No iteration required.

## Errors
- As `ODDLPRICE` (`#NUM!` ordering/params; `#VALUE!` coercion).

## Examples
- `ODDLYIELD(39513, 39774, 39448, 0.0375, 99.875, 100, 2, 0)` ->
  `0.045192` (Excel doc example ≈ 4.5192%; verify).
- `ODDLYIELD`/`ODDLPRICE` round-trip fixture.
- `ODDLYIELD(45000, 46000, 46000, 0.05, 100, 100, 2)` -> `#NUM!`.

## Engine requirements
- Day-count conventions + quasi-coupon logic (see `PRICE.md`).

## Open questions
- Same quasi-coupon/basis-1 questions as `ODDLPRICE`.
