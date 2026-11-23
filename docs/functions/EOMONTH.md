# EOMONTH

`EOMONTH(start_date, months)` — serial of the last day of the month
`months` months before/after `start_date`.

v2 plan §2 (076): month-end computation, leap years, negative months.

## Arguments
- `start_date`: date serial (same coercion as `EDATE`).
- `months`: integer, truncated; negative moves backward.

## Behavior
- `EOMONTH(45000, 0)` -> last day of that serial's month.
- Move `months` months first, then take month-end — equivalent to
  `EDATE` then clamp-to-end, but even start dates mid-month snap to
  end: `EOMONTH(2026-01-15, 0)` -> 2026-01-31.
- Leap years: `EOMONTH(2024-02-10, 0)` -> 2024-02-29;
  `EOMONTH(2025-02-10, 0)` -> 2025-02-28.

## Errors
- Result outside serial domain -> `#NUM!`.
- Non-coercible inputs -> `#VALUE!`.

## Edge cases
- `EOMONTH(jan31, -1)` -> Dec 31 prior year.
- `EOMONTH(x, -13)` far-backward moves; result-year underflow ->
  `#NUM!`.
- 1900 leap-bug window serials — fixture pending policy.

## Open questions
- Text-date coercion (as `EDATE`).
- Interaction of serial 59/60 with month-boundary math under the
  bug-compat mapping.
