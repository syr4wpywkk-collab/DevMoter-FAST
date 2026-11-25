# NORMSINV

`NORMSINV(probability)` — inverse of the standard normal CDF:
`z` with `NORMSDIST(z) = probability`.

Legacy compatibility function; modern equivalent is `NORM.S.INV`.

## Arguments
- `probability`: required scalar in `(0, 1)`.

## Coercion
- Numeric text and booleans coerced; non-numeric text -> `#VALUE!`.

## Semantics
- Excel computes the inverse iteratively (or via rational
  approximation plus refinement); result approximate.

## Errors
- `probability <= 0` or `probability >= 1` -> `#NUM!`.
- Non-convergence -> `#N/A`.
- Non-numeric -> `#VALUE!`.

## Engine requirements
- Inverse-normal approximation (e.g. Acklam/Beasley-Springer-Moro)
  with documented max error; std-only.

## Examples
- `NORMSINV(0.908789)` -> `1.3333347` (Microsoft docs example)
- `NORMSINV(0.5)` -> `0` (approximately; exact 0 expected)
- `NORMSINV(0.975)` -> `1.9599640`
- `NORMSINV(1)` -> `#NUM!`

## Open questions
- `NORMSINV(0.5)` exactness (0 vs tiny epsilon) — fixture.
- Approximation algorithm + refinement policy vs Excel.
