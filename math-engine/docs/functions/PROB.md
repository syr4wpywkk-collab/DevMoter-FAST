# PROB

`PROB(x_range, prob_range, lower_limit, [upper_limit])` — probability
that values in `x_range` fall between bounds. Legacy function.

## Arguments
- `x_range`: required; numeric values.
- `prob_range`: required; probabilities, same count as `x_range`.
- `lower_limit`: required; lower bound on x.
- `upper_limit`: optional; if omitted, returns `P(x = lower_limit)`.

## Semantics
- Sums `prob_range[i]` for each `i` where `lower_limit <= x_range[i]
  <= upper_limit` (with upper omitted: `x_range[i] = lower_limit`).
- Non-numeric cells in `x_range`/`prob_range` -> `#VALUE!`? (Excel
  docs: any non-numeric cell in `prob_range` -> `#NUM!`? — verify;
  generally PROB is stricter than aggregates: non-numeric in
  `prob_range` is `#NUM!` per docs, blank/`x_range` text unclear).

## Errors
- Any `prob_range[i] < 0` or `> 1` -> `#NUM!`.
- `SUM(prob_range) != 1` -> `#NUM!` (within FP tolerance — what
  tolerance? Open question).
- `x_range`/`prob_range` different sizes -> `#N/A`.
- Non-numeric `lower_limit`/`upper_limit` -> `#VALUE!` (confirm).

## Examples
- `PROB({0;1;2;3}, {0.2;0.3;0.1;0.4}, 2)` -> `0.1` (P(x=2)).
- `PROB({0;1;2;3}, {0.2;0.3;0.1;0.4}, 1, 3)` -> `0.8`.
- `PROB({1;2;3}, {0.5;0.5;0.5}, 1, 2)` -> `#NUM!` (probs sum 1.5).

## Open questions
- Sum-equals-1 floating tolerance.
- Whether blanks/text in `x_range` error or are skipped.
- Duplicated x values each contribute their own probability
  (expected: yes).
