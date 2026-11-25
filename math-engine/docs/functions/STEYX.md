# STEYX

`STEYX(known_ys, known_xs)` — standard error of the predicted y for
each x in a linear regression (residual standard error).

## Arguments
- `known_ys`, `known_xs`: required; equal counts (same pairing rule as
  `CORREL`: mismatched shapes -> `#N/A`).

## Coercion
- Same pair-exclusion as `CORREL`/`PEARSON`: a non-numeric cell in
  either array drops the pair; error cells propagate.

## Semantics
- `STEYX = sqrt( SS_resid / (n - 2) )` where `SS_resid =
  SUM((y_i - (a + b*x_i))^2)`; equivalently
  `sqrt( (Syy - Sxy^2/Sxx) / (n-2) )`.
- `n <= 2` -> `#DIV/0!` (`n=2` fits exactly -> denominator 0;
  Excel returns `#DIV/0!` — confirm whether `n=2` gives `0` or
  `#DIV/0!`; division by n-2 => `#DIV/0!`).
- Zero variance in x (`Sxx = 0`) -> `#DIV/0!`.

## Errors
- Count/shape mismatch -> `#N/A`; `n < 3` -> `#DIV/0!`.
- Non-numeric pairs excluded; errors propagate.

## Examples
- `STEYX({2;3;9;1;8;7;5}, {6;5;11;7;5;4;4})` -> `3.305719` (Excel doc
  example).
- `STEYX({1;2;3;4}, {1;2;3;4})` -> `0` (perfect fit).
- `STEYX({1;2;3}, {5;5;5})` -> `#DIV/0!` (x zero variance).

## Open questions
- `n = 2` exact-fit behavior.
