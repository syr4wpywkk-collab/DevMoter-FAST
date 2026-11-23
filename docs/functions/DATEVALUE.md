# DATEVALUE

`DATEVALUE(date_text)` — converts a date stored as text into a date
serial number.

## Arguments
- `date_text`: required; a string (or scalar coercible to string)
  representing a date.

## Semantics
- Locale-dependent parsing: `"12/31/2026"`, `"2026-12-31"`,
  `"31-Dec-2026"`, `"December 31, 2026"` etc. Excel uses the host
  system's short-date settings; our engine must fix a documented,
  deterministic grammar (see Engine requirements).
- Two-digit years: Excel's pivot is system-configurable (default
  2029/2030 rule: 00-29 -> 2000s, 30-99 -> 1900s). Fix and document
  the pivot.
- Time components: Excel accepts `"2026-01-01 15:00"` and returns the
  **date part only** (fraction truncated). Confirm.
- Number-like text (`"45000"`): Excel does NOT accept -> `#VALUE!`
  (confirm).

## Coercion
- Non-text scalars passed to `date_text`: a number -> `#VALUE!`
  (Excel: number arg errors); boolean -> `#VALUE!`. Blank ->
  `#VALUE!`? confirm.

## Errors
- Unparseable text -> `#VALUE!`.
- Parsed date outside serial domain -> `#VALUE!`.

## Examples
- `DATEVALUE("2026-01-01")` -> `46023` (1900 system; verify serial).
- `DATEVALUE("1/1/2026")` -> `46023` under en-US.
- `DATEVALUE("31-Dec-2025")` -> `46022`.
- `DATEVALUE("2/30/2026")` -> `#VALUE!` (invalid day).
- `DATEVALUE("nonsense")` -> `#VALUE!`.

## Engine requirements
- A deterministic date-grammar parser is required. Excel's parsing is
  locale/system dependent and NOT reproducible offline; spec must
  enumerate an accepted-format list (ISO 8601 first) and a fixed
  century pivot. Flag any format not on the list as unsupported.

## Open questions
- Exact accepted-format list (recommend ISO `YYYY-MM-DD`,
  `MM/DD/YYYY`, `DD-Mon-YYYY`, `Month D, YYYY`; expand with reference
  testing).
- Century pivot for 2-digit years.
- Whether time-suffixed strings are accepted (fraction dropped).
