# MATCH

`MATCH(lookup_value, lookup_array, [match_type])` — returns the 1-based
position of `lookup_value` in a one-dimensional `lookup_array`.

## Arguments
- `lookup_value`: scalar (number, text, boolean, cell ref).
- `lookup_array`: a single row or a single column range/array.
  A two-dimensional array -> `#N/A` (documented Excel behavior).
- `match_type`: `1` (default), `0`, or `-1`; coerced/truncated to int.
  Other values -> `#N/A` (confirm).

## match_type semantics
| `match_type` | Meaning | Order requirement |
|---|---|---|
| `1` (default) | largest value <= lookup_value | ascending expected |
| `0` | exact match | any order (linear scan) |
| `-1` | smallest value >= lookup_value | descending expected |

- Order violations do NOT raise an error; Excel binary-searches and may
  return a wrong position or `#N/A`. **SPEC-OPEN** whether we
  binary-search (matching Excel's quirky results) or linear-scan.
- `match_type 0` on text supports wildcards `*` `?` `~`
  (`MATCH("ap*",A1:A3,0)`). Wildcards are literal for match_type ±1.
- Text matching is case-insensitive.
- Types are strict for exact match: the number `1` does not match the
  text `"1"` in `match_type 0`.

## Errors
- No match -> `#N/A`.
- `match_type 1` with lookup smaller than every element -> `#N/A`.
- Error value inside `lookup_array` during a scan: propagate vs skip is
  **SPEC-OPEN**.
- Error `lookup_value` propagates.

## Edge cases
- `MATCH(2.5,{1;2;3;4},1)` -> position of `2` (i.e. 2).
- Descending lookup `{8;6;4;2}` with `-1` and lookup `5` -> position 2
  (smallest value >= 5 is 6).
- Approximate match on text columns uses lexicographic order.

## Confirm against reference
- Unsorted-input behavior for match_type ±1 (binary vs linear scan).
- Wildcard treatment for match_type ±1 (expected literal).
- Error cells inside lookup_array.
- Whether numeric text in cells can match a numeric `lookup_value`
  (expected: no).
