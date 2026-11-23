# DATEDIF

`DATEDIF(start_date, end_date, unit)` — difference between two dates
in whole units. Legacy Lotus 1-2-3 compatibility function;
undocumented in Excel help for many versions but fully supported.

## Arguments
- `start_date`, `end_date`: required date serials. `start <= end`
  required else `#NUM!`.
- `unit`: required text (case-insensitive? Excel accepts `"Y"` etc.
  case — confirm; docs show uppercase), one of:
  - `"Y"` complete years
  - `"M"` complete calendar months
  - `"D"` days (same as subtraction)
  - `"MD"` days ignoring months and years (notoriously buggy —
    known Excel defect: may return negative values, e.g. end on the
    31st and start later in month; document whether to replicate
    Excel's bug or fix it — **SPEC-OPEN**)
  - `"YM"` months ignoring years (months mod 12)
  - `"YD"` days ignoring years

## Semantics
- `"Y"`: `end.year - start.year` minus 1 if `end`'s month/day precedes
  `start`'s.
- `"M"`: `12*dy + dm` minus 1 if `end.day < start.day`.
- `"MD"`: intended `end.day - start.day` style day-of-month diff with
  a borrow; Excel's implementation is buggy in the borrow case.
- `"YD"`: days between start and end treating them as in the same
  year — implemented via shifting `end` into `start`'s year context;
  leap-boundary behavior to verify.

## Coercion
- Date serials; text dates coerced per `DATEVALUE`-style rules
  (Excel accepts text dates — confirm engine policy).
- `unit` must be text; invalid -> `#NUM!`.

## Errors
- `start > end` -> `#NUM!`.
- Invalid `unit` -> `#NUM!`.
- Non-date/un-coercible -> `#VALUE!`.

## Examples
- `DATEDIF(43831, 44927, "Y")` -> `3` (2001-01-01 -> 2004-01-01? pick
  clean: `DATEDIF(44197, 45292, "Y")` = 2021-01-01 -> 2023-12-31 = 2
  complete years).
- `DATEDIF(44197, 45292, "M")` -> `35`.
- `DATEDIF(44197, 45292, "D")` -> `1095`.
- `DATEDIF(44197, 45292, "YM")` -> `11`.
- `DATEDIF(44197, 45292, "MD")` -> `30`? — buggy unit; fixture must be
  generated from a reference Excel and documented.
- `DATEDIF(45292, 44197, "Y")` -> `#NUM!`.

## Open questions
- Whether to replicate the `"MD"` negative-result bug or produce the
  mathematically intended value (policy decision — flag).
- `"YD"` definition across leap years (shifting start's day-of-year).
- Case sensitivity of `unit`.
- Text-date coercion policy.
