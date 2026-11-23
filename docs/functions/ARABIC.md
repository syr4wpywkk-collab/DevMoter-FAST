# ARABIC

`ARABIC(text)` — converts a Roman numeral string to an Arabic
(integer) number.

## Arguments
- `text`: required, text coercion. A string of Roman numerals —
  `I V X L C D M` (case-insensitive) plus optional leading/trailing
  spaces and a leading `+` or `-` sign.

## Semantics
- Standard subtractive notation (`IV`=4, `IX`=9, `XL`=40, `XC`=90,
  `CD`=400, `CM`=900).
- Valid range: `-3999..3999` (as text; no zero numeral — empty string
  -> `0`? **SPEC-OPEN** — confirm; `ARABIC("")` reported to return
  `#VALUE!` in some references).
- Case-insensitive: `ARABIC("mcmxii")` -> 1912.
- Non-subtractive forms are evaluated additively, e.g.
  `ARABIC("IIII")` -> 4? (**SPEC-OPEN** — Excel accepts some
  non-canonical strings; exact grammar needs confirmation).

## Coercion
- A number passed as `text` -> `#VALUE!`? (**SPEC-OPEN** — confirm;
  likely `#VALUE!` since the argument is typed as text).
- Boolean/blank inputs — confirm; expected `#VALUE!`/`0`.

## Errors
- Invalid characters, or value out of range -> `#VALUE!`.
- `ARABIC("ABC")` -> `#VALUE!` (contains non-numeral chars? `C` is a
  numeral but `AB` invalid — grammar check needed).

## Examples
| Formula | Result |
|---|---|
| `=ARABIC("LVII")` | 57 |
| `=ARABIC("MCMXII")` | 1912 |
| `=ARABIC("-XIV")` | -14 |

## Compatibility
- **Excel 2013+** (`_xlfn.ARABIC`). Inverse of `ROMAN`.

## Open questions
- Empty-string result (`#VALUE!` vs `0`).
- Whether numerics/booleans coerce or error.
- Tolerance for non-canonical orderings (`IL`, `VX`, `IIII`).
- Leading/trailing whitespace handling (reported ignored).
