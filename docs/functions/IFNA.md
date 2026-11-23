# IFNA

`IFNA(value, value_if_na)` — returns `value_if_na` only when `value`
evaluates to `#N/A`; otherwise returns `value`.

## Arguments
- `value`: required; any expression, evaluated first.
- `value_if_na`: required; evaluated **only** when `value` is `#N/A`
  (lazy evaluation like `IFERROR`).

## Behavior
- `IFNA(VLOOKUP(...), "not found")` pattern; narrower than `IFERROR`,
  which catches all errors.
- `IFNA(#N/A, 1)` -> 1; `IFNA(#DIV/0!, 1)` -> `#DIV/0!` (propagates);
  `IFNA(5, 1)` -> 5.
- `value_if_na` itself may evaluate to an error — that error is the
  result (not re-trapped).

## Errors
- Any non-`#N/A` error in `value` propagates unchanged.
- Arity errors; coercion not applicable.

## Compatibility
- Introduced in Excel 2013 (Excel 2007 and earlier show `#NAME?`).

## Open questions
- Whether `value_if_na` omitted-but-present (trailing comma) yields 0 —
  same question as `IFERROR`; confirm.
