# SUMSQ

`SUMSQ(number1, [number2], ...)` — returns the sum of the squares of
the arguments.

## Arguments
- `number1..N`: 1..255 numeric scalars, ranges, or arrays.

## Behavior
- `SUMSQ(3,4)` -> 25; `SUMSQ({1,2;3,4})` -> 30.
- Range/array arguments follow the aggregate scanning model: numeric
  cells count; text and blanks inside ranges are ignored; booleans
  inside ranges are ignored per Excel rules (confirm vs SUM).
- Direct scalar args coerce: `"3"` -> 9 contribution; `TRUE` -> 1.

## Errors
- No-count case: `SUMSQ()` empty -> arity error; a range with no
  numbers returns 0 (not `#DIV/0!` — unlike AVERAGE).
- Coercion failures on direct args -> `#VALUE!`; errors inside ranges
  propagate.

## Edge cases
- Overflow to non-finite -> `#NUM!` (shared policy).

## Open questions
- Boolean handling inside range arguments (ignored vs counted).
