# VALUE

`VALUE(text)` — parses a text string into a number.

## Arguments
- `text`: a single value. Direct-argument coercion applies: a number is
  returned as-is; a boolean coerces to 1/0 (**confirm** vs Excel);
  an error propagates.

## Parsing rules (fixed subset)
- Leading/trailing whitespace is ignored.
- Optional sign, decimal `.`, thousands `,` separators (only in valid
  grouping positions), exponent `E`/`e` notation.
- Trailing `%` divides by 100: `VALUE("5%")` -> `0.05`.
- Empty or whitespace-only text -> `#VALUE!`.

## Errors
- `#VALUE!` for unparseable text (`"abc"`, `"1,2,3"` with bad grouping,
  `"--3"`).

## Edge cases
- `VALUE(" 1,234.50 ")` -> `1234.5`.
- `VALUE("1e3")` -> `1000`.
- `VALUE("")` -> `#VALUE!`.
- Result is a `Number`, not text.

## Open questions
- Date/time text (`"2026-01-01"`, `"12:30"`) — Excel converts these to
  date serials; whether the initial subset supports them and under which
  fixed locale is undecided.
- Currency symbols: `$` after the optional sign is accepted (`"$1,000"`,
  `"-$5"`), by `VALUE` and by implicit conversion alike. Other symbols
  (`"¥1000"`) depend on the locale and stay undecided.
- Thousands separator / decimal point for non-US locales — plan fixes
  one locale (§2, note 058: ロケール固定); which one is recorded here
  once decided.
