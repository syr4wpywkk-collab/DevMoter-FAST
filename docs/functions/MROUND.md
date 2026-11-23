# MROUND

`MROUND(number, multiple)` — rounds `number` to the nearest integer
multiple of `multiple`.

## Arguments
- `number`, `multiple`: numeric scalars, coerced per the
  direct-argument model.

## Behavior
- `MROUND(10, 3)` -> 9; `MROUND(-10, -3)` -> -9;
  `MROUND(1.3, 0.2)` -> 1.4.
- Exact-half cases round away from zero: `MROUND(5, 2)` -> 6;
  `MROUND(-5, -2)` -> -6 (Excel rounds half away from zero).
- Result = `multiple * ROUND(number / multiple, 0)` conceptually.

## Errors
- `number` and `multiple` with different signs -> `#NUM!`
  (e.g. `MROUND(-10, 3)` -> `#NUM!`).
- `multiple` = 0: `MROUND(x, 0)` -> 0 in Excel (documented);
  verify, alternative `#DIV/0!`.
- Coercion failures -> `#VALUE!`; errors propagate.

## Compatibility
- Excel 2003 and earlier required the Analysis ToolPak; native since
  Excel 2007.

## Open questions
- `MROUND(x, 0)` return value (0 vs error) — confirm.
- Exact-half rounding on floating representation boundaries
  (e.g. `MROUND(2.5, 1)`).
