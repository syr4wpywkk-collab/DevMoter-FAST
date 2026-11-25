# GROWTH

`GROWTH(known_ys, [known_xs], [new_xs], [const])` — predicts exponential
growth by fitting `y = b * m^x` via least squares on `LN(y)`;
returns the predicted y for `new_xs`.

## Arguments
- `known_ys`: required; numeric y values, all `> 0` (log fit) —
  any `y <= 0` -> `#NUM!`.
- `known_xs`: optional; defaults to `1,2,...,n` matching y length.
  Length mismatch -> `#REF!` (documented for GROWTH: returns `#REF!`
  when array sizes differ — confirm kind).
- `new_xs`: optional; defaults to `known_xs`. May be a vector ->
  returns an **array** (spill/CSE), one prediction per element.
- `const`: optional logical; `TRUE`/omitted -> fit `b` normally;
  `FALSE` -> force `b = 1` (`y = m^x`).

## Array behavior
- Single `new_xs` -> scalar; vector -> spilled/array column-or-row
  matching `new_xs` orientation (same rules as `TREND`).

## Coercion
- Non-numeric y -> `#VALUE!`? Pairs-skip rules like `TREND`/`SLOPE` —
  **confirm**.

## Errors
- `known_ys` containing `<= 0` -> `#NUM!`.
- `known_xs`/`known_ys` size mismatch -> `#REF!` (documented).
- Non-numeric args -> `#VALUE!`.

## Examples
- `GROWTH({33100,47300,69000,102000,150000,220000},{11,12,13,14,15,16},17)`
  -> ≈`320196.7` (textbook example; verify exact)
- `GROWTH({2,4,8},{1,2,3},{4})` -> `16` (exact powers of 2)
- `GROWTH({1,2,4,8})` -> `{1;2;4;8}` (identity echo)
- `GROWTH({0,1},{1,2})` -> `#NUM!`
- `GROWTH({1,2},{1,2,3})` -> `#REF!` — confirm

## Compatibility
- All Excel versions (array formula historically; spills under
  dynamic arrays).

## Engine requirements
- Linear regression on `ln(y)`; array/spill output for vector
  `new_xs`.

## Open questions
- Error kind for mismatched xs/ys (`#REF!` per docs).
- Pair-skip and non-numeric handling.
- `const=FALSE` numerical path.
