# MEDIAN

`MEDIAN(number1, [number2], ...)` — middle value of the counted numbers.

## Arguments
- 1..255 arguments; scalars, cell refs, ranges.

## Type coercion
- Same as `SUM.md`: range args ignore text/boolean/blank, propagate
  errors; direct args coerce numeric text/booleans, `#VALUE!` on other
  text.

## Computation
- `n` odd -> the `(n+1)/2`-th smallest value.
- `n` even -> the arithmetic mean of the two middle values.
- Implementation may sort or use a selection algorithm (plan §6 Phase
  5 mentions selection); equal output is what matters.

## Errors
- `n = 0` (no numeric inputs) -> `#NUM!` (Excel behavior — confirm;
  some sources say `#DIV/0!` is wrong, `#NUM!` is correct).
- Errors propagate; non-coercible direct text -> `#VALUE!`.

## Edge cases
- Single value -> that value.
- Two middle values straddling representable precision — plain
  `(a+b)/2` may overflow for extreme `f64`; use `a/2 + b/2` or
  `a + (b-a)/2` (document choice).
- Duplicates and negatives handled naturally by ordering.

## Open questions
- Empty-input error kind (`#NUM!` expected).
- Midpoint formula for extreme magnitudes.
