# RECEIVED

`RECEIVED(settlement, maturity, investment, discount, [basis])` —
amount received at maturity for a fully invested discount security.

## Arguments
- `settlement`, `maturity`: required date serials;
  `settlement < maturity`.
- `investment`: required; amount invested, `> 0`.
- `discount`: required; discount rate, `> 0`.
- `basis`: optional, default `0`; codes 0..4.

## Semantics
- `RECEIVED = investment / (1 - discount * DSM/B)` where `DSM` = days
  settlement->maturity and `B` = year length per `basis`.

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `investment <= 0` -> `#NUM!`.
- `discount <= 0` -> `#NUM!`.
- `1 - discount*DSM/B <= 0` -> `#NUM!`/`#DIV/0!` — confirm.
- `basis` outside 0..4 -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `RECEIVED(39448, 39594, 1000000, 0.0575, 2)` -> `1020844.8...`?
  Excel doc example: settlement 2008-02-15, maturity 2008-05-15,
  investment 1,000,000, discount 5.75%, basis 2 (act/360) -> DSM=90,
  RECEIVED = 1e6/(1-0.0575*90/360) = 1e6/(1-0.014375) = 1014579.8.
  Verify.
- `RECEIVED(45000, 45180, 100000, 0.05, 0)` -> `102564.10...`
  (1e5/(1-0.05*0.5)).
- `RECEIVED(45000, 45000, 100000, 0.05)` -> `#NUM!`.

## Engine requirements
- Day-count conventions (shared; see `PRICE.md`).

## Open questions
- Denominator-nonpositive error class.
- Basis-1 year-length rule.
