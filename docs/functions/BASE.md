# BASE

`BASE(number, radix, [min_length])` — converts a non-negative decimal
integer to a text representation in `radix` (2–36).

## Arguments
- `number`: required, `0 <= number < 2^53` (documented limit;
  non-integers truncated? **SPEC-OPEN** — confirm truncation).
- `radix`: required integer, `2 <= radix <= 36`.
- `min_length`: optional, default `0`; result is left-padded with
  `0` to at least this length. Max `255`.

## Semantics
- Digits are `0-9` then `A-Z` (uppercase output).
- `BASE(7,2)` -> `"111"`; `BASE(100,16)` -> `"64"`;
  `BASE(15,2,10)` -> `"0000001111"`.
- Returns **text**, not a number.

## Coercion
- Numeric coercion for all args: numeric text ok, booleans -> 1/0,
  blank -> 0. Non-numeric -> `#VALUE!`.

## Errors
- `number < 0`, `number >= 2^53`, `radix` outside 2–36, or
  `min_length` > 255 -> `#NUM!`.
- `#VALUE!` on failed coercion or arity violations.

## Examples
| Formula | Result |
|---|---|
| `=BASE(7,2)` | "111" |
| `=BASE(100,16)` | "64" |
| `=BASE(15,2,10)` | "0000001111" |
| `=BASE(10,37)` | #NUM! |

## Compatibility
- **Excel 2013+** (`_xlfn.BASE`). Inverse of `DECIMAL`. Supersedes
  DEC2BIN/DEC2OCT/DEC2HEX which have narrower ranges.

## Open questions
- Truncation vs rounding of non-integer `number`/`radix`/`min_length`.
- Whether `number >= 2^53` errors (`#NUM!` documented) or silently
  loses precision — fixture needed.
