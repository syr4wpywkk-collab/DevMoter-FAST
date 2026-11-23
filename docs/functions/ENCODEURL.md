# ENCODEURL

`ENCODEURL(text)` — percent-encodes `text` for use as a URL
component. Deterministic; implementable offline.

## Arguments
- `text`: required; text coercion (numbers/booleans coerce to their
  text form; blank -> `""`).

## Semantics
- Applies UTF-8 percent-encoding to characters that are unsafe in a
  URL. Alphanumerics and `-_.~` are unreserved; everything else
  (spaces, `&`, `=`, `?`, `/`, non-ASCII) -> `%XX` byte sequences.
- Excel encodes **more aggressively than RFC 3986 in places**: e.g.
  it encodes `/` and `?` (so it is suited to query *values*, not whole
  URLs). Confirm the exact unreserved set on current builds —
  **SPEC-OPEN** (documented behavior: "encodes characters that are not
  alphanumeric"; punctuation handling is underspecified).
- Uppercase hex digits in output (`%20`, `%E2%82%AC`).

## Coercion
- Non-text input coerced to text first (`ENCODEURL(5)` -> `"5"`).
- Errors propagate.

## Errors
- Only argument errors: error input propagates; there is no encoding
  failure path (every UTF-8 string encodes).

## Examples
- `ENCODEURL("hello world")` -> `"hello%20world"`
- `ENCODEURL("a&b=c")` -> `"a%26b%3Dc"` (confirm `=` -> `%3D`)
- `ENCODEURL("100%")` -> `"100%25"`
- `ENCODEURL("café")` -> `"caf%C3%A9"` (UTF-8 encoding of `é`)
- `ENCODEURL("https://x/y?a=b")` -> `"https%3A%2F%2Fx%2Fy%3Fa%3Db"`
  (whole-URL input becomes unusable as a URL — confirm `:`/`/` are
  encoded)

## Compatibility notes
- Excel 2013+.

## Open questions
- Exact unreserved character set (whether `!`, `'`, `(`, `)`, `*` are
  encoded).
- Whether already-encoded `%` sequences are double-encoded (believed
  yes: `%20` -> `%2520`).
