# ISO.CEILING

`ISO.CEILING(number, [significance])` — rounds `number` up to the
nearest integer or multiple of `significance`, always away from zero
regardless of signs.

## Arguments
- `number`: numeric scalar, required.
- `significance`: optional, default `1`. Sign ignored (absolute
  value used).

## Semantics
- Identical to `CEILING.PRECISE`: `ISO.CEILING(4.3)` -> `5`,
  `ISO.CEILING(-4.3)` -> `-5`, `ISO.CEILING(4.3, 0.5)` -> `4.5`.
- The name refers to ISO-aligned rounding semantics; functionally an
  alias (confirm equivalence including `significance=0` —
  **SPEC-OPEN**).

## Coercion
- Same scalar rules as `CEILING.MATH`. Errors propagate.

## Errors
- `significance = 0` -> `0`? (**SPEC-OPEN**, shared).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=ISO.CEILING(4.3)` | 5 |
| `=ISO.CEILING(-4.3,1)` | -5 |
| `=ISO.CEILING(4.3,0.5)` | 4.5 |

## Compatibility
- **Excel 2010+** (`_xlfn.ISO.CEILING`). Alias of
  `CEILING.PRECISE`; implement as one function with two names.

## Open questions
- Whether any behavioral difference vs `CEILING.PRECISE` exists at
  all (none documented).
