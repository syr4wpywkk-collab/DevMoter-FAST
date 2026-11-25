# DOLLARDE

`DOLLARDE(fractional_dollar, fraction)` — converts a dollar price
expressed as an integer part plus a fraction (e.g. `1.02` = "1 and
2/16") into a decimal number.

## Arguments
- `fractional_dollar`: number whose fractional digits encode the
  numerator. Required.
- `fraction`: denominator (integer). Required; truncated to integer.

## Semantics
`DOLLARDE = sign * (int + numerator / fraction)` where `numerator` is
the fractional part read as a two-digit (or less) integer: `1.02` →
numerator `2`; `1.1` → numerator `10` (trailing zero padding to two
digits is the documented Excel behavior — confirm for ≥3-digit
fractions such as `1.025`).

## Coercion and errors
- `fraction < 0` -> `#NUM!`.
- `0 <= fraction < 1` -> `#DIV/0!` (fraction truncates to `0`).
- `fraction >= 1` non-integer is truncated (e.g. `16.9` → `16`).
- Negative `fractional_dollar` yields negative result (sign preserved).
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `DOLLARDE(1.02,16)` | `1.125` (1 + 2/16) |
| `DOLLARDE(1.1,16)` | `1.625` (1 + 10/16) |
| `DOLLARDE(-1.02,16)` | `-1.125` |
| `DOLLARDE(1.02,0)` | `#DIV/0!` |
| `DOLLARDE(1.02,-16)` | `#NUM!` |

## Compatibility
Legacy securities-pricing helper; inverse of `DOLLARFR`.

## Open questions
- Numerator parsing for fractional parts with more than two decimal
  digits (`1.025` → 2.5? 25? — Excel pads/truncates in a specific way;
  needs reference check).
