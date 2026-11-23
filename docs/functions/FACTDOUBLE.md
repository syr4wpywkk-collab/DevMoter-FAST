# FACTDOUBLE

`FACTDOUBLE(number)` — double factorial `n!!`:
`n*(n-2)*(n-4)*...*2` for even n, `...*1` for odd n.

## Arguments
- `number`: required, truncated to integer `n`.

## Semantics
- `FACTDOUBLE(6)` -> `6*4*2 = 48`; `FACTDOUBLE(7)` ->
  `7*5*3*1 = 105`; `FACTDOUBLE(0)` -> `1`; `FACTDOUBLE(-1)` -> `1`?
  (**SPEC-OPEN** — Excel docs define `FACTDOUBLE(0)=1` and
  `FACTDOUBLE(-1)=1` per double-factorial convention; negative below
  -1 errors? docs say "if number is not an integer it is truncated"
  and error only for n < -2? Confirm: `#NUM!` when `n <= -2`?).
  Microsoft's doc: returns `#NUM!` if `number < 0` — but then
  defines `FACTDOUBLE(0)=1` and `FACTDOUBLE(-1)=1` explicitly.
  Flag contradiction -> **SPEC-OPEN**.

## Coercion
- Numeric coercion + truncation; non-numeric -> `#VALUE!`.

## Errors
- `number <= -2` -> `#NUM!` (per docs; see open question).
- Overflow -> `#NUM!` (max n ~ 297; `FACTDOUBLE(300)` overflows).

## Examples
| Formula | Result |
|---|---|
| `=FACTDOUBLE(6)` | 48 |
| `=FACTDOUBLE(7)` | 105 |
| `=FACTDOUBLE(10)` | 3840 |

## Compatibility
- Excel 2007+ (was Analysis ToolPak in 2003).

## Open questions
- Contradiction in MS docs: `n < 0` -> `#NUM!` yet
  `FACTDOUBLE(-1)=1` stated. Resolve with reference fixture.
- Exact overflow threshold (~n=298?).
