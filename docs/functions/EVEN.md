# EVEN

`EVEN(number)` — rounds `number` **away from zero** to the nearest
even integer.

## Arguments
- `number`: numeric scalar, required.

## Semantics
- `EVEN(1.5)` -> `2`; `EVEN(-1)` -> `-2`; `EVEN(0.23)` -> `2`;
  `EVEN(-2.5)` -> `-4`; `EVEN(2)` -> `2`; `EVEN(0)` -> `0`.
- Direction is away from zero for both signs (not "toward even" banker's
  rounding — it always moves to a strictly larger-magnitude even
  integer unless already even).

## Coercion
- Same scalar rules as `COS`. Errors propagate.

## Errors
- `#VALUE!` on failed coercion only.

## Examples
| Formula | Result |
|---|---|
| `=EVEN(1.5)` | 2 |
| `=EVEN(3)` | 4 |
| `=EVEN(-1)` | -2 |
| `=EVEN(0.23)` | 2 |

## Compatibility
- All Excel versions. Sibling: `ODD`; see `MROUND` for
  multiple-based rounding.

## Open questions
- None (behavior documented and unambiguous).
