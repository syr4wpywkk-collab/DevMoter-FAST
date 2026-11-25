# CORREL

`CORREL(array1, array2)` — Pearson correlation coefficient between two equally-sized data sets.

## Arguments
- `array1`, `array2`: required ranges/arrays. They must contain the
  same number of **numeric data points** (after ignoring non-numeric
  cells, see below).

## Pairing & coercion
- Cells are paired positionally in row-major order.
- If a cell in either array is text, boolean, or blank, **that pair is
  excluded** (Excel behavior): a non-numeric cell in `array1` skips the
  corresponding position in `array2` as well.
- Direct (scalar) arguments are not typical; if permitted, coerce per
  the usual direct-arg rules (Open question whether scalar args are
  even allowed).
- Error cells propagate.

## Computation
- Pearson `r = cov(x,y) / (s_x * s_y)` over the `n` surviving pairs
  using the same numerically-stable accumulation as `VAR.S`/`STDEV.S`.
- Result is in `[-1, 1]`; clamp tiny FP excursions outside the range?
  Excel does not document clamping — **SPEC-OPEN** whether to clamp to
  `[-1,1]` or return raw FP value.

## Errors
- `n = 0` pairs -> `#DIV/0!`.
- Zero variance in either array (all identical values) -> `#DIV/0!`.
- Array size mismatch *before* pair exclusion -> `#N/A` (Excel
  behavior: the arrays must have the same shape/count of cells —
  confirm whether mismatch is on cell count or post-filter count).
- Errors inside arrays propagate.

## Edge cases
- Perfect correlation -> exactly `1` or `-1` (within FP).
- `n = 1` pair -> zero variance -> `#DIV/0!`.
- All pairs excluded by non-numeric cells -> `#DIV/0!`.

## Open questions
- Whether shape mismatch is checked on cell count or point count.
- Clamping `|r| > 1` FP excursions.
- Scalar (non-range) argument support.
