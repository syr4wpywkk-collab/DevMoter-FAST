# VALUETOTEXT

`VALUETOTEXT(value, [format])` — converts any value to text, in
"concise" (default) or "strict" (round-trippable) format. Scalar
counterpart of `ARRAYTOTEXT` (which delegates to it per-element).

## Arguments
- `value`: required scalar.
- `format`: optional `0` (default) concise, `1` strict. Other values
  -> `#VALUE!`; truncated toward zero.

## Semantics
- Concise (`0`):
  - `Text` -> the text unchanged (unquoted).
  - `Number` -> general number formatting.
  - `Boolean` -> `"TRUE"`/`"FALSE"`.
  - `Blank` -> `""`.
  - `Error` -> the error code text (e.g. `"#N/A"`)? — Excel returns
    the error's text form; **confirm** vs propagation.
- Strict (`1`):
  - `Text` -> double-quoted, inner quotes doubled: `"a"` -> `"""a"""`.
  - `Number`/`Boolean` -> same as concise.
  - `Blank` -> `""` (empty, unquoted — verify).
  - `Error` -> error code text.
- Scalar input never gets `{}` braces (that is `ARRAYTOTEXT`-only).

## Errors
- `format` not 0/1 -> `#VALUE!`.
- Error `value`: rendered vs propagated — SPEC-OPEN.

## Examples
- `VALUETOTEXT("hello")` -> `"hello"`
- `VALUETOTEXT("hello",1)` -> `"""hello"""`
- `VALUETOTEXT(123.5)` -> `"123.5"`
- `VALUETOTEXT(TRUE)` -> `"TRUE"`
- `VALUETOTEXT(TRUE,1)` -> `"TRUE"`
- `VALUETOTEXT(A1)` with A1 blank -> `""`
- `VALUETOTEXT("x",2)` -> `#VALUE!`

## Compatibility
- Excel 2021+ / Microsoft 365; pairs with `ARRAYTOTEXT`. Not in
  Excel 2019- (`#NAME?`).

## Open questions
- Error-value rendering (text vs propagate).
- Number-formatting rule (general format precision; how many digits;
  scientific threshold).
- Strict mode for `Blank` (expected `""`, verify).
