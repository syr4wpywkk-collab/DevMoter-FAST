# RANDBETWEEN

`RANDBETWEEN(bottom, top)` — random integer between `bottom` and `top`
inclusive.

v2 plan §2 (047): integer bounds, error when inverted, avoid modulo
bias.

## Arguments
- `bottom`, `top`: numeric scalars, direct coercion. Non-integer
  bounds are truncated? — Excel actually *rounds up* `bottom` and
  truncates... needs confirmation (see open questions).

## Behavior
- Returns a uniformly distributed integer in `[ceil(bottom), floor(top)]`
  (Excel semantics; confirm exact bound coercion).
- **Volatile** like `RAND`; same workbook RNG and seeding.
- `bottom` = `top` -> always returns that value.

## Errors
- `bottom` > `top` after bound coercion -> `#NUM!` (Excel uses `#NUM!`;
  older docs say `#VALUE!` — confirm).
- Coercion failures -> `#VALUE!`; error inputs propagate.

## Edge cases
- Negative bounds allowed: `RANDBETWEEN(-10, -5)`.
- Wide ranges (up to full i64 / beyond 2^53): use a bias-free sampling
  method (rejection sampling on the RNG stream), not `rand % n`.
- Fractional bounds: `RANDBETWEEN(0.5, 9.5)` — Excel result range needs
  a fixture.

## Open questions
- Exact coercion of fractional `bottom`/`top` (round vs ceil/floor).
- Inverted-range error code (`#NUM!` vs `#VALUE!`).
- Bound coercion of numeric text.
