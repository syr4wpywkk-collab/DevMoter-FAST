# WEBSERVICE

`WEBSERVICE(url)` — returns the response body of an HTTP GET to `url`
as text. Companions: `FILTERXML` (parse), `ENCODEURL` (encode parts).

**NOT IMPLEMENTABLE OFFLINE** — requires network access. Recommended
stub: `#VALUE!` (Excel's documented failure error) for all inputs, or
`#N/A`; document choice. Engines that permit network may implement
with a strict allowlist + timeout.

## Arguments
- `url`: required; text. Must be a valid absolute URL. Excel supports
  `http://`/`https://`; `ftp://`/`file://` -> `#VALUE!` (confirm
  current behavior — docs say only http/https supported).

## Semantics
- Performs an HTTP GET; returns the raw response body as `Text`
  (XML/JSON/whatever — no parsing).
- Response is cached per Excel's refresh policy (volatile-ish; recalc
  re-fetches? confirm — Excel recalculates and refetches on demand).
- Large responses truncated at the 32,767-char cell limit? (confirm).

## Errors
- Malformed URL, unsupported scheme, unreachable host, non-2xx, or
  >2048-char URL -> `#VALUE!`.
- Proxy/auth failure -> `#VALUE!`.

## Examples
- `WEBSERVICE("https://example.com/data.xml")` -> `"<root>...</root>"`
- `WEBSERVICE("notaurl")` -> `#VALUE!`
- `WEBSERVICE("ftp://x/f")` -> `#VALUE!`
- `WEBSERVICE("https://example.com"&ENCODEURL("a b"))` -> combined URL
  fetch.

## Engine requirements
- Network access + URL validation; security-sensitive (SSRF). Pure
  offline engine: stub error on all inputs.

## Compatibility notes
- Excel 2013+. Not supported on Excel for the web/mobile (returns
  `#VALUE!` there — confirm).

## Open questions
- Redirect following and timeout policy.
- Response size limit and truncation vs error.
- Whether result is volatile in Excel.
