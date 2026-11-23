# CHAR

`CHAR(number)` — returns the character for a numeric code. Legacy
function; the modern replacement is `UNICHAR`.

## Arguments
- `number`: required; coerced to number, truncated toward zero to an
  integer. Must be in `1..255`; `0` and `>= 256` -> `#VALUE!`.
  Negative and non-numeric -> `#VALUE!`.

## Semantics (codepage question — SPEC-OPEN)
- In Excel for Windows the result depends on the **ANSI code page** of
  the system (e.g. CP1252 for Western locales, CP932 for Japanese);
  on Mac it uses the Mac character set. `CHAR(10)` is line feed,
  `CHAR(13)` carriage return, `CHAR(9)` tab — these ASCII control
  codes are stable across code pages.
- For a portable engine the deterministic choice is to define `CHAR`
  over a fixed code page (e.g. CP1252 for `128..255`, ASCII for
  `1..127`) and document the deviation in DBCS locales.
- `UNICHAR` is strictly preferred for codes > 127.

## Errors
- `#VALUE!` for `number` outside `1..255` or non-coercible.
- Error in `number` propagates.

## Examples
- `CHAR(65)` -> `"A"`
- `CHAR(10)` -> `"\n"` (line feed)
- `CHAR(0)` -> `#VALUE!`
- `CHAR(256)` -> `#VALUE!`
- `CHAR(233)` -> `"é"` under CP1252; **differs under CP932**
  (SPEC-OPEN — pick fixed mapping).

## Compatibility
- All Excel versions. Pair with `CODE` (inverse). For modern workbooks
  `UNICHAR`/`UNICODE` are preferred because they are codepoint-based
  and locale-independent.

## Open questions
- Which fixed code page to adopt for `128..255` (CP1252 vs CP437 vs
  locale-dependent engine config).
- Whether `CHAR` in a fixed-locale engine should reject `>= 128` as
  unportable instead of guessing (recommend: implement fixed CP1252
  and document).
