# CONCATENATE

`CONCATENATE(text1, [text2], ...)` — legacy join of up to 255 scalar
arguments into one text value. Superseded by `CONCAT` (which also
accepts ranges) and the `&` operator.

## Arguments
- `text1..text255`: each argument is a scalar (literal, cell
  reference, or expression). Unlike `CONCAT`, `CONCATENATE` does NOT
  flatten ranges — passing a range under legacy evaluation is
  **SPEC-OPEN**: in modern Excel the range spills/errors, in implicit-
  intersection legacy mode it picked the intersecting cell. The
  engine should reject multi-cell ranges (`#VALUE!`) unless array
  evaluation is defined (confirm).

## Type coercion
- `Number` -> text-of-number (shared formatting rule — see `LEFT.md`).
- `Boolean` -> `"TRUE"`/`"FALSE"`.
- `Blank` referenced cell -> `""`.
- `Error` propagates (first error in evaluation order).

## Errors
- Any error argument propagates.
- Arity floor: at least 1 argument (Excel requires 1; 0 args is an
  arity error).

## Examples
- `CONCATENATE("a","b","c")` -> `"abc"`
- `CONCATENATE("Total: ",1+2)` -> `"Total: 3"`
- `CONCATENATE("x",TRUE)` -> `"xTRUE"`
- `CONCATENATE("","")` -> `""`
- `CONCATENATE("a",1/0)` -> `#DIV/0!`

## Compatibility
- All Excel versions; kept for backward compatibility. Prefer
  `CONCAT` in new workbooks.

## Open questions
- Range-argument behavior under the engine's evaluation model.
- Output length cap (shared with `CONCAT`: 32,767 Excel limit policy).
