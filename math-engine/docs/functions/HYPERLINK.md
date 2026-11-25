# HYPERLINK

`HYPERLINK(link_location, [friendly_name])` — creates a clickable
hyperlink. In a value-only engine the meaningful result is the
displayed `friendly_name` (or the URL itself); the link target is
metadata.

## Arguments
- `link_location`: required; text — a URL, a file path, or an
  in-workbook location (`"#Sheet1!A1"` / `"#'Sheet 2'!B2"`; also
  `"A1"` for same-sheet? confirm — Excel requires `#` prefix or a
  defined name for internal jumps).
- `friendly_name`: optional scalar; text displayed in the cell.
  Defaults to `link_location` text. May be a number (coerced to text
  for display; the *value* returned is the number itself — see below).

## Semantics
- Cell *value*: if `friendly_name` is omitted, the cell value is
  `link_location` text; if supplied, the cell value is
  `friendly_name` coerced to its own type? — Excel: when
  `friendly_name` evaluates to a number, the cell shows/behaves as
  that number; when text, as text; error propagates.
- Clicking navigates; for formula engines, store the link as cell
  metadata rather than performing navigation.
- Invalid/unsupported scheme: Excel shows a warning at *click* time,
  not at evaluation — the formula itself still evaluates. A `#VALUE!`
  occurs only for malformed argument types (confirm: empty string
  link_location -> `#VALUE!`?).

## Coercion
- `link_location`: text coercion; number coerces to its text form
  (confirm). Blank -> `""` -> likely `#VALUE!` or a dead link.
- `friendly_name`: passes through without coercion (keeps its type).

## Errors
- Error-valued `friendly_name` propagates.
- `link_location` evaluating to an error propagates.

## Examples
- `HYPERLINK("https://example.com", "Example")` -> `"Example"` (link
  metadata `https://example.com`)
- `HYPERLINK("https://example.com")` -> `"https://example.com"`
- `HYPERLINK("#'Sheet 2'!B5", "Go")` -> `"Go"` (internal link)
- `HYPERLINK("https://example.com", 42)` -> `42` (numeric display
  value — confirm numeric vs text `42`)

## Engine requirements
- Cell metadata: hyperlink target must be attached to the result cell
  (URL + optional internal target). Value semantics alone are
  insufficient for full fidelity; a pure-value implementation may
  return `friendly_name`/`link_location` and drop the link with a
  documented caveat.

## Open questions
- Whether internal links without `#` are valid.
- Type of the returned value when `friendly_name` is numeric/logical.
- Behavior for `link_location` = `""` or a relative path.
