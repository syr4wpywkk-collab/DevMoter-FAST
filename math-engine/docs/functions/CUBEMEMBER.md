# CUBEMEMBER

`CUBEMEMBER(connection, member_expression, [caption])` — returns a
member (or tuple) from an OLAP cube for use in `CUBEVALUE`/`CUBESET`.

**NOT IMPLEMENTABLE OFFLINE** — requires a live OLAP connection;
offline stub returns `#N/A`.

## Arguments
- `connection`: required; text — workbook data connection name.
- `member_expression`: required; MDX member expression
  (e.g. `"[Product].[Category].[All Products].children"` returns a
  set? — `CUBEMEMBER` returns a single member/tuple; use `CUBESET`
  for sets).
- `caption`: optional; display text for the cell (defaults to the
  member's caption from the cube).

## Semantics
- Cell value = the member's caption text (or `caption` override); the
  cell *object* carries the member identity so `CUBEVALUE` can use it
  as a slicer.
- Tuples: comma-separated members in parentheses yield a tuple
  (`"([A].[a],[B].[b])"`).

## Errors
- Unknown connection -> `#NAME?`.
- Unresolvable member -> `#N/A`.
- Connection offline -> `#N/A`.

## Examples
- `CUBEMEMBER("Sales","[Product].[Category].[Bikes]")` -> `"Bikes"`
- `CUBEMEMBER("Sales","[Product].[Category].[Bikes]","Bike cat")` ->
  `"Bike cat"` (display) while retaining member identity.
- `CUBEMEMBER("Sales","[Bad].[Member]")` -> `#N/A`

## Engine requirements
- Member-valued cell payloads (beyond `Value`), OLAP connection. Pure
  value engine: stub -> `#N/A`.

## Open questions
- Whether the returned *value* type is text or an opaque member object
  in all contexts (`CUBEMEMBER` result in arithmetic -> ?).
- Tuple syntax details.
