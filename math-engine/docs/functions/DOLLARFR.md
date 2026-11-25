# DOLLARFR

`DOLLARFR(decimal_dollar, fraction)` — converts a decimal dollar price
into an integer part plus a fraction expressed as
`integer.numerator/100`-style decimal (e.g. `1.125` with fraction `16`
→ `1.02`, read as "1 and 2/16").

## Arguments
- `decimal_dollar`: decimal number. Required.
- `fraction`: denominator. Required; truncated to integer.

## Semantics
`DOLLARFR = sign * (int + 0.01 * round(frac * fraction))` — the
fractional part is multiplied by `fraction`, rounded to the nearest
integer numerator, and encoded in the two decimal digits after the
point. Rounding of `frac * fraction` is to the nearest integer (half
up? — confirm).

## Coercion and errors
Same as `DOLLARDE`: `fraction < 0` -> `#NUM!`; `fraction` truncating to
`0` -> `#DIV/0!`; negative input → negative output; `#VALUE!` for
non-numeric text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `DOLLARFR(1.125,16)` | `1.02` (1 and 2/16) |
| `DOLLARFR(1.125,32)` | `1.04` (1 and 4/32) |
| `DOLLARFR(-1.125,16)` | `-1.02` |
| `DOLLARFR(1.5,8)` | `1.04` (1 and 4/8) |
| `DOLLARFR(1.125,0)` | `#DIV/0!` |

## Compatibility
Inverse of `DOLLARDE` (modulo the 2-digit numerator encoding).

## Open questions
- Behavior when `frac * fraction >= 100` (numerator overflow into the
  integer part — e.g. `DOLLARFR(1.99,16)` → numerator 15.84→16?).
- Rounding mode for the numerator.
