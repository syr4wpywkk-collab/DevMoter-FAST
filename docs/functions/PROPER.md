# PROPER

`PROPER(text)` — capitalizes the first letter of each word and
lowercases the rest.

## Arguments
- `text`: coerced to text.

## Behavior
- A "word" starts after any non-letter character (digits, punctuation,
  spaces all act as separators — matching Excel).
- First letter after a separator is uppercased; subsequent letters are
  lowercased.
- `PROPER("2-way street")` -> `"2-Way Street"`.
- `PROPER("76BudGet")` -> `"76Budget"`.

## Errors
- None beyond propagated argument errors.

## Edge cases
- Apostrophes: `PROPER("it's")` -> `"It'S"` in Excel (apostrophe is a
  separator) — verify and fixture.
- Non-cased characters unaffected.

## Open questions
- Exact word-boundary definition for Unicode letters and apostrophe-like
  characters (U+2019) — plan §2 (note 065) requires this in writing;
  finalize against reference fixtures.
