# GCD

`GCD(number1, [number2], ...)` — greatest common divisor of one or
more integers.

## Arguments
- `number1..numberN`: 1–255 numeric arguments, each truncated to a
  non-negative integer. Ranges and arrays are accepted and flattened;
  blank cells and text inside ranges are ignored? (**SPEC-OPEN** —
  for aggregate-style functions Excel ignores non-numeric cells in
  ranges but errors on direct text args; confirm GCD follows that
  convention).

## Semantics
- `GCD(5,2)` -> `1`; `GCD(24,36)` -> `12`; `GCD(7,1)` -> `1`;
  `GCD(0,0)` -> `0`? (**SPEC-OPEN** — Excel returns `0` for all-zero
  input? docs say GCD(0,0) -> `#NUM!`? Confirm: Excel returns `0`?).
  Actually `GCD(0,5)` -> `5` is standard; all-zeros edge flagged.
- Result is always a non-negative integer (inputs truncated to
  absolute value — `GCD(-6,4)`? docs: "if any argument is negative,
  GCD returns #NUM!" — so negatives error, not abs; see errors).

## Coercion
- Direct scalar args: numeric text coerces, booleans coerce,
  blanks -> 0. Non-numeric direct args -> `#VALUE!`.
- Decimal args truncated (documented).

## Errors
- Any argument `< 0` after truncation -> `#NUM!`.
- Any argument `>= 2^53` -> `#NUM!`.
- No arguments / all-empty range -> `#VALUE!`? (**SPEC-OPEN** —
  Excel requires at least one arg; empty range returns `#NUM!`?).

## Examples
| Formula | Result |
|---|---|
| `=GCD(5,2)` | 1 |
| `=GCD(24,36)` | 12 |
| `=GCD(7,0)` | 7 |
| `=GCD(-6,4)` | #NUM! |

## Compatibility
- Excel 2007+ natively; Analysis ToolPak in Excel 2003.

## Open questions
- All-zeros input result (`0` vs `#NUM!`).
- Empty-range behavior.
- Range-cell coercion rules (text/blank/bool inside ranges).
