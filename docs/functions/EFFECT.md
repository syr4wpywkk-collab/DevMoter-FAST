# EFFECT

`EFFECT(nominal_rate, npery)` — returns the effective annual interest
rate given a nominal rate compounded `npery` times per year.

## Arguments
- `nominal_rate`: nominal annual rate. Required; `> 0`
  (`<= 0` -> `#NUM!`).
- `npery`: compounding periods per year. Required; truncated to integer;
  `>= 1` (`< 1` -> `#NUM!`).

## Semantics
`EFFECT = (1 + nominal_rate/npery)^npery - 1`. Inverse of `NOMINAL`.

## Coercion and errors
- `nominal_rate <= 0` -> `#NUM!`.
- `npery < 1` (after truncation) -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.
- Text numbers (`"5.25%"` style) — text rate arguments are **not**
  coerced (confirm; Excel returns `#VALUE!` for `"0.0525"` text —
  verify).

## Examples
| Formula | Result |
|---|---|
| `EFFECT(0.0525,4)` | `0.053542667` |
| `EFFECT(0.05,12)` | `0.051161898` |
| `EFFECT(0.1,1)` | `0.1` |
| `EFFECT(0.0525,4.9)` | `0.053542667` (truncates to 4) |
| `EFFECT(0,4)` | `#NUM!` |

## Compatibility
Former Analysis ToolPak; built-in since Excel 2007.

## Open questions
- Text coercion of numeric-looking strings (scalar-argument coercion
  rules may apply uniformly — confirm against engine policy).
