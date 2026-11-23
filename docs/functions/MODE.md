# MODE

`MODE(number1, [number2], ...)` — most frequently occurring value
in the data set (single mode).

Legacy compatibility function; modern equivalents are `MODE.SNGL`
(identical) and `MODE.MULT` (spills all modes). Legacy `MODE`
returns only one mode; with multiple tied modes Excel returns the
first encountered — confirm ordering guarantee.

## Arguments
- `number1`: required; up to 255 scalar/range arguments total.

## Coercion
Same split as `SUM`:
- Range args: text, booleans, blanks ignored; errors propagate.
- Direct scalar args: numeric text and booleans coerced;
  non-numeric text -> `#VALUE!`.

## Semantics
- Returns the value with the highest frequency among numeric
  values. Ties: see Open questions.
- If no value repeats -> `#N/A` (this is the defining documented
  difference from MEDIAN-type functions).

## Errors
- No repeated value -> `#N/A`.
- Empty numeric set -> `#N/A`.
- Non-coercible direct text -> `#VALUE!`; errors propagate.

## Examples
- `MODE({5.6,4,4,3,2,4})` -> `4` (Microsoft docs example)
- `MODE({1,2,3,4})` -> `#N/A`
- `MODE({1,1,2,2,3})` -> `1` (first-encountered tie rule —
  confirm; some references suggest the smallest or first-seen)
- `MODE({7,7,"text","text"})` -> `7` (direct text ignored? — text
  args are coerced-or-error; see coercion)

## Open questions
- Tie-breaking rule (first in input order vs smallest value).
- Whether direct non-numeric text in a MODE arg errors like SUM or
  is ignored.
