# BIN2DEC

`BIN2DEC(number)` — converts a signed two's-complement binary string to
decimal.

## Arguments
- `number`: required; a binary string of at most **10 characters**
  (10 bits). May be passed as a number (digits `0`/`1` only) or text.

## Semantics
- 10-character input with leading `1` is interpreted as two's
  complement: `"1111111111"` -> `-1`, `"1000000000"` -> `-512`.
- Fewer than 10 characters: treated as a positive binary number
  (`"1010"` -> `10`). Sign extension applies only at exactly 10 chars.
- Returns a decimal number in the range `-512` to `511`.

## Coercion
- A numeric argument whose digits are all `0`/`1` is accepted
  (`BIN2DEC(101)` = `5`) — leading zeros are lost, which matters only
  for the 10-bit two's-complement rule (a numeric argument can never be
  negative-in-10-bits because leading `1`s are dropped — confirm).
- Boolean `TRUE`/`FALSE` passed directly -> `#NUM!` or coercion?
  **SPEC-OPEN** (Excel treats `TRUE` as non-binary).
- Blank argument -> `0` (confirm).

## Errors
- More than 10 characters -> `#NUM!`.
- Any character other than `0`/`1` -> `#NUM!` (including sign
  characters and spaces).
- Non-numeric, non-binary text -> `#NUM!` (not `#VALUE!` — Excel uses
  `#NUM!` for invalid input here).

## Examples
- `BIN2DEC("1100100")` = `100`
- `BIN2DEC("1111111111")` = `-1`
- `BIN2DEC("1000000000")` = `-512`
- `BIN2DEC("0111111111")` = `511`
- `BIN2DEC("2")` -> `#NUM!`
- `BIN2DEC("11111111111")` (11 chars) -> `#NUM!`

## Compatibility notes
- Excel 2003+ (Analysis ToolPak earlier). `BASE`/`DECIMAL` supersede it
  for general conversions but have different sign semantics.

## Open questions
- Whether numeric (not text) `1111111111` is accepted and, if so, how
  signedness is determined (documented: yes, value `-1` — confirm).
- Boolean/blank coercion.
- Whether surrounding whitespace is trimmed (expected: no -> `#NUM!`).
