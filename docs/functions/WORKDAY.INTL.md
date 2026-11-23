# WORKDAY.INTL

`WORKDAY.INTL(start_date, days, [weekend], [holidays])` — `WORKDAY`
with configurable weekend. Excel 2010+.

## Arguments
- `start_date`, `days`, `holidays`: as `WORKDAY`.
- `weekend`: optional, default `1`; numeric codes `1..7` and
  `11..17`, or a 7-char `'0'/'1'` string (Mon..Sun; `'1'` = weekend)
  — identical encoding to `NETWORKDAYS.INTL` (see its table).

## Semantics
- Same stepping algorithm as `WORKDAY` but a day counts as workday iff
  its weekday's weekend flag is `'0'`/not in the weekend code and it
  is not in `holidays`.

## Errors
- Invalid `weekend` code/string -> `#VALUE!`.
- As `WORKDAY` otherwise.

## Examples
- `WORKDAY.INTL(45288, 5)` -> `45295` (same as WORKDAY).
- `WORKDAY.INTL(45288, 5, 7)` (Fri+Sat weekend) -> different result;
  compute: from Wed Dec 27 skipping Fri+Sat -> workdays: Dec 27? —
  stepping forward 5 workdays from Dec 27: Thu 28 (1), Sun 31 (2),
  Mon Jan 1 (3), Tue 2 (4), Wed 3 (5) -> `45295`? verify calendar —
  pin fixture.
- `WORKDAY.INTL(45288, 3, "0000110")` -> Fri+Sat weekend; verify.
- `WORKDAY.INTL(45288, 5, 99)` -> `#VALUE!`.

## Open questions
- All-weekend weekend string (`"1111111"`): infinite loop risk —
  Excel result? must define (likely `#NUM!` or hangs — flag engine
  requirement: bound the stepping loop).
- Same `days=0`/truncation questions as `WORKDAY`.
