# WORKDAY

`WORKDAY(start_date, days, [holidays])` — serial of the date `days`
working days before/after `start_date` (Mon-Fri, excluding holidays).

## Arguments
- `start_date`: required date serial.
- `days`: required integer; positive = forward, negative = backward,
  `0` = start itself if a workday else next workday? — Excel:
  `days=0` returns start_date unchanged? Confirm (documented as
  offset; `WORKDAY(x,0)` returns `x` — verify).
- `holidays`: optional range/array of date serials.

## Semantics
- Step one calendar day at a time skipping Sat/Sun and `holidays`
  until `|days|` workdays elapsed.
- Start date itself is not counted even if a workday (`days=1` from
  Friday -> next Monday).
- `days` truncated toward zero? Excel truncates fractional — confirm.
- Result always a workday (not Sat/Sun/holiday) — unless `days=0`
  with weekend start? Confirm.

## Coercion
- Serials/text dates; holiday range elements non-date — skip vs
  error (same question as NETWORKDAYS).

## Errors
- Out-of-domain result/date -> `#NUM!`.
- Unparseable text -> `#VALUE!`.

## Examples
- `WORKDAY(39448, 151, {39568,39574,39615})` -> `39634`? Excel doc
  example: start 2008-10-01, 151 days, holidays 2008-11-26,12-04,
  2009-01-21 -> `2009-05-05` serial 39934? verify against reference.
- `WORKDAY(45288, 5)` (Wed 2023-12-27 + 5 workdays) -> `45295`
  (2024-01-03 Wed; skips Dec 30-31 weekend) — verify calendar.
- `WORKDAY(45294, -3)` (Tue Jan 2 - 3 workdays) -> `45288`
  (Dec 27 Wed) — verify.
- `WORKDAY(45288, 5, {45293})` -> `45296` (Jan 1 excluded shifts +1
  day) — verify.

## Open questions
- `days = 0` semantics.
- Fractional `days` truncation.
- Non-date holiday elements.
