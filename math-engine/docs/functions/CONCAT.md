# CONCAT

`CONCAT(text1, [text2], ...)` — joins arguments into one text value.

`CONCAT` is the modern successor to `CONCATENATE`; unlike `TEXTJOIN`
(out of scope) it has no delimiter and does not skip blanks.

## Arguments
- 1..255 arguments; each may be a scalar, cell ref, **or range**
  (unlike the pre-dynamic `CONCATENATE`, ranges are flattened).

## Type coercion
- `Number` -> text-of-number (formatting rule shared with `LEFT` —
  SPEC-OPEN there applies).
- `Boolean` -> `"TRUE"`/`"FALSE"`.
- `Blank` cells contribute nothing (`""`), including inside ranges.
- `Text` used as-is.
- `Error` (scalar or inside a range) propagates.

## Range flattening
- A range `A1:B2` contributes its cells in **row-major order**
  (Excel behavior — confirm against reference).
- Nested arrays flatten recursively in row-major order.

## Errors
- Any error argument or error cell inside a range propagates the
  first error encountered in evaluation order.
- Result length: no documented Excel limit enforced initially;
  **SPEC-OPEN** whether to cap output size (Excel caps cell text at
  32767 chars — decide whether the engine truncates or errors).

## Edge cases
- `CONCAT()` zero args -> parse/arity error (confirm arity floor).
- `CONCAT(A1:A3)` -> concatenation of the three cells.
- Empty-string results are allowed.

## Open questions
- Row-major vs column-major range flattening (expected row-major).
- Output-length cap policy.
- Number formatting shared with other text functions.
