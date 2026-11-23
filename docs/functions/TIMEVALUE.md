# TIMEVALUE

`TIMEVALUE(time_text)` — converts a time stored as text into the
fractional part of a serial (value in [0,1)).

## Arguments
- `time_text`: required; text representing a time.

## Semantics
- Accepts `"HH:MM"`, `"HH:MM:SS"`, 12-hour `"H:MM AM/PM"`, and
  date+time strings (date part discarded — Excel returns only the
  time fraction).
- Result range `[0, 1)`; `TIMEVALUE("12:00")` -> `0.5`.
- Seconds precision: `"23:59:59"` -> `0.9999884...`.
- 24:00+ times wrap? `"25:00"` -> Excel parses as 1:00 next day ->
  fraction `0.04166`? confirm.

## Coercion / errors
- Non-text scalar -> `#VALUE!` (a number arg errors — confirm; a
  number might be reinterpreted as serial fraction? Excel docs: arg
  must be text — number -> `#VALUE!`).
- Unparseable -> `#VALUE!`.

## Examples
- `TIMEVALUE("12:00 PM")` -> `0.5`.
- `TIMEVALUE("14:30")` -> `0.6041666...`.
- `TIMEVALUE("2:24 AM")` -> `0.1` (Excel doc example).
- `TIMEVALUE("2026-01-01 18:00")` -> `0.75` (date dropped — confirm).
- `TIMEVALUE("noon-ish")` -> `#VALUE!`.

## Engine requirements
- Deterministic time-grammar parser (same engine requirement as
  `DATEVALUE`); enumerate accepted formats explicitly.

## Open questions
- Accepted format list (12h vs 24h, seconds optional, `AM/PM`
  case/space rules).
- >24h parsing (wrap vs error).
- Locale AM/PM markers fixed to en-US?
