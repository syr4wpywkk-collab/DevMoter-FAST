# NETWORKDAYS.INTL

`NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])` —
like `NETWORKDAYS` with a configurable weekend definition.
Excel 2010+.

## Arguments
- `start_date`, `end_date`: required date serials.
- `weekend`: optional, default `1` (Sat/Sun). Either a number code or
  a 7-character string:
  - `1` Sat+Sun (default), `2` Sun+Mon, `3` Mon+Tue, `4` Tue+Wed,
    `5` Wed+Thu, `6` Thu+Fri, `7` Fri+Sat, `11` Sun only,
    `12` Mon only, `13` Tue only, `14` Wed only, `15` Thu only,
    `16` Fri only, `17` Sat only.
  - String form: 7 chars `Monday..Sunday`, `'1'` = weekend day,
    `'0'` = workday. Must contain at least one `'0'`? (all-1 string
    -> `#VALUE!`? confirm) and only chars 0/1 else `#VALUE!`.
- `holidays`: optional; as `NETWORKDAYS`.

## Semantics
- Count inclusive days not matching the weekend spec and not in
  `holidays`; negative when `start > end` (same sign rule).
- String weekend allows arbitrary weekly patterns (e.g. `"0000011"`).

## Errors
- Invalid `weekend` code (not in the code set, wrong string
  length/chars) -> `#VALUE!`.
- Others as `NETWORKDAYS`.

## Examples
- `NETWORKDAYS.INTL(45288, 45294)` -> `5` (same as NETWORKDAYS).
- `NETWORKDAYS.INTL(45288, 45294, 7)` (Fri+Sat weekend) -> recompute:
  days Dec27(Wed? verify weekdays) — pin fixtures against reference
  with a calendar check.
- `NETWORKDAYS.INTL(45288, 45294, "0000110")` -> count with Fri+Sat
  weekend — verify.
- `NETWORKDAYS.INTL(45288, 45294, 1, {45293})` -> `4`.
- `NETWORKDAYS.INTL(45288, 45294, 99)` -> `#VALUE!`.
- `NETWORKDAYS.INTL(45288, 45294, "1111111")` -> `#VALUE!`? or 0 —
  confirm.

## Open questions
- All-weekend string result (error vs 0).
- Whether weekend string accepts chars other than '0'/'1' -> `#VALUE!`
  (expected).
- Duplicate/weekend-holiday semantics (same as NETWORKDAYS questions).
