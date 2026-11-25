# NUMBERVALUE

`NUMBERVALUE(text, [decimal_separator], [group_separator])` — parses
text into a number with explicit decimal/group separators; the
locale-independent counterpart to `VALUE`.

## Arguments
- `text`: required; coerced to text.
- `decimal_separator`: optional; single-character text. Default: the
  locale decimal separator — for the fixed-locale engine, `"."`.
- `group_separator`: optional; single-character text. Default: the
  locale group separator — for the fixed-locale engine, `","`.

## Semantics
- Strips group separators anywhere they appear in the integer part
  (Excel does NOT validate grouping positions — `"1,2,3"` parses as
  `123`; **confirm** vs `VALUE` which validates grouping).
- At most one decimal separator; a second occurrence -> `#VALUE!`.
- Trailing `%`: each `%` divides by 100 (`"9%%"` -> 0.0009; confirm
  multiple-`%` support — documented Excel behavior supports them).
- Leading/trailing whitespace ignored; exponent notation `E`/`e`
  accepted; sign allowed.
- Empty `text` or text resolving to empty -> `0` (Excel returns 0 for
  `""` here, unlike `VALUE` — confirm) — **SPEC-OPEN**.
- Date/time/currency text is NOT parsed (unlike `VALUE`); only plain
  numerics plus separators and `%` -> `#VALUE!` for `"$1"`, `"1/2"`,
  `"2020-01-01"`.

## Errors
- `#VALUE!` for unparseable text, wrong separators, duplicated
  decimal separator, or separator args longer than 1 char /
  containing digits (confirm last rule).
- Errors propagate.

## Examples
- `NUMBERVALUE("2.500,27",",",".")` -> `2500.27`
- `NUMBERVALUE("1,234.5")` -> `1234.5` (defaults `.` / `,`)
- `NUMBERVALUE("9%")` -> `0.09`
- `NUMBERVALUE("1.234,5",".",",")` — decimal `.` group `,`:
  `"1.234,5"` -> `1234.5`? Careful: decimal is `"."` so `1.234` then
  `,` is group -> `1234.5` — verify fixture intent; safer example:
  `NUMBERVALUE("2500,27",",")` -> `2500.27`
- `NUMBERVALUE("abc")` -> `#VALUE!`

## Compatibility
- Excel 2013+. Preferred over `VALUE` for portable files because the
  separators are explicit.

## Open questions
- `""` result (0 vs `#VALUE!`).
- Multiple `%` handling and whether `%` may appear mid-string.
- Whether group separators are position-validated (expected: no).
- Whitespace set (space only vs Unicode whitespace, NBSP).
