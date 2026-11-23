# IMABS

`IMABS(inumber)` — returns the modulus (absolute value) of a complex
number, `|a+bi| = sqrt(a^2 + b^2)`.

## Arguments
- `inumber`: required; a complex number as text (`"3+4i"`, `"5j"`,
  `"-2-3i"`), a bare real number, or a bare imaginary (`"4i"`).

## Semantics
- Returns a real scalar >= 0.
- A real `number` input returns `ABS(number)`; pure imaginary `"4i"`
  returns `4`.

## Coercion
- Complex text must match the canonical `COMPLEX` output format
  (case-insensitive `i`/`j`; confirm whether both `i` and `j` accepted
  in input — expected yes).
- Malformed complex text -> `#NUM!` (documented: `#NUM!` when inumber
  is not a valid complex number) — confirm vs `#VALUE!`.

## Errors
- Non-complex, non-numeric text -> `#NUM!`.
- Boolean arg -> coercion or error (confirm).

## Examples
- `IMABS("5+12i")` = `13`
- `IMABS("3-4j")` = `5`
- `IMABS(-6)` = `6`
- `IMABS("4i")` = `4`
- `IMABS("2+ii")` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Engine requirements
- Complex-number parsing shared with `COMPLEX`/`IMREAL`/`IMAGINARY`;
  hypot-style computation recommended to avoid overflow for large
  components (`sqrt` of sum of squares overflows at ~1e154; use
  `hypot` algorithm).

## Open questions
- `#NUM!` vs `#VALUE!` for malformed input (documented as `#NUM!` in
  MS docs for `IM*` parse failures — confirm).
- Accepted whitespace inside complex strings.
- Whether `"i"`/`"j"` suffix case matters on input.
