# TIME

`TIME(hour, minute, second)` — builds a time serial in [0, 1).

v2 plan §2 (068): h/m/s normalization, fractional part of a date
serial.

## Arguments
- Three numeric scalars, direct coercion; fractional inputs are
  truncated (confirm — Excel truncates each component).

## Behavior
- `TIME(12, 30, 0)` -> 0.5208333... (12:30 as a day fraction).
- Components roll over: `TIME(25, 0, 0)` -> 1:00 next-day fraction =
  `1/24`; Excel wraps modulo 24h -> result in [0,1).
- Negative components: `TIME(15, -30, 0)` -> 14:30 fraction. Values
  that normalize to a negative time -> `#NUM!` (confirm).
- `hour` >= 24 wraps (mod 24 after normalization).

## Errors
- Result normalizing below 0:00 or above/eq 24:00+ after rollover —
  Excel wraps modulo 1 day for >24h but errors for negative totals
  (`#NUM!`). Confirm both bounds.
- Coercion failures -> `#VALUE!`.

## Edge cases
- `TIME(0, 0, 0)` -> 0 (displays 0:00).
- Seconds roll into minutes, minutes into hours.
- Combined with `DATE`: `DATE(2026,1,1) + TIME(12,0,0)` is the idiom
  for a datetime serial.

## Open questions
- Exact out-of-range policy: wrap vs `#NUM!` for totals < 0 or >= 24h.
- Component truncation of fractional inputs.
