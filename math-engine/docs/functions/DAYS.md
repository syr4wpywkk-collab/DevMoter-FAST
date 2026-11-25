# DAYS

`DAYS(end_date, start_date)` — number of days between two dates:
`end - start`. Note the argument order (end first), opposite of most
date functions.

## Arguments
- `end_date`, `start_date`: required date serials or date text.

## Semantics
- Simply `end_date - start_date` as serials. Negative results are
  allowed (no `#NUM!` for end < start).
- Text args are parsed per `DATEVALUE` rules (Excel behavior); both
  args coerce independently.
- Serials are used directly; times ignored? No — fractional serials
  produce fractional results? Excel truncates: `DAYS` uses date
  values only — confirm whether 45000.9 vs 45000 differ (Excel
  truncates to integer dates — verify).

## Coercion
- Numbers used as serials; text parsed; booleans? -> `#VALUE!` likely.
- Errors propagate.

## Errors
- Unparseable text -> `#VALUE!`.
- Serial outside valid date domain -> `#NUM!`.

## Examples
- `DAYS(45292, 44197)` -> `1095`.
- `DAYS(44197, 45292)` -> `-1095`.
- `DAYS("2023-12-31", "2021-01-01")` -> `1095` (text parsing).
- `DAYS(45000, 45000)` -> `0`.
- `DAYS("garbage", 45000)` -> `#VALUE!`.

## Open questions
- Fractional serial truncation vs fractional result.
- Boolean coercion.
- 1900 leap-bug serial 60 in subtraction (pure arithmetic so no
  issue, but display-side mapping matters).
