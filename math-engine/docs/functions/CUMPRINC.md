# CUMPRINC

`CUMPRINC(rate, nper, pv, start_period, end_period, type)` — returns the
cumulative principal paid on a loan between `start_period` and
`end_period` (inclusive).

## Arguments
Identical to `CUMIPMT`: `rate`, `nper`, `pv`, `start_period`,
`end_period`, `type` (`0` end / `1` beginning; required).

## Semantics
`Σ PPMT(rate, per, nper, pv, 0, type)` for `per` in `start..end`, where
`PPMT = PMT - IPMT`. Negative when `pv > 0`.
Invariant: `CUMIPMT + CUMPRINC` over `1..nper` equals `nper * PMT`.

## Coercion and errors
Identical to `CUMIPMT`: `#NUM!` for `rate <= 0`, `nper <= 0`, `pv <= 0`,
`start < 1`, `end < 1`, `start > end`, `type ∉ {0,1}`; `#VALUE!` for
non-numeric text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `CUMPRINC(0.09/12,360,125000,13,24,0)` | `-934.1071234` |
| `CUMPRINC(0.09/12,360,125000,2,2,0)` | `-68.79035821` |
| `CUMPRINC(0.09/12,360,125000,1,360,0)` | `-125000` (full principal) |
| `CUMPRINC(0.09/12,360,125000,0,12,0)` | `#NUM!` |

## Compatibility
Former Analysis ToolPak function; built-in since Excel 2007.

## Open questions
- Same `end_period > nper` and `rate = 0` questions as `CUMIPMT`.
