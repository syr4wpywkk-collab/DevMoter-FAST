# Z.TEST

`Z.TEST(array, x, [sigma])` — one-tailed probability of a z-test:
`P(Z >= z)` where z compares sample mean of `array` to `x`. Excel
2010+; legacy `ZTEST`.

## Arguments
- `array`: required; the dataset (sample).
- `x`: required; the hypothesized value (mu0) to test against.
- `sigma`: optional; known population standard deviation. Omitted ->
  uses the **sample** sd (`STDEV.S`) of `array` (documented).

## Semantics
- `z = (mean(array) - x) / (sigma / sqrt(n))`; result = upper tail
  `1 - NORM.S.DIST(z, TRUE)`.
- Note this is a **one-tailed** probability; the two-tailed value is
  `2*MIN(Z.TEST(...), 1 - Z.TEST(...))` (per docs).
- `x > mean` -> result > 0.5 (not an error).

## Coercion
- Standard aggregate rules on `array` (range text/boolean/blank
  ignored); `x`, `sigma` scalar-coerce; errors propagate.

## Errors
- `sigma <= 0` -> `#NUM!`; `n` too small for sample sd (omitted sigma,
  `n < 2`) -> `#DIV/0!`; `n = 0` -> `#N/A`? — Excel docs: empty array
  -> `#N/A` (confirm).
- Non-numeric `x`/`sigma` -> `#VALUE!`.

## Examples
- `Z.TEST({3;6;7;8;6;5;4;2;1;9}, 4)` -> `0.090574` (Excel doc example
  `0.090574` — uses sample sd since sigma omitted).
- `Z.TEST({3;6;7;8;6;5;4;2;1;9}, 6)` -> `0.863043` (doc `0.863043`).
- `Z.TEST(A1:A10, 5, 2)` with known sigma.
- `Z.TEST({}, 5)` -> `#N/A` (empty).

## Open questions
- Empty-array error code (`#N/A` vs `#DIV/0!`).
- `n = 1` with omitted sigma (`#DIV/0!` expected via `STDEV.S`).

## Engine requirements
- Shared normal CDF (`NORM.S.DIST` implementation).
