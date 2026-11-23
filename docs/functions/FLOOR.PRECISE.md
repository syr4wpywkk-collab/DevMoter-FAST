# FLOOR.PRECISE

`FLOOR.PRECISE(number, [significance])` — rounds `number` down to the
nearest multiple of `significance`, **always toward negative
infinity** regardless of signs.

## Arguments
- `number`: numeric scalar, required.
- `significance`: optional, default `1`. Sign ignored (absolute
  value used).

## Semantics
- `FLOOR.PRECISE(4.3)` -> `4`; `FLOOR.PRECISE(-4.3)` -> `-5`;
  `FLOOR.PRECISE(4.3, 0.5)` -> `4`.
- Equivalent to `FLOOR.MATH(number, significance, 0)` — `PRECISE`
  always uses the toward -inf direction, with no `mode` argument.

## Coercion
- Same scalar rules as `FLOOR.MATH`. Errors propagate.

## Errors
- `significance = 0` -> `0`? (**SPEC-OPEN** — shared question with
  `FLOOR.MATH`).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=FLOOR.PRECISE(-3.2,-1)` | -4 |
| `=FLOOR.PRECISE(3.2,-1)` | 3 |
| `=FLOOR.PRECISE(0.234,0.01)` | 0.23 |

## Compatibility
- **Excel 2010+** (`_xlfn.FLOOR.PRECISE`). See `CEILING.PRECISE` for
  the upward analog.

## Open questions
- `significance = 0` behavior.
