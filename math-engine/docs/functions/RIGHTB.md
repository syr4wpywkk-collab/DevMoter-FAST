# RIGHTB

`RIGHTB(text, [num_bytes])` — byte-oriented variant of `RIGHT`:
returns the rightmost `num_bytes` bytes of `text`.

## Arguments
- `text`: required; coerced to text.
- `num_bytes`: optional, default `1`; coerced to number, truncated
  toward zero; >= 0 else `#VALUE!`.

## Semantics
- Counts from the right in bytes (double-byte = 2):
  `RIGHTB("東京都",4)` -> `"京都"`.
- A leading partial double-byte char (when `num_bytes` cuts through
  one) is dropped — same split rule as `LEFTB` (confirm).
- Non-DBCS configuration: identical to `RIGHT`.

## Errors
- `num_bytes` < 0 or non-coercible -> `#VALUE!`.
- Errors propagate.

## Examples
- `RIGHTB("東京都",4)` -> `"京都"`
- `RIGHTB("東京都",3)` -> `"都"`? — bytes from right: 都 = 2 bytes,
  +1 byte would cut 京 -> expected `"都"` (partial dropped — confirm)
- `RIGHTB("abc",2)` -> `"bc"` (ASCII identical to `RIGHT`)
- `RIGHTB("abc")` -> `"c"`
- `RIGHTB("abc",-1)` -> `#VALUE!`

## Engine requirements
- Shared byte-width model (`FINDB.md`).

## Compatibility
- All Excel versions with DBCS; degrades to `RIGHT` otherwise.

## Open questions
- Split-character rule at the left boundary of the result.
- Fractional `num_bytes` truncation.
