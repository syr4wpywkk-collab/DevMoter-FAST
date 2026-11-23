# AND

`AND(logical1, [logical2], ...)` — TRUE if all logical args are TRUE.

## Coercion
- boolean -> as-is; number -> nonzero TRUE, zero FALSE.
- In ranges: text and blank cells ignored; only booleans/numbers used.
- In direct args: text -> `#VALUE!`; blank ref -> FALSE (verify).
- If after ignoring there are no logical values -> `#VALUE!`.

## Errors / evaluation order
- Excel evaluates *all* arguments; it is not a short-circuit language.
  Plan §5 warns against assuming short-circuit semantics.
- **SPEC-OPEN** (P1-AND-009): `AND(FALSE,1/0)` — does the sibling error
  propagate or does the determined FALSE win? Must be recorded in Excel
  before fixing the rule (expectation: error propagates).

## Edge cases
- `AND(1,2)` -> TRUE; `AND()` with only blank range -> `#VALUE!`.
- Empty argument list is an arity/parse error.

## Confirm against reference
- Error propagation, blank-ref coercion, no-logical-values case.
