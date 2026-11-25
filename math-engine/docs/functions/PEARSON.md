# PEARSON

`PEARSON(array1, array2)` — Pearson product-moment correlation
coefficient. Legacy name; **identical result to `CORREL`** (see
`CORREL.md` for pairing, coercion, and error rules — this spec adopts
them wholesale).

## Arguments
- `array1`, `array2`: required; equal cell counts before pair exclusion
  else `#N/A` (per `CORREL`).

## Semantics
- Same positional pairing & pair-exclusion of non-numeric cells as
  `CORREL`.
- Returns `r` in `[-1, 1]`; zero variance -> `#DIV/0!`; zero pairs ->
  `#N/A` or `#DIV/0!`? (per CORREL: `#DIV/0!` for n=0 — reconcile in
  fixtures).

## Examples
- `PEARSON({3;4;5;6;7}, {10;20;30;40;50})` -> `1`.
- `PEARSON(A1:A5, B1:B5)` on doc data `{9;7;5;3;1}` vs
  `{10;6;1;5;3}` -> `0.699379` (Excel doc value `0.699379`).
- `PEARSON({1;2;3}, {1;2;3})` -> `1`.

## Open questions
- Whether PEARSON and CORREL differ anywhere in Excel (documented as
  identical; verify in fixtures).
- Shape-mismatch check stage (cell count vs numeric point count).
