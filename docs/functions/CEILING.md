# CEILING (legacy)

`CEILING(number, significance)` — rounds `number` up, away from zero,
to the nearest multiple of `significance`.

## Arguments
- `number`: numeric scalar, direct coercion. Required.
- `significance`: numeric scalar, required (no default — unlike
  `CEILING.MATH`/`CEILING.PRECISE`).

## Semantics
- Rounds **away from zero** in classic Excel semantics:
  `CEILING(2.5, 1)` -> `3`; `CEILING(-2.5, -1)` -> `-3`.
- `significance` must have the same sign as `number`; otherwise
  `#NUM!` (documented for Excel 2007/2010 era: "if number is positive
  and significance is negative -> #NUM!"; negative number with
  positive significance also errors — see Open questions).
- In Excel 2016+/365 the legacy `CEILING` was re-implemented on top of
  `CEILING.MATH`-style logic and negative numbers with positive
  significance round **toward zero** (`CEILING(-4.3, 2)` -> `-4`)?
  (**SPEC-OPEN**: modern Excel docs show `CEILING` accepting
  mixed signs; version-dependent behavior must be pinned by fixture).

## Coercion
- Same scalar rules as `CEILING.MATH`: numeric text ok, booleans ->
  1/0, blank -> 0. Errors propagate.

## Errors
- Mismatched signs (per above, version-dependent) -> `#NUM!`.
- `significance = 0` -> returns `0`? (**SPEC-OPEN** — mirror
  `CEILING.MATH` note; Excel returns 0).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=CEILING(2.5,1)` | 3 |
| `=CEILING(-2.5,-2)` | -4 |
| `=CEILING(1.5,0.1)` | 1.5 |
| `=CEILING(0.234,0.01)` | 0.24 |

## Compatibility
- Available since earliest Excel (was `CEILING` in all versions;
  `CEILING.MATH` added in 2013 as the recommended replacement).
- Prefer speccing this after `CEILING.MATH.md` (v2, 044) and reusing
  the shared rounding helper.

## Open questions
- Exact sign-mismatch behavior per Excel version (fixture against
  365 vs 2010 reference).
- `significance = 0` result.
- Negative `number` with positive `significance` in modern Excel:
  toward-zero vs `#NUM!`.
