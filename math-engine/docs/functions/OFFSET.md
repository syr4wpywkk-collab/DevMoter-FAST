# OFFSET

`OFFSET(reference, rows, cols, [height], [width])` — returns a
reference displaced from `reference`, optionally resized. Volatile.

## Arguments
- `reference`: required; anchor cell or range — the origin is its
  **top-left** cell.
- `rows`: required; rows to shift (positive down, negative up, `0` ok).
- `cols`: required; columns to shift (positive right, negative left).
- `height`: optional; result height in rows. Defaults to the
  anchor's height. Must be >= 1; negative values extend *upward*
  (top-left stays the displaced origin — confirm edge semantics).
- `width`: optional; result width in columns, mirrors `height`.

## Semantics
- Returns a *reference*, which is then dereferenced to values: a
  single-cell result yields a scalar; a multi-cell result spills under
  dynamic arrays, or uses implicit intersection in legacy mode.
- `OFFSET(A1,1,1)` from anchor `A1` = cell `B2`.
- `OFFSET(A1:B2,1,1)` -> range `B2:C3` (anchor size preserved).
- Negative `rows`/`cols` that move the origin above row 1 or left of
  column A -> `#REF!`. Similarly beyond `XFD`/`1048576`.
- Volatile: recalculated every pass; used inside aggregate functions
  (`SUM(OFFSET(...))`) for dynamic ranges.

## Coercion
- `rows`/`cols`/`height`/`width`: numeric coercion; fractional values
  truncated toward zero (confirm — Excel truncates).
- `reference` must be a reference (a value argument -> `#VALUE!`).

## Errors
- Result partially or fully outside the grid -> `#REF!`.
- `height`/`width` = 0 (or truncating to 0) -> `#REF!`? (confirm —
  Excel returns `#REF!` for zero-size results; some builds `#VALUE!`).
- Non-reference `reference` -> `#VALUE!`.
- Errors inside the resulting range propagate on dereference.

## Examples
- `B2` = `10`: `OFFSET(A1,1,1)` -> `10`
- `SUM(OFFSET(A1,0,0,3,1))` with `A1:A3` = `1,2,3` -> `6`
- `OFFSET(B2,-1,-1)` = value of `A1`
- `OFFSET(A1,-1,0)` -> `#REF!`
- `OFFSET(A1,0,0,2,2)` with `A1:B2` = `{1,2;3,4}` -> `{1,2;3,4}`
  (spill)

## Engine requirements
- Dynamic references + volatility: like `INDIRECT`, the produced
  reference is only known at evaluation time; dependency tracking must
  treat it as volatile or re-register dependencies per pass.
- The function must return a reference object (anchor + shape), not a
  value — call sites must support reference-valued results feeding
  aggregators and dereference.

## Compatibility notes
- Available since early Excel; volatile in all versions.

## Open questions
- Truncation of fractional offsets.
- `height`/`width` = 0 error type.
- Negative `height`/`width` semantics (growth direction) — Excel docs
  allow negatives; exact anchor behavior should be verified.
