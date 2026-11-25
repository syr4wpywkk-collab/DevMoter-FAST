# BITAND

`BITAND(number1, number2)` — returns the bitwise AND of two
non-negative integers.

## Arguments
- `number1`, `number2`: required numeric; each must be a non-negative
  integer after truncation, less than `2^48` (281,474,976,710,656).

## Semantics
- Returns a scalar number: the integer whose bits are set where *both*
  operands have a set bit.
- Non-integer inputs are truncated toward zero before the operation
  (confirm — documented as truncating).

## Errors
- Negative argument -> `#NUM!`.
- Argument >= `2^48` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Examples
- `BITAND(1, 5)` = `1` (`0001 & 0101`)
- `BITAND(13, 25)` = `9` (`01101 & 11001`)
- `BITAND(255, 240)` = `240`
- `BITAND(-1, 1)` -> `#NUM!`
- `BITAND(281474976710656, 1)` -> `#NUM!`

## Compatibility notes
- Introduced in Excel 2013. Not in earlier versions.

## Engine requirements
- Integer bitwise ops on 48-bit unsigned values (fits in `u64`/`i64`);
  requires checking the argument is within `[0, 2^48)` after truncation.

## Open questions
- Whether fractional args truncate or error — Microsoft docs say "not
  an integer" -> `#NUM!`; need to confirm whether `2.9` errors or uses
  `2` (confirm — docs list `#NUM!` for non-integer values, but the
  function family is documented to truncate; verify).
- Blank argument -> `0` (confirm).
