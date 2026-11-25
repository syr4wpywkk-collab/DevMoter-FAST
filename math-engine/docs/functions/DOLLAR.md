# DOLLAR

`DOLLAR(number, [decimals])` — formats `number` as currency text using
the `$` symbol and thousands separators: `"$#,##0.00"`.

## Arguments
- `number`: required; coerced to number (numeric text -> number,
  boolean -> 1/0, blank -> 0, error propagates). Non-coercible ->
  `#VALUE!`.
- `decimals`: optional, default `2`; coerced to number, truncated
  toward zero. May be negative (rounds left of the decimal point) or
  larger than needed (pads zeros). Range limit in Excel is roughly
  `-127..127`-class — **SPEC-OPEN**; practical bound set by precision.

## Semantics
- Result is TEXT, not a number: `DOLLAR(1234.567)` -> `"$1,234.57"`.
- Grouping separator `,` every three digits; decimal point `.`;
  leading `$`.
- Negative values render as `($1,234.57)` — Excel uses parentheses
  accounting style (confirm; this is the documented US-locale
  behavior).
- Rounding is half-away-from-zero at the displayed precision (shared
  rule with `FIXED` and `TEXT` — verify on ties).

## Errors
- `#VALUE!` for non-coercible arguments.
- No `#NUM!` documented for extreme magnitudes — confirm.

## Examples
- `DOLLAR(1234.567)` -> `"$1,234.57"`
- `DOLLAR(-1234.567)` -> `"($1,234.57)"`
- `DOLLAR(99.5,0)` -> `"$100"`
- `DOLLAR(1234.567,-2)` -> `"$1,200"`
- `DOLLAR(0.009,2)` -> `"$0.01"` (verify tie-rounding)

## Compatibility
- All Excel versions. Output is always en-US-style (`$`, `,`, `.`)
  regardless of locale — confirm whether Excel localizes the currency
  symbol (documented as using the locale currency symbol in some
  locales — **SPEC-OPEN**; fix to `$` for the fixed-locale engine).

## Open questions
- Currency symbol under non-US locales (fix to `$`?).
- Negative-format style (parentheses vs `-$`) — verify reference.
- Allowed `decimals` range.
