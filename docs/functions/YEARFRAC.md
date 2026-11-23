# YEARFRAC

`YEARFRAC(start_date, end_date, [basis])` — fraction of a year
between two dates under a day-count convention.

## Arguments
- `start_date`, `end_date`: required date serials. `start > end` is
  allowed — Excel swaps them? Documented: "if start > end they are
  exchanged" — confirm (returns same positive value).
- `basis`: optional, default `0`; day-count code:
  - `0` US (NASD) 30/360
  - `1` actual/actual
  - `2` actual/360
  - `3` actual/365
  - `4` European 30/360

## Semantics
- `basis 0`: `DAYS360(start,end)/360` using US NASD adjustments
  (shared implementation with `DAYS360` method FALSE).
- `basis 4`: European 30/360 `/360` (shared with `DAYS360` TRUE).
- `basis 2`: `(end - start)/360` actual days.
- `basis 3`: `(end - start)/365`.
- `basis 1`: act/act — `(end-start)/B` where `B` is the length of the
  year(s) spanned; Excel's act/act convention for YEARFRAC uses the
  actual number of days in the year **of the interval**; when the
  interval spans a leap boundary, `B` is defined as: if the dates are
  in the same year, that year's length; if different years —
  Microsoft documents YEARFRAC basis 1 as "actual days between the
  dates / actual days in the year" and the exact multi-year rule
  (average vs split-year) is a known ambiguity — **SPEC-OPEN**
  (transcribe rule after reference testing; ISDA act/act splits at
  year boundary, but Excel does NOT do a split sum — it uses a
  single denominator; which year?).

## Coercion
- Serials or text dates; fractional serials truncated; non-coercible
  -> `#VALUE!`.

## Errors
- `basis` outside `0..4` -> `#NUM!`.
- Out-of-domain dates -> `#NUM!`? invalid text -> `#VALUE!`.
- Same date -> `0`.

## Examples
- `YEARFRAC(45000, 45360, 0)` -> `1` (30/360 full year).
- `YEARFRAC(45000, 45360, 3)` -> `0.98630...` (360/365).
- `YEARFRAC(45000, 45360, 2)` -> `1`.
- `YEARFRAC(45123, 45234, 1)` -> actual/act fixture pending leap rule.
- `YEARFRAC(45000, 45000)` -> `0`.
- `YEARFRAC(45000, 44900, 0)` -> `-0.27777...` or swapped? — confirm
  sign behavior (docs: args exchanged, so `+0.27777...`? Actually if
  "exchanged" then positive; but Excel may return negative — verify).

## Engine requirements
- Day-count conventions (shared utility; see `PRICE.md`). YEARFRAC is
  the canonical consumer; implement the shared day-count module to
  serve both.

## Open questions
- Sign of result when `start > end`.
- Exact act/act denominator rule spanning multiple years.
- Whether `basis` truncation (e.g. `1.9` -> 1) applies.
