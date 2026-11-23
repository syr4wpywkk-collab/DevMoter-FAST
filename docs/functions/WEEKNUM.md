# WEEKNUM

`WEEKNUM(serial_number, [return_type])` — week number of the year.

## Arguments
- `serial_number`: required date serial.
- `return_type`: optional, default `1`; defines week-start and scheme:

| type | week starts | scheme |
|---|---|---|
| `1` | Sunday | week containing Jan 1 = week 1 (default) |
| `2` | Monday | Jan-1 week |
| `11` | Monday | Jan-1 week |
| `12` | Tuesday | Jan-1 week |
| `13` | Wednesday | Jan-1 week |
| `14` | Thursday | Jan-1 week |
| `15` | Friday | Jan-1 week |
| `16` | Saturday | Jan-1 week |
| `17` | Sunday | Jan-1 week |
| `21` | Monday | **ISO 8601** (= `ISOWEEKNUM`) |

  (Types 11-17 and 21 added Excel 2010/2013.)

## Semantics
- Non-ISO: week 1 contains January 1; each subsequent week starts on
  the `return_type` weekday. `WEEKNUM = floor((serial - jan1 +
  offset)/7) + 1` with `offset` aligning Jan-1's partial week.
- Type 21: identical to `ISOWEEKNUM` (week 1 contains first
  Thursday).

## Errors
- Serial out of date domain -> `#NUM!`.
- `return_type` not in table -> `#NUM!`.
- Unparseable text -> `#VALUE!`.

## Examples
- `WEEKNUM(45292, 1)` (2024-01-01 Monday, Jan-1 week, Sunday start)
  -> `1`.
- `WEEKNUM(45298, 1)` (2024-01-07 Sunday) -> `2`.
- `WEEKNUM(45292, 21)` -> `1`.
- `WEEKNUM(44197, 21)` (2021-01-01) -> `53`.
- `WEEKNUM(45291, 2)` (2023-12-31, Monday start) -> `53`.
- `WEEKNUM(45292, 3)` -> `#NUM!` (no such type).

## Open questions
- Whether types 1 and 2 differ only in week start (yes per table) —
  type 2 vs 11 are duplicates; confirm Excel accepts both.
- Serial-60 handling.
