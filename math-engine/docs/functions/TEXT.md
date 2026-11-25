# TEXT

`TEXT(value, format_text)` — formats a number (or date serial) as text
using a format code string.

## Arguments
- `value`: number to format. Coerced per direct-argument rules
  (numeric text -> number, boolean -> 1/0, blank -> 0, error propagates).
- `format_text`: a format code string. Non-text input is coerced to text.

## Supported format-code subset (explicit)
The v2 plan (§2, note 057) requires an explicit subset because the full
Excel format-code language is too large to promise. The initial subset:

| Category | Codes | Notes |
|---|---|---|
| Number | `0`, `#`, `?` digit placeholders | `000.00`, `#,##0.##` |
| Thousands | `,` grouping inside integer part | `#,##0` |
| Percent | `%` | multiplies by 100, appends `%` |
| Decimal | `.` | fixed decimal point |
| Date | `yyyy`, `yy`, `mm`, `m`, `dd`, `d` | uses the workbook date system |
| Text placeholder | `@` | only in the text section |
| Sections | up to 2 sections separated by `;` | `positive;negative` |
| Literal text | `"..."` quoted literals inside a code | passed through |

## Errors
- `#VALUE!` when `format_text` is empty or not a recognizable code in the
  supported subset.
- Unsupported-but-parseable codes are documented (see Open questions) —
  the engine must not silently produce wrong output; it returns `#VALUE!`
  for codes outside the subset.

## Edge cases
- `TEXT(1234.567,"0.00")` -> `"1234.57"` (half-away-from-zero rounding to
  match Excel display).
- `TEXT` of a date serial with a date code uses the workbook 1900/1904
  setting (plan §3.1).
- Percent: `TEXT(0.5,"0%")` -> `"50%"`.
- Negative numbers with a single-section code get a leading `-`.

## Open questions
- Unsupported codes to classify: `e`/`E` scientific (`0.00E+00`), color
  names `[Red]`, conditions `[>100]`, locale prefixes `[$-409]`,
  currency literals `[$¥]`, `AM/PM` time codes, `h`, `s`, elapsed `[h]`,
  `mmm`/`ddd` (require locale month/day names), `*x` fill, `_x` space,
  `\` escaping, `&` concatenation inside codes, `G/General`.
- Rounding rule for the final displayed digit on exact ties
  (e.g. `TEXT(2.5,"0")` — Excel gives `"3"`; verify vs banker's).
- Whether text input `TEXT("abc","0")` returns `#VALUE!` or the text
  unchanged (Excel returns `"abc"` for `@`-less codes in some locales).
