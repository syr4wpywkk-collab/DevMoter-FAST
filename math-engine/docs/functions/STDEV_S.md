# STDEV.S

`STDEV.S(number1, [number2], ...)` — sample standard deviation (denominator n-1).

## Arguments
- 1..255 arguments; scalars, cell refs, ranges.

## Type coercion
Same split as `SUM` (see `SUM.md`):
- Range args: text, booleans, blanks **ignored**; errors propagate.
- Direct scalar args: numeric text and booleans coerced; non-numeric
  text -> `#VALUE!`; blank -> 0.

## Computation
- `sqrt( sum((x - mean)^2) / (n - 1) )` over the `n` counted values.
- **Numerical stability:** use Welford's algorithm or two-pass rather
  than the naive sum-of-squares formula (plan §6 Phase 5). Fixture
  tests must bound deviation from the Excel result; document the
  chosen method and measured max ULP/relative error.

## Errors
- `n < 2` -> `#DIV/0!` (Excel behavior for sample statistics).
- Error values in inputs propagate.
- Non-coercible direct text -> `#VALUE!`.

## Edge cases
- Exactly 2 values.
- All-equal values -> `0` (within FP error; Excel returns exactly 0
  for identical inputs? — confirm).
- Very large magnitudes / catastrophic cancellation — covered by the
  stability requirement above.

## Open questions
- Algorithm choice (Welford vs two-pass) and documented error bound.
- Whether `STDEV.S` over a single direct scalar arg is arity error or
  `#DIV/0!` (Excel: `#DIV/0!`).
