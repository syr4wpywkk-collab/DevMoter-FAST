# TYPE

`TYPE(value)` — returns a code for the data type of `value`.

v3 expansion (track S10).

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Return codes
| Code | Meaning |
|---:|---|
| 1 | Number |
| 2 | Text |
| 4 | Logical |
| 16 | Error |
| 64 | Array |
| 128 | (Excel docs: "compound data" / anything else — modern addition,
   rarely seen; confirm relevance) |

## Semantics
- `TYPE` does **not** propagate errors — an error argument returns
  `16` (confirm; documented that TYPE tests the value kind).
- Blank cell reference: Excel returns `1` (blank coerced to number for
  typing purposes) — **confirm against reference**; alternatively some
  references report blank as 1 via the numeric coercion.
- `TYPE` of a date is `1` (serial number).
- `TYPE` of a multi-cell range or array literal is `64` — the engine
  may never see ranges as values until array support lands.
- Useful in `SUM`-style guards: `IF(TYPE(x)=16, ...)` predates
  `IFERROR`.

## Errors
- Does not error on error input (returns 16). Otherwise never errors.

## Examples
- `=TYPE(1.5)` -> `1`
- `=TYPE("abc")` -> `2`
- `=TYPE(TRUE)` -> `4`
- `=TYPE(1/0)` -> `16`
- `=TYPE({1,2;3,4})` -> `64`

## Open questions
- Blank cell result (expected `1`).
- Whether lambda / reference / spill-range value kinds map to 128 or
  raise an error.
