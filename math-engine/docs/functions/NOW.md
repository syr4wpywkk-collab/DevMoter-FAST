# NOW

`NOW()` — current date and time as a date serial (integer part = date,
fraction = time of day).

v2 plan §2 (067): injected clock, timezone, volatile.

## Arguments
- None.

## Behavior
- **Volatile**: recalculates every pass (like `RAND`); registered with
  the scheduler as volatile.
- Clock is injected via the evaluation context (test seam), never read
  from the OS inside the function — enables deterministic fixtures.
- Returns the serial under the workbook date system (default 1900
  system; see `TODAY`/`DATE` spec baseline and `docs/SPEC-OPEN.md`).
- Timezone: Excel uses local system time. Engine should define one
  canonical zone policy (UTC vs host-local vs workbook setting) —
  **open**.

## Errors
- Arity errors only.

## Edge cases
- `NOW()` vs `TODAY()` must share the same clock instant within one
  recalculation pass (avoid crossing-midnight inconsistency).
- Sub-second precision: Excel carries milliseconds in the fraction —
  match or truncate (confirm).

## Open questions
- Timezone policy and whether a workbook-level TZ setting exists.
- Sub-second precision and display rounding.
