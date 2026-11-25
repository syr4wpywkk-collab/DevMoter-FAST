# IF

`IF(logical_test, [value_if_true], [value_if_false])`

## Behavior — lazy evaluation
- Only the selected branch is evaluated (plan §5): `IF(FALSE,1/0,42)`
  returns `42`, not `#DIV/0!`.
- Condition coercion: boolean -> as-is; number -> nonzero TRUE / zero
  FALSE; text -> `#VALUE!`; error -> propagates.
- **SPEC-OPEN** (P1-IF-012): blank cell as condition — expected FALSE in
  Excel; confirm vs `#VALUE!`.

## Omitted arguments
- `IF(cond, v)` with `cond` FALSE -> returns `FALSE` (boolean).
- `IF(cond, v)` with `cond` TRUE -> returns `v`.
- `IF(cond,,)` / trailing comma forms -> confirm arity rules (plan treats
  too-few-arguments as parse error, see IFERROR note below).

## Edge cases
- Branch may itself error — that error is the result.
- Nested IFs count toward parser depth limit (plan §4).

## Confirm against reference
- Blank condition, empty `value_if_false` (`IF(FALSE,1,)` returns 0?),
  and error-in-condition propagation.
