# IFS

`IFS(logical_test1, value_if_true1, [logical_test2, value_if_true2], ...)` —
returns the value paired with the first TRUE condition.

v2 plan §2 (085): condition/value pairs, left-to-right evaluation,
unselected branches not evaluated.

## Arguments
- 1..127 condition/value pairs (Excel allows up to 127 conditions).
- Conditions coerce like `IF`'s `logical_test`: boolean as-is; number
  nonzero TRUE / zero FALSE; text -> `#VALUE!`; error propagates;
  blank -> open (mirror IF's SPEC-OPEN P1-IF-012).

## Behavior
- `IFS(A1>90,"A", A1>80,"B", TRUE,"C")` -> first match wins.
- **Lazy evaluation**: conditions are evaluated left to right and
  evaluation stops at the first TRUE; the paired value is the only
  value argument evaluated — `IFS(FALSE, 1/0, TRUE, 7)` -> `7`.
- Later conditions are not evaluated at all:
  `IFS(TRUE, 1, 1/0, 2)` -> `1`.

## Errors
- No TRUE condition -> `#N/A` (Excel; there is no default branch —
  idiom is a trailing `TRUE` condition).
- Odd argument count (dangling condition without value) -> parse/arity
  error (confirm error class).
- Coercion failure in an evaluated condition -> `#VALUE!`.

## Edge cases
- `IFS(FALSE,1)` with nothing else -> `#N/A`.
- Error value in a *later, unreached* pair does not propagate.
- Deep pair lists count against parser/evaluator budget (plan §4).

## Open questions
- Blank cell as condition: FALSE vs `#VALUE!` (same as IF).
- Odd-arity error classification.
