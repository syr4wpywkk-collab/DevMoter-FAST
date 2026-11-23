# ISOWEEKNUM

`ISOWEEKNUM(date)` — ISO 8601 week number (1-53) of a date serial.

## Arguments
- `date`: required date serial (or text date per Excel coercion).

## Semantics
- ISO 8601: weeks start Monday; week 1 is the week containing the
  year's first Thursday. Equivalent: `WEEKNUM(date, 21)`.
- Algorithm: find Thursday of the current week (`d - weekday(d)+4`),
  then week = `floor((thursday - jan1_of_its_year)/7) + 1`.
- Excel 2013+; no legacy variant (WEEKNUM return_type 21 added
  simultaneously).

## Coercion
- Numbers as serials (fractional part ignored/truncated — confirm);
  text parsed per `DATEVALUE` rules; unparseable -> `#VALUE!`.

## Errors
- Serial outside valid date domain -> `#NUM!` (Excel: invalid date ->
  `#NUM!`).
- Unparseable text -> `#VALUE!`.

## Examples
- `ISOWEEKNUM(45291)` (2023-12-31, Sunday) -> `52`.
- `ISOWEEKNUM(45292)` (2024-01-01, Monday) -> `1`.
- `ISOWEEKNUM(44197)` (2021-01-01, Friday) -> `53` (2020 ISO year has
  53 weeks — 2021-01-01 is ISO week 53 of 2020).
- `ISOWEEKNUM(45658)` (2025-01-01, Wednesday) -> `1`.
- `ISOWEEKNUM(-1)` -> `#NUM!`.

## Open questions
- Fractional serial handling.
- Serial 60 (1900-02-29 fictitious) behavior — 1900-02-29 didn't
  exist; what does Excel return? Flag.
