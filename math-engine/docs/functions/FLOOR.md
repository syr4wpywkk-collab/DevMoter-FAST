# FLOOR (legacy)

`FLOOR(number, significance)` — rounds `number` down, toward zero,
to the nearest multiple of `significance`.

## Arguments
- `number`: numeric scalar, required.
- `significance`: numeric scalar, required (no default — unlike
  `FLOOR.MATH`/`FLOOR.PRECISE`).

## Semantics
- Rounds **toward zero** in classic Excel semantics:
  `FLOOR(3.7,2)` -> `2`; `FLOOR(-3.7,-2)` -> `-2`? — wait: classic
  `FLOOR` with matching negative sign rounds toward zero in
  magnitude: `FLOOR(-2.5,-2)` -> `-2`. (**SPEC-OPEN**: modern Excel
  365 returns `-4` toward -inf? MS docs for FLOOR state "rounds
  number down, toward zero". Fixture needed.)
- Sign rules mirror `CEILING`: `significance` must match the sign of
  `number`; mismatched signs -> `#NUM!` in classic versions; modern
  Excel accepts mixed signs and rounds toward -inf
  (`FLOOR(-2.5,1)` -> `-3`)? (**SPEC-OPEN** — same versioning issue
  as `CEILING`).

## Coercion
- Same scalar rules as `FLOOR.MATH`. Errors propagate.

## Errors
- Mismatched signs (classic) -> `#NUM!`.
- `significance = 0` -> `#DIV/0!`? or `0` — **SPEC-OPEN** (FLOOR.MATH
  returns 0; legacy FLOOR documented `#NUM!`? confirm).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=FLOOR(3.7,2)` | 2 |
| `=FLOOR(-2.5,-2)` | -2 (classic; verify) |
| `=FLOOR(1.5,0.1)` | 1.5 |
| `=FLOOR(0.234,0.01)` | 0.23 |

## Compatibility
- All Excel versions; `FLOOR.MATH` (2013) and `FLOOR.PRECISE`
  (2010) are the recommended replacements.

## Open questions
- Version-dependent sign/direction semantics (classic toward-zero vs
  modern toward -inf).
- `significance = 0` result.
