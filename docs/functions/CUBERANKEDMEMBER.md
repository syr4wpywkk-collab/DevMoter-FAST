# CUBERANKEDMEMBER

`CUBERANKEDMEMBER(connection, set_expression, rank, [caption])` —
returns the *n*-th member of a cube set.

**NOT IMPLEMENTABLE OFFLINE** — requires a live OLAP connection;
offline stub returns `#N/A`.

## Arguments
- `connection`: required; connection name.
- `set_expression`: required; an MDX set expression **or** a reference
  to a `CUBESET` cell? — Signature per Excel docs takes
  `set_expression` text; passing a `CUBESET` cell is the common
  pattern (confirm — docs say `set` must be defined via `CUBESET` or
  an MDX expression).
- `rank`: required; integer >= 1 — position within the (possibly
  sorted) set.
- `caption`: optional; display text (defaults to member caption).

## Semantics
- Cell value = the member's caption (or `caption` override); retains
  member identity for `CUBEVALUE` use.

## Errors
- `rank` < 1 or > set size -> `#N/A`.
- Unknown connection -> `#NAME?`; bad set -> `#N/A`.
- Non-integer `rank` truncated? (confirm).

## Examples
- `CUBERANKEDMEMBER("Sales",B1,1)` where `B1` = `CUBESET(...,"[Product].[Category].children")` -> first member's caption, e.g. `"Bikes"`.
- `CUBERANKEDMEMBER("Sales",B1,4)` -> 4th member caption; `CUBERANKEDMEMBER("Sales",B1,5)` on a 4-item set -> `#N/A`.
- `CUBERANKEDMEMBER("Sales",B1,2,"Second")` -> `"Second"` displayed.

## Engine requirements
- OLAP connection + member/set payloads. Stub -> `#N/A`.

## Open questions
- Whether `set_expression` accepts a direct `CUBESET`-cell reference
  or must be re-evaluated MDX.
- `rank` coercion/truncation.
