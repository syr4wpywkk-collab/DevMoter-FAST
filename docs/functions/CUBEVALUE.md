# CUBEVALUE

`CUBEVALUE(connection, [member_expression1], [member_expression2], ...)` — returns an aggregated value from an OLAP cube (data model / Analysis Services connection).

**NOT IMPLEMENTABLE OFFLINE** — requires a live OLAP/Tabular data
connection. Offline implementation should return `#N/A` (no data /
connection unavailable) and be documented as a stub.

## Arguments
- `connection`: required; text — name of a workbook data connection
  (e.g. `"ThisWorkbookDataModel"` or `"Adventure Works"`).
- `member_expressionN`: optional; MDX member expressions or cell
  references to cells containing them — each slices the query
  (e.g. `"[Product].[Category].[Bikes]"`). With none, returns the
  cube's default aggregate ("grand total").

## Semantics
- Builds an MDX query over the connection; result is the measure value
  at the intersection of all member expressions.
- While the connection is being established/refreshed, cells may show
  `#GETTING_DATA` / `#N/A` (Excel shows "#GETTING_DATA…" transiently —
  confirm surface error type).
- Member expressions may reference other cells holding `CUBEMEMBER`
  results — a `CUBEMEMBER` result cell used as `member_expressionN`
  contributes its member. Passing a range contributes all members of
  that range as a set.

## Errors
- Unknown connection name -> `#NAME?`.
- Connection exists but is offline/unavailable -> `#N/A`.
- Malformed MDX member expression -> `#N/A`? (confirm — Excel
  surfaces `#N/A` for unresolvable members).
- More than 255 member expressions -> `#VALUE!`? (confirm limit).

## Examples
- `CUBEVALUE("Adventure Works", "[Measures].[Internet Sales]")` ->
  total internet sales (number; requires live connection).
- `CUBEVALUE("ThisWorkbookDataModel", "[Measures].[Sales]", "[Product].[Color].[Red]")` -> red-product sales.
- `CUBEVALUE("BadConnection")` -> `#NAME?`

## Engine requirements
- OLAP connection manager + MDX evaluation. Out of scope for a pure
  value engine; stub -> `#N/A` for valid syntax, `#NAME?` for unknown
  connection is only feasible if a connection registry exists —
  simplest conforming stub returns `#N/A` for all inputs.

## Compatibility notes
- Excel 2007+. Requires Excel Data Model or external SSAS connection.

## Open questions
- Exact error code per failure mode (`#N/A` vs `#NAME?` vs `#VALUE!`).
- Transient-state semantics during refresh.
