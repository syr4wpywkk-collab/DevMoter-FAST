# TODAY

`TODAY()` — the current date as a serial number, no arguments.

## Arguments
- None. Any argument is an arity error.

## Date system
- Returns a **serial number** under the workbook's configured date
  system (plan §3.1: 1900 or 1904 base, per workbook).
- 1900 system: serial 1 = 1900-01-01; the fictitious serial 60 =
  1900-02-29 is preserved for compatibility (see `DATE.md` for the
  full note). `TODAY` never returns serial 60 in practice (real date
  is far past it).
- 1904 system: serial 0 = 1904-01-01; same calendar date yields a
  serial 1462 lower than in 1900 system.

## Clock injection
- The wall clock must be an injected dependency (plan §6 Phase 5);
  tests fix the clock. No direct `SystemTime::now()` inside the
  function implementation.
- Timezone: evaluated in the workbook/session timezone. **SPEC-OPEN**:
  fixed session timezone vs caller-supplied; document that recalc
  across a local midnight within one session is possible (confirm
  whether to pin "today" per recalculation pass or per call).

## Volatility
- `TODAY` is volatile: it must be re-evaluated on every full
  recalculation. Dependency-graph handling for volatile functions is
  specified in plan §5.

## Errors
- None beyond arity (no input coercion exists).

## Edge cases
- DST transitions: serial must reflect the calendar date, not elapsed
  time.
- Result has no time component (integer-valued serial).

## Open questions
- Timezone source (session vs workbook vs caller).
- Whether the value is pinned per recalculation pass.
