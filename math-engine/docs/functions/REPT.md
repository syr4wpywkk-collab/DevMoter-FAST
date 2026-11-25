# REPT

`REPT(text, number_times)` — returns `text` repeated `number_times`
times.

## Arguments
- `text`: required; coerced to text.
- `number_times`: required; coerced to number, truncated toward zero
  to an integer. Negative -> `#VALUE!`. `0` -> `""`.

## Semantics
- `REPT("ab",3)` -> `"ababab"`.
- Fractional counts truncate: `REPT("x",2.9)` -> `"xx"`.
- Empty `text` -> `""` for any valid count.

## Errors
- `number_times` < 0 -> `#VALUE!`.
- Result length exceeding Excel's 32,767-char cell limit -> `#VALUE!`
  (documented Excel behavior: REPT overflows -> `#VALUE!`; adopt the
  engine text-limit policy — confirm).
- Errors propagate.

## Examples
- `REPT("ab",3)` -> `"ababab"`
- `REPT("*",5)` -> `"*****"`
- `REPT("x",0)` -> `""`
- `REPT("x",2.9)` -> `"xx"`
- `REPT("x",-1)` -> `#VALUE!`

## Compatibility
- All Excel versions.

## Open questions
- Overflow error identity (`#VALUE!` expected) and engine text-length
  cap (shared with `CONCAT`/`TEXTJOIN`).
- Whether `number_times` is truncated or rounded for fractional
  values (expected truncate; verify).
