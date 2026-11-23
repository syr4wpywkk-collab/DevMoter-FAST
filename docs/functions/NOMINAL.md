# NOMINAL

`NOMINAL(effect_rate, npery)` — returns the nominal annual interest rate
given an effective rate and the number of compounding periods per year.

## Arguments
- `effect_rate`: effective annual rate. Required; `> 0`
  (`<= 0` -> `#NUM!`).
- `npery`: compounding periods per year. Required; truncated to
  integer; `>= 1` (`< 1` -> `#NUM!`).

## Semantics
`NOMINAL = npery · ((1 + effect_rate)^(1/npery) − 1)`. Inverse of
`EFFECT`: `NOMINAL(EFFECT(r, n), n) = r`.

## Coercion and errors
- `effect_rate <= 0` -> `#NUM!`.
- `npery < 1` after truncation -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `NOMINAL(0.053542667,4)` | `0.0525` (inverts `EFFECT(0.0525,4)`) |
| `NOMINAL(0.0625,4)` | `0.06108637` |
| `NOMINAL(0.1,1)` | `0.1` |
| `NOMINAL(0.051161898,12)` | `0.05` |
| `NOMINAL(0,4)` | `#NUM!` |

## Compatibility
Former Analysis ToolPak; built-in since Excel 2007.

## Open questions
- Text coercion of numeric-looking strings (same as `EFFECT`).
