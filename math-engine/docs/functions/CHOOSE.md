# CHOOSE

`CHOOSE(index_num, value1, [value2], ...)` — returns the `index_num`-th
argument.

v2 plan §2 (052): index-driven branch; lazy evaluation of unselected
arguments.

## Arguments
- `index_num`: numeric scalar, direct coercion; fractional truncated.
- `value1..valueN`: up to 254 values; any type including ranges/arrays.

## Behavior
- `CHOOSE(2, "a", "b", "c")` -> `"b"`.
- **Lazy evaluation**: only the selected argument is evaluated —
  `CHOOSE(1, 42, 1/0)` -> `42`, not `#DIV/0!` (same discipline as
  `IF`). Requires the evaluator to pass unevaluated argument nodes to
  the function.
- Selected argument may be a range -> returns a range/array value
  (feeds `SUM(CHOOSE(2, A1:A3, B1:B3))` idiom); works only if the
  engine's value model carries ranges.

## Errors
- `index_num` < 1 or > number of value args -> `#VALUE!`.
- `index_num` coerced to 0 -> `#VALUE!`.
- Coercion failure of `index_num` -> `#VALUE!`.
- Error in the *selected* argument propagates; errors in unselected
  arguments do not.

## Edge cases
- `CHOOSE(1.9, ...)` -> index 1 (truncation toward zero).
- `CHOOSE(TRUE, a, b)` -> a (boolean coercion — confirm).
- Range-valued result feeding scalar context -> implicit intersection
  or `#VALUE!` depending on engine policy — open.

## Open questions
- Whether lazy evaluation is guaranteed (plan says yes; confirm no
  eager-arg code path bypasses it).
- Range result in scalar context: intersection vs error.
