# IRR

`IRR(values, [guess])` — returns the internal rate of return for a series
of periodic cash flows.

## Arguments
- `values`: array or range of cash flows, in period order. Must contain
  at least one negative and one positive value, else `#NUM!`.
- `guess`: starting estimate. Optional; default `0.1`.

## Semantics
Rate `r` solving `Σᵢ valuesᵢ/(1+r)^i = 0` (NPV = 0, period 0 indexed).
Excel iterates (Newton-style, ~20 iterations) from `guess` to `1e-7`
accuracy and returns `#NUM!` on non-convergence.

## Coercion and errors
- `values` range: text, logical, and blank cells are **ignored**
  (aggregation-style coercion for range arguments).
- All-same-sign flows -> `#NUM!`.
- Non-convergence -> `#NUM!`.
- Empty range / fewer than 2 flows -> `#NUM!` (confirm).
- Error cells propagate.

## Examples
| Formula | Result |
|---|---|
| `IRR({-70000,12000,15000,18000,21000,26000})` | `0.086630948` |
| `IRR({-70000,12000,15000,18000,21000,26000},0.1)` | `0.086630948` |
| `IRR({-70000,12000,15000})` | `#NUM!` (NPV stays negative near any reachable root) |
| `IRR({70000,12000,15000})` | `#NUM!` (no sign change) |

## Compatibility
`MIRR` adds explicit finance/reinvestment rates; `XIRR` handles
irregular dates (spec'd elsewhere).

## Open questions
- Exact iteration algorithm, tolerance, and iteration cap (Excel
  ~20 iterations, 0.00001% accuracy) — needed to reproduce `#NUM!` vs
  converged results exactly.
- Multiple-root polynomials: which root wins for a given `guess` is
  implementation-defined — needs reference fixtures.
- Range coercion of text numbers inside `values` (expected ignored).
