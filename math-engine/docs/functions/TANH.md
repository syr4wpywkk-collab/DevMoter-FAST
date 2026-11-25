# TANH

`TANH(number)` — returns the hyperbolic tangent of `number`.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.

## Behavior
- `TANH(-2)` -> -0.9640275800758169; `TANH(0)` -> 0;
  `TANH(0.5)` -> 0.46211715726000974.
- Range (-1, 1); saturates to ±1 for large |x| (no overflow).

## Errors
- Coercion failures -> `#VALUE!`; errors propagate. No `#NUM!` domain.

## Open questions
- None.
