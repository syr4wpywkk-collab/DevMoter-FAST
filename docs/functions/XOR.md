# XOR

`XOR(logical1, [logical2], ...)` — returns TRUE when an **odd** number
of arguments are TRUE (logical exclusive-or over all arguments).

## Arguments
- `logical1..N`: 1..254 args. Unlike `AND`/`OR`, empty ranges and
  text-only inputs produce an error rather than being ignored —
  see errors.

## Behavior
- `XOR(TRUE, FALSE)` -> TRUE; `XOR(TRUE, TRUE)` -> FALSE;
  `XOR(TRUE, TRUE, TRUE)` -> TRUE (odd count rule).
- `XOR(3>2, 2>3, 1>0)` -> FALSE (two of the three args are true —
  an even count).
- Range/array arguments: booleans and numbers count (numbers coerce:
  nonzero TRUE, 0 FALSE); text and empty cells inside ranges are
  **ignored** (same scanning model as AND/OR — confirm).
- Direct scalar args coerce: `"TRUE"` -> TRUE, `"text"` -> `#VALUE!`,
  `1`/`0` -> booleans.

## Errors
- `XOR()` with zero effective logical values across all arguments
  (e.g. `XOR("abc", {blank-range})`) -> `#VALUE!` (documented Excel:
  "must evaluate to logical values").
- Coercion failures on direct text -> `#VALUE!`; errors propagate.

## Compatibility
- Introduced in Excel 2013.

## Open questions
- Blank cells inside ranges: ignored (assumed, same as AND/OR).
- Whether a direct blank argument counts as FALSE or is ignored.
