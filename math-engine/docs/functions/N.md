# N

`N(value)` — converts `value` to a number under Excel's fixed
conversion table.

v3 expansion (track S10).

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Conversion table
| Input kind | Result |
|---|---|
| Number | the number unchanged |
| Date/time serial | the serial number (dates ARE numbers) |
| `TRUE` | `1` |
| `FALSE` | `0` |
| Text (incl. `"5"`, `""`) | `0` — **no numeric parsing** |
| Blank | `0` |
| Error | the error propagates |
| Array | element-wise (spills) in modern Excel; under implicit
  intersection takes the intersecting element — open question for
  this engine |

## Semantics
- `N` is NOT `VALUE`: `N("5")` -> `0` while `VALUE("5")` -> `5`.
- `N` on a range used as a scalar extracts one cell (legacy implicit
  intersection) — engine behavior before spill is an open question.
- Historically used to embed comments: `+N("note")` adds 0 for text.

## Errors
- Propagates error inputs.

## Examples
- `=N(3.5)` -> `3.5`
- `=N(TRUE)` -> `1`
- `=N("17")` -> `0`
- `=N(A1)` (A1 empty) -> `0`
- `=N(DATE(2020,1,1))` -> `43831` (1900 date system; serial of
  2020-01-01)

## Open questions
- Array argument semantics (elementwise spill vs first element).
- Behavior on `Lambda` values / other exotic value kinds — presumably
  `#VALUE!`, unconfirmed.
