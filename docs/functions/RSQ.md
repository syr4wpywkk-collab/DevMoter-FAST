# RSQ

`RSQ(known_ys, known_xs)` — square of the Pearson correlation
coefficient (`r^2`) between two datasets.

## Arguments
- `known_ys`, `known_xs`: required ranges/arrays of equal count
  (checked before pair-exclusion — see `CORREL` open question).

## Coercion & pairing
- Identical to `CORREL`/`PEARSON`: positional pairing; pairs with a
  non-numeric cell are excluded; error cells propagate.

## Semantics
- `RSQ = r^2` where `r = PEARSON(ys, xs)`; always in `[0, 1]`.
- Computed via the same stable accumulation as `CORREL`.

## Errors
- Zero variance in either input, or `< 2` pairs -> `#DIV/0!`.
- Shape/count mismatch -> `#N/A`.
- Empty inputs -> `#DIV/0!`? (confirm — `CORREL` n=0 -> `#DIV/0!`).

## Examples
- `RSQ({2;3;9;1;8;7;5}, {6;5;11;7;5;4;4})` -> `0.05795` (Excel doc
  example value `0.05795`).
- `RSQ({1;2;3}, {2;4;6})` -> `1`.
- `RSQ({1;2;3;4}, {4;3;2;1})` -> `1` (perfect negative -> r^2 = 1).

## Open questions
- None beyond shared `CORREL` questions (mismatch stage, n=0 error).
