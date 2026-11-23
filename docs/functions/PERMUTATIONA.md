# PERMUTATIONA

`PERMUTATIONA(number, number_chosen)` — permutations **with**
repetition `= n^k`. Excel 2013+.

## Arguments
- `number`: required; truncated to integer; `>= 0` (docs: `< 0` ->
  `#NUM!`; `number = 0` with `k = 0` -> `1`? confirm `0^0` handling).
- `number_chosen`: required; truncated; `>= 0`.

## Semantics
- `n^k` for integer n,k. Unlike `PERMUT`, `k` may exceed `n` (no
  error).
- `PERMUTATIONA(0, 0)` -> `1` in Excel (confirm).

## Errors
- Negative args -> `#NUM!`; non-numeric -> `#VALUE!`.
- Huge results -> `#NUM!` on overflow? (same question as `PERMUT`).

## Examples
- `PERMUTATIONA(3, 2)` -> `9`.
- `PERMUTATIONA(10, 3)` -> `1000`.
- `PERMUTATIONA(5, 7)` -> `78125` (k > n allowed).
- `PERMUTATIONA(2, 0)` -> `1`.

## Open questions
- `0^0` case and `n = 0, k > 0` (`0`? likely).
- Overflow error boundary.
