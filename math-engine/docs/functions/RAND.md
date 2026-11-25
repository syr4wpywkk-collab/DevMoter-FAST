# RAND

`RAND()` — returns a uniformly distributed random number in [0, 1).

v2 plan §2 (046): per-workbook RNG and volatile recalculation; fixed
seed in tests.

## Arguments
- None. `RAND(x)` is an arity error.

## Behavior
- **Volatile**: recalculates on every recalculation pass, like `NOW()`
  and `TODAY()`. Must be registered as volatile so the dependency
  scheduler does not cache it.
- RNG lives in the workbook/evaluation context, not in the function —
  enables deterministic seeding per workbook and per test fixture.
- Range: `0 <= r < 1`. `1.0` must never be produced.

## Errors
- Arity errors only. Never produces a value error during normal use.

## Edge cases / determinism
- Test mode: evaluation context carries an optional seed (e.g. via
  `EvaluationOptions`); with a fixed seed the sequence is reproducible
  across runs.
- Multiple `RAND()` calls in one formula draw successive values from
  the same stream in left-to-right argument order.
- `RAND` in an array/spill context draws once per element (pending
  spill support — **open**).

## Open questions
- RNG algorithm choice (e.g. xoshiro/pcg implemented in-core — no
  external deps allowed in calc-core).
- Seed plumbing: workbook property vs eval-option vs `RANDOMIZE`-style
  API.
- Recalc policy on open/load: Excel recalculates once on open.
