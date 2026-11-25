# FVSCHEDULE

`FVSCHEDULE(principal, schedule)` — returns the future value of an
initial principal after applying a series of varying compound rates.

## Arguments
- `principal`: present value. Required scalar.
- `schedule`: array/range of per-period rates. Required; each element
  applied in order.

## Semantics
`principal · Π (1 + rateᵢ)`. Rates may be negative; an empty schedule
returns `principal` (confirm — Excel returns `principal` unchanged for
an empty array?).

## Coercion and errors
- Elements of `schedule`: numbers coerce normally; **blank cells and
  text in a schedule range are treated as `0`** (documented Excel
  behavior — blanks/text → 0% rate). Error cells propagate.
- Non-numeric `principal` -> `#VALUE!`.
- `schedule` as a literal array `{0.09,0.11,0.1}` works.

## Examples
| Formula | Result |
|---|---|
| `FVSCHEDULE(1,{0.09,0.11,0.1})` | `1.33089` |
| `FVSCHEDULE(100,{0.05,-0.02})` | `102.9` |
| `FVSCHEDULE(100,{0.05,0,0.05})` | `110.25` (text/blank → 0) |
| `FVSCHEDULE(100,"x")` | `#VALUE!` (scalar text arg vs range cell — confirm) |

## Compatibility
Former Analysis ToolPak; built-in since Excel 2007. No `PV`-schedule
inverse exists in Excel.

## Open questions
- Text-vs-blank treatment difference between range elements and direct
  scalar arguments inside `schedule` array literals.
- Empty-schedule result.
