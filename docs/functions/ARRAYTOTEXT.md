# ARRAYTOTEXT

`ARRAYTOTEXT(array, [format])` — converts an array or range into a
single text value listing its elements.

## Arguments
- `array`: required; scalar, range, or array value.
- `format`: optional; `0` (default) "concise" — plain comma+space
  separated values; `1` "strict" — output is Excel array-constant
  syntax (`{"a","b";1,2}`) with text quoted, booleans as `TRUE`/`FALSE`,
  errors as their literal codes. Other values -> `#VALUE!`.
- `format` is coerced to number and truncated toward zero; only `0`
  and `1` are accepted.

## Semantics
- Concise format (`0`): elements joined by `", "` row-major; text is
  emitted unquoted; numbers in general format; booleans as
  `TRUE`/`FALSE`; blanks as empty; errors appear as their code text
  (e.g. `#N/A`).
- Strict format (`1`): rows separated by `;`, columns by `,`; the
  whole result wrapped in `{}`; text elements are double-quoted with
  inner quotes doubled; scalars return a plain value (no braces).
- Scalar input returns the concise/strict text form of that value.

## Coercion
- Non-array scalar input is treated as a 1x1 array.
- `format` non-numeric text -> `#VALUE!`.

## Errors
- `format` not 0 or 1 -> `#VALUE!`.
- Error cells inside `array` are rendered (not propagated) in both
  formats — confirm vs reference.

## Examples
- `ARRAYTOTEXT({1,2,3})` -> `"1, 2, 3"`
- `ARRAYTOTEXT({"a","b";1,2},1)` -> `{"a","b";1,2}` (as text `{"a","b";1,2}`)
- `ARRAYTOTEXT("hi")` -> `"hi"`
- `ARRAYTOTEXT({TRUE,"x"},1)` -> `{TRUE,"x"}`
- `ARRAYTOTEXT({1,2},2)` -> `#VALUE!`

## Compatibility
- Excel 2021+ / Microsoft 365 only; LibreOffice supports it too.
  Not available in perpetual Excel 2019 and earlier (`#NAME?` there).

## Open questions
- Whether error cells render as their error-code text or propagate the
  error as the result.
- Number formatting used inside strict mode (general format vs full
  precision; e.g. `0.1+0.2` representation).
- Column separator `,` vs locale-dependent separator in strict mode
  (Excel uses fixed `,`/`;` regardless of locale — verify).
