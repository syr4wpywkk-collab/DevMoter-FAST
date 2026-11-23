# CEILING.PRECISE

`CEILING.PRECISE(number, [significance])` — rounds `number` up to the
nearest multiple of `significance`, **always away from zero**
regardless of signs.

## Arguments
- `number`: numeric scalar, required.
- `significance`: optional, default `1`. Its sign is ignored
  (absolute value is used).

## Semantics
- `CEILING.PRECISE(4.3)` -> `5`; `CEILING.PRECISE(-4.3)` -> `-5`;
  `CEILING.PRECISE(4.3, 0.5)` -> `4.5`.
- Differs from `CEILING.MATH`: no `mode` argument — negatives always
  round away from zero.
- `CEILING.PRECISE(x) == ISO.CEILING(x)` — the two are aliases
  (confirm: both document "rounds up to nearest integer or
  significance, regardless of sign").

## Coercion
- Same scalar rules as `CEILING.MATH`. Errors propagate.

## Errors
- `significance = 0` -> `0`? (**SPEC-OPEN** — shared open question
  with `CEILING.MATH`).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=CEILING.PRECISE(4.3)` | 5 |
| `=CEILING.PRECISE(-4.3)` | -5 |
| `=CEILING.PRECISE(-8.8,3)` | -9 |

## Compatibility
- **Excel 2010+** (`_xlfn.CEILING.PRECISE`). `ISO.CEILING` is the
  same function with an ISO-oriented name; `CEILING.MATH` (2013) is
  the generalization.

## Open questions
- `significance = 0` behavior.
- Confirm exact alias equivalence with `ISO.CEILING` including
  `significance=0` edge.
