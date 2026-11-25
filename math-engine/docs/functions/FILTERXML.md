# FILTERXML

`FILTERXML(xml, xpath)` — applies an XPath expression to XML text and
returns the matched data. Deterministic offline function (no network —
the XML is supplied, typically from `WEBSERVICE`).

## Arguments
- `xml`: required; text — a well-formed XML document (string).
- `xpath`: required; text — XPath expression in standard XPath 1.0?
  Excel states XPath support; exact subset is undocumented —
  **SPEC-OPEN** (believed XPath 1.0, no namespaces beyond declared
  ones).

## Semantics
- If XPath selects a single node: returns its text content (scalar).
- If XPath selects multiple nodes: returns a **vertical** array of the
  nodes' text contents (spills in dynamic-array Excel; legacy CSE
  needed it array-entered).
- Selecting an attribute (`//@id` or `//item/@id`) returns attribute
  values (confirm — Excel supports attribute selection).
- Elements with children: returns concatenated inner text? (confirm —
  Excel returns the element's text content only when it has no child
  elements? **SPEC-OPEN**).
- XML namespaces: namespaced docs require prefixes declared in the
  XPath? Excel behavior with `xmlns` defaults is murky — **SPEC-OPEN**.

## Coercion
- `xml`/`xpath`: text coercion; non-text scalars coerce.

## Errors
- `xml` not well-formed -> `#VALUE!`.
- `xpath` invalid syntax -> `#VALUE!`.
- XPath matches nothing -> `#CALC!` ("array is empty") in modern
  Excel; `#VALUE!` in older builds? — confirm; choose `#CALC!` for
  dynamic-array builds, document the difference.
- `xml`/`xpath` evaluating to an error propagates.

## Examples
- `FILTERXML("<a><b>1</b><b>2</b></a>", "//b")` -> `{1;2}` (vertical
  array; text `"1"`/`"2"` or numbers? — Excel returns text; numeric
  context coerces. Document result type = Text.)
- `FILTERXML("<a><b x='3'/></a>", "//b/@x")` -> `"3"`
- `FILTERXML("<a><b>x</b></a>", "/a/b")` -> `"x"`
- `FILTERXML("<a><b>x</b>", "//c")` -> `#CALC!` (empty result)
- `FILTERXML("not xml", "//a")` -> `#VALUE!`

## Compatibility notes
- Excel 2013+ (Windows; not in Excel for the web/Mac older builds —
  confirm platform availability).

## Open questions
- Exact XPath version/feature subset (predicates, functions like
  `contains()` — believed supported).
- Namespace handling.
- Scalar vs array result type and element-inner-text rules.
- Error code for no-match across builds.
