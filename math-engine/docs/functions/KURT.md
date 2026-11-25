# KURT

`KURT(number1, [number2], ...)` — excess kurtosis of a data set
(Fisher's `g2`, i.e. `kurtosis - 3`), computed with the *sample*
(bias-corrected) estimator Excel uses:
`n(n+1)/((n-1)(n-2)(n-3)) * Σ((x-x̄)/s)^4 - 3(n-1)²/((n-2)(n-3))`.

## Arguments / Coercion
- 1..255 args; ranges ignore text/logical/blank; direct scalars
  coerce; errors propagate.

## Errors
- Fewer than 4 numeric values -> `#DIV/0!` (documented: `n < 4` or
  `s = 0` -> `#DIV/0!`).
- Zero variance (all values equal) -> `#DIV/0!`.
- Non-numeric direct scalar -> `#VALUE!`.

## Examples
- `KURT(3,4,5,2,3,4,5,6,4,7)` -> `-0.15179963720941686` (textbook
  example — verify exactly)
- `KURT(1,2,3,4)` -> `-1.2` (four equally spaced points)
- `KURT(1,1,2,2,3,3)` -> compute exactly for fixture
- `KURT(5,5,5,5)` -> `#DIV/0!` (zero variance)
- `KURT(1,2,3)` -> `#DIV/0!` (n < 4)

## Compatibility
- All Excel versions; returns *excess* kurtosis (normal -> ~0), not
  the raw fourth standardized moment — document clearly.

## Engine requirements
- Stable central-moment accumulation; f64.

## Open questions
- None.
