# NETWORKDAYS

`NETWORKDAYS(start_date, end_date, [holidays])` — count of whole
working days (Mon-Fri) between two dates inclusive, excluding listed
holidays.

## Arguments
- `start_date`, `end_date`: required date serials.
- `holidays`: optional; range/array of date serials to exclude.
  Non-contiguous/multi-area ranges? Excel accepts a range or array;
  duplicate holiday entries are counted once (dedupe — confirm) or
  subtracted multiple times? Excel behavior: holidays that fall on
  weekends are ignored (not double-subtracted); duplicates — confirm.

## Semantics
- Count days `d` in `[start, end]` where `weekday(d) in {Mon..Fri}`
  and `d` not in `holidays`.
- If `start > end`, result is the **negative** of the forward count
  (Excel documented behavior).
- Inclusive of both endpoints when they are workdays.
- Saturday/Sunday only; no region calendars (use `.INTL` for that).

## Coercion
- Serials; text dates coerced; fractional serials truncated.
- Holiday elements: non-date elements inside the range ignored vs
  error — confirm.

## Errors
- Unparseable/out-of-domain dates -> `#VALUE!`? Excel: invalid dates
  -> `#NUM!`? confirm (docs say `#NUM!` for invalid date — verify).

## Examples
- `NETWORKDAYS(45288, 45294)` (2023-12-27 Wed -> 2024-01-02 Tue) ->
  `5` (27,28,29 + 2? count: Dec 27,28,29, Jan 1,2 — Jan 1 not a
  weekend so counts unless holiday: without holidays = 5).
- `NETWORKDAYS(45288, 45294, {45292})` (holiday Dec 31? wrong — use
  {45293} = Jan 1) -> `4`.
- `NETWORKDAYS(45294, 45288)` -> `-5`.
- `NETWORKDAYS(45000, 45006)` -> `5` (Mon-Sun span -> 5 workdays;
  verify weekday of 45000 — pick a real Monday serial).

## Edge cases
- Holiday falling on a weekend: no effect.
- `holidays` containing text/booleans: skip vs error (confirm).

## Open questions
- Duplicate holiday subtraction.
- Error class for invalid dates (`#VALUE!` vs `#NUM!`).
- Non-date elements inside the holidays range.
