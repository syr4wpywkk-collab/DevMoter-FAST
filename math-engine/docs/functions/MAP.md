# MAP

`MAP(array1, [array2], ..., LAMBDA)` — applies a LAMBDA elementwise and
returns an array of the same shape.

## Arguments
- One or more arrays followed by a final LAMBDA taking exactly one
  parameter per array.
- All arrays must have identical shape; else `#VALUE!` (Excel: arrays
  are broadcast? — no, Excel requires equal sizes -> `#N/A`; see open
  question).

## Behavior
- `MAP({1,2;3,4},LAMBDA(x,x*2))` -> `[[2,4],[6,8]]`.
- `MAP({1,2},{10,20},LAMBDA(a,b,a+b))` -> `[[11,22]]`.
- Elements passed in row-major order; result preserves input shape.

## Evaluation budget
- Each element invocation consumes step budget; total invocations =
  element count, bounded by the array-size cap and the per-recalc step
  budget (plan §9). Exhaustion -> budget error, not partial array.

## Errors
- `#VALUE!` on shape mismatch or LAMBDA arity mismatch.
- An error produced inside an element call becomes that element's value
  (element-wise) — verify vs Excel, alternative is whole-call failure.

## Spill semantics
- Result spills atomically; `#SPILL!` on collision.

## Open questions
- Shape-mismatch error kind: `#VALUE!` vs Excel's `#N/A` padding
  behavior for MAP (Excel actually requires same dimensions and returns
  `#VALUE!`; confirm).
- Whether in-element errors are element-wise or fail the whole call.
