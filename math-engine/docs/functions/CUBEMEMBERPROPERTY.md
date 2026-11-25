# CUBEMEMBERPROPERTY

`CUBEMEMBERPROPERTY(connection, member_expression, property)` —
returns a property of a cube member.

**NOT IMPLEMENTABLE OFFLINE** — requires a live OLAP connection;
offline stub returns `#N/A`.

## Arguments
- `connection`: required; connection name text.
- `member_expression`: required; MDX member expression or a cell
  containing a `CUBEMEMBER` result.
- `property`: required; property name — e.g. a member property such as
  `"MEMBER_CAPTION"`, `"UNIQUE_NAME"`, or a dimension attribute.

## Semantics
- Returns the property value as text/number per the cube's schema.
- Common properties: `MEMBER_CAPTION`, `UNIQUE_NAME`, `MEMBER_KEY`,
  `LEVEL_NUMBER`, `PARENT_UNIQUE_NAME`, plus user-defined attribute
  properties (confirm canonical list).

## Errors
- Unknown connection -> `#NAME?`.
- Unresolvable member or property -> `#N/A`.

## Examples
- `CUBEMEMBERPROPERTY("Sales","[Product].[Category].[Bikes]","UNIQUE_NAME")` -> `"[Product].[Category].&[1]"` (value is cube-specific).
- `CUBEMEMBERPROPERTY("Sales",B2,"MEMBER_CAPTION")` where `B2` holds a
  `CUBEMEMBER` result -> the member's caption.
- `CUBEMEMBERPROPERTY("Sales","[Product].[Category].[Bikes]","NOSUCH")` -> `#N/A`

## Engine requirements
- OLAP connection + member-valued cells. Stub -> `#N/A`.

## Open questions
- Canonical intrinsic property list and naming.
- Return typing per property kind.
