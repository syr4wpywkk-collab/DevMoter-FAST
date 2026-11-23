# OR

`OR(logical1, [logical2], ...)` — TRUE if any logical arg is TRUE.

## Coercion
Identical to AND (numbers coerce, ranges ignore text/blanks, direct text
is `#VALUE!`, no usable values -> `#VALUE!`).

## Errors / evaluation order
- Same open question as AND (P1-AND-009): `OR(TRUE,1/0)` propagation vs
  determined-TRUE. **SPEC-OPEN**; do not assume short circuit.

## Edge cases
- `OR(0,0)` -> FALSE; `OR(-1,0)` -> TRUE.
- Range of only text/blank -> `#VALUE!`.

## Confirm against reference
- Same items as AND.
