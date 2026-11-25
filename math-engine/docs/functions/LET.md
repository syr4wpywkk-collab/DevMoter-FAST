# LET

`LET(name1, value1, [name2, value2], ..., result)` — binds names to
values and evaluates `result` in that scope.

## Arguments
- Odd number >= 3 of arguments: alternating `name, value` pairs then a
  final result expression.
- `name` must be a valid identifier, not a cell reference, not a
  reserved word; redefining an existing name shadows it.

## Scoping
- Each `value` is evaluated in the scope of the *preceding* bindings
  only: `LET(x,1,y,x+1,y*2)` -> `4`.
- Later names may shadow earlier ones: `LET(x,1,x,x+1,x)` — the second
  `x` binding sees the first `x`. Excel rejects duplicate names; see
  open questions.
- Bindings are lazy-capable but the engine may evaluate eagerly —
  `LET(x,1/0,5)` behavior depends on this; see open questions.

## Evaluation order
- Left to right, sequential scope accumulation (plan §2 note 097:
  評価順序).

## Errors
- `#NAME?` for an invalid name token; parse error for even arg count.
- Errors inside evaluated expressions propagate.

## Edge cases
- Names do not leak outside the call.
- Nested LETs create nested scopes; inner names shadow outer.

## Open questions
- Whether unused bound values are evaluated eagerly (Excel evaluates
  lazily per current docs — `LET(x,1/0,5)` returns `5`); decide lazy vs
  eager and fixture it.
- Whether duplicate names are allowed (Excel: `#N/A`-adjacent error) or
  shadowing is permitted.
- Case-insensitivity of bound names (Excel names are case-insensitive).
