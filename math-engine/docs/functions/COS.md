# COS

`COS(number)` — cosine of `number` (radians).

## Arguments
- `number`: angle in radians, numeric scalar, direct coercion.

## Semantics
- `COS(0)` -> `1`; `COS(PI())` -> `-1`; `COS(PI()/3)` -> `0.5`.
- Degrees: `COS(RADIANS(60))` -> `0.5`.

## Coercion
- Numeric text, booleans, blank -> 0 coerce. Non-numeric ->
  `#VALUE!`. Errors propagate.

## Errors
- `#VALUE!` on failed coercion only.

## Examples
| Formula | Result |
|---|---|
| `=COS(1.047)` | ~0.50017 |
| `=COS(60*PI()/180)` | 0.5 |
| `=COS(0)` | 1 |

## Compatibility
- All Excel versions. Very large arguments: Excel's argument
  reduction vs IEEE `cos` may differ beyond ~1e308 — **SPEC-OPEN**
  fixture for extreme magnitudes.

## Open questions
- Large-argument reduction accuracy (both directions lose meaning;
  document tolerance vs reference).
