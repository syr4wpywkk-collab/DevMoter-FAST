# DECIMAL

`DECIMAL(text, radix)` — converts a text representation of a number in
`radix` (2–36) to a decimal integer.

## Arguments
- `text`: required, text coercion. Case-insensitive digits `0-9A-Z`
  valid for the given radix; up to 255 characters. Leading/trailing
  spaces and a leading `+`/`-`? (**SPEC-OPEN** — docs allow a sign
  only via... confirm: Excel DECIMAL does NOT accept a leading
  minus? Actually documented: "text can be any combination of
  alphanumeric characters valid for the radix"; sign handling
  unconfirmed).
- `radix`: required, `2..36`.

## Semantics
- `DECIMAL("FF",16)` -> `255`; `DECIMAL("111",2)` -> `7`;
  `DECIMAL("zap",36)` -> `45744`? compute: z=35,a=10,p=25 ->
  35*36^2+10*36+25 = 45360+360+25 = 45745. **Fixture**: use
  `DECIMAL("17",8)` -> `15` instead for the third example.
- Non-integer text or invalid digit for radix -> `#NUM!`? or
  `#VALUE!` — documented as `#NUM!` when text/radix out of range.

## Coercion
- `text` arg: number passed directly coerces to its digit string?
  (`DECIMAL(111,2)` -> `7`? **SPEC-OPEN** — likely coerced to "111").
- `radix` coerces numerically; blank/text radix errors.

## Errors
- `radix` outside 2–36, or result >= 2^53, or invalid `text` ->
  `#NUM!` (documented `#NUM!` for all three).
- `#VALUE!` on arity/coercion failures.

## Examples
| Formula | Result |
|---|---|
| `=DECIMAL("FF",16)` | 255 |
| `=DECIMAL("111",2)` | 7 |
| `=DECIMAL("17",8)` | 15 |
| `=DECIMAL("FACE",16)` | 64206 |

## Compatibility
- **Excel 2013+** (`_xlfn.DECIMAL`). Inverse of `BASE`; generalizes
  BIN2DEC/OCT2DEC/HEX2DEC.

## Open questions
- Sign prefix handling in `text`.
- Whether numeric `text` argument is coerced to digits.
- Behavior on fractional text (`"1.1"`) — error expected.
