# NORMSDIST

`NORMSDIST(z)` — standard normal cumulative distribution:
`P(Z <= z)` for `Z ~ N(0, 1)`.

Legacy compatibility function; modern equivalent is `NORM.S.DIST`
(which adds a `cumulative` flag for the PDF). Legacy form is always
the CDF.

## Arguments
- `z`: required scalar.

## Coercion
- Numeric text and booleans coerced; non-numeric text -> `#VALUE!`.

## Semantics
- `NORMSDIST(z) = (1/2) * (1 + erf(z / sqrt(2)))`.

## Errors
- Non-numeric `z` -> `#VALUE!`.
- No domain restriction (`z` unbounded; result saturates to 0/1).

## Engine requirements
- `erf` or a documented rational approximation; precision target
  must be recorded (Excel uses its own approximation — bit-exact
  matching not expected).

## Examples
- `NORMSDIST(1.333333)` -> `0.908789` (Microsoft docs example)
- `NORMSDIST(0)` -> `0.5`
- `NORMSDIST(-1.96)` -> `0.0249979` (approx)
- `NORMSDIST("abc")` -> `#VALUE!`

## Open questions
- Chosen approximation (erf vs Hart/Abramowitz-Stegun) and max
  deviation from Excel — record in fixtures.
