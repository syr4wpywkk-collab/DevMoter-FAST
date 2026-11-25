# CUBESETCOUNT

`CUBESETCOUNT(set)` — returns the number of items in a `CUBESET` result.

**NOT IMPLEMENTABLE OFFLINE** — depends on `CUBESET`, which requires a
live OLAP connection; offline stub returns `#N/A`.

## Arguments
- `set`: required; a reference to a cell containing a `CUBESET`
  formula (Excel requires it be a `CUBESET` cell, or a `CUBESET`
  expression? — `CUBESETCOUNT` takes a set expression argument, most
  commonly a reference to a `CUBESET` cell).

## Semantics
- Returns `Number` — cardinality of the set, `0` for empty sets.

## Errors
- Argument is not a set (e.g. a plain value cell) -> `#VALUE!`?
  (confirm — Excel returns `#VALUE!` for non-set input).
- Referenced `CUBESET` cell in error state propagates.

## Examples
- `CUBESETCOUNT(B1)` where `B1` = `CUBESET("Sales","[Product].[Category].children")` over 4 categories -> `4`
- `CUBESETCOUNT(B1)` where `B1`'s set is empty -> `0`
- `CUBESETCOUNT(A1)` where `A1` = `42` -> `#VALUE!` (confirm)

## Engine requirements
- Set-valued cell payloads. Stub -> `#N/A`.

## Open questions
- Whether a literal MDX set expression (not via `CUBESET` cell) is
  accepted.
- Exact error for non-set argument.
