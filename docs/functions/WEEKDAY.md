# WEEKDAY

`WEEKDAY(serial_number, [return_type])` — day-of-week number of a
date serial.

## Arguments
- `serial_number`: required date serial (or text date).
- `return_type`: optional, default `1`; determines the numbering:

| type | mapping (values 1..7) |
|---|---|
| `1` | 1=Sunday .. 7=Saturday (default, legacy) |
| `2` | 1=Monday .. 7=Sunday |
| `3` | 0=Monday .. 6=Sunday |
| `11` | 1=Monday .. 7=Sunday |
| `12` | 1=Tuesday .. 7=Monday |
| `13` | 1=Wednesday .. 7=Tuesday |
| `14` | 1=Thursday .. 7=Wednesday |
| `15` | 1=Friday .. 7=Thursday |
| `16` | 1=Saturday .. 7=Friday |
| `17` | 1=Sunday .. 7=Saturday |

  (Types 11-17 added in Excel 2010.)

## Semantics
- Compute `dow = floor(serial) mod 7`-style under the workbook date
  system: serial 1 (1900-01-01) is Monday in Excel's calendar (real
  1900-01-01 was a Monday; serial 60 bug shifts... the fictitious
  1900-02-29 makes serials >= 61 off-by-one vs real weekday but Excel
  internally consistent — verify against real dates well after 1900).
- Return the per-table mapping. Type 3 returns 0..6 (not 1..7).

## Coercion
- Text dates parsed; fractional serials truncated (time part
  ignored); out-of-domain -> `#NUM!`? For `serial_number < 1` Excel
  returns `#NUM!` (docs). Confirm for negatives vs large.

## Errors
- `serial` out of valid date range -> `#NUM!`.
- `return_type` not in the table -> `#NUM!`.
- Unparseable text -> `#VALUE!`.

## Examples
- `WEEKDAY(45292)` (2024-01-01, Monday) -> `2` (type 1: Sunday=1).
- `WEEKDAY(45292, 2)` -> `1`.
- `WEEKDAY(45292, 3)` -> `0`.
- `WEEKDAY(45298, 1)` (2024-01-07, Sunday) -> `1`.
- `WEEKDAY(45292, 99)` -> `#NUM!`.

## Open questions
- Serial-60 (fictitious 1900-02-29) weekday mapping.
- Fractional serial truncation.
