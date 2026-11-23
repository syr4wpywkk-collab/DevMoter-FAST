# PERMUT

`PERMUT(number, number_chosen)` — permutations `P(n,k) = n!/(n-k)!`
(without repetition). Legacy function.

## Arguments
- `number`: required; truncated to integer; `> 0` else `#NUM!`.
- `number_chosen`: required; truncated to integer; `>= 0` else `#NUM!`.

## Semantics
- `P(n,k) = n!/(n-k)!`; `P(n,0) = 1`.
- Computed without materializing huge factorials where possible; result
  overflowing f64 -> `#NUM!`? — Excel returns `#NUM!` on overflow
  (confirm; `PERMUT(2000,1999)` magnitude ~10^large).

## Errors
- `number <= 0`, `number_chosen < 0`, `number_chosen > number` ->
  `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `PERMUT(100, 3)` -> `970200`.
- `PERMUT(10, 10)` -> `3628800`.
- `PERMUT(5, 0)` -> `1`.
- `PERMUT(5, 6)` -> `#NUM!`.

## Open questions
- Overflow behavior (`#NUM!` vs `Inf`).
- Whether 0 for `number` errors (docs: nonpositive -> `#NUM!`).
