# MIDB

`MIDB(text, start_num, num_bytes)` — byte-oriented variant of `MID`:
extracts `num_bytes` bytes starting at byte position `start_num`.

## Arguments
- `text`: required; coerced to text.
- `start_num`: required; 1-based **byte** position; >= 1.
- `num_bytes`: required; byte count to extract; >= 0.

## Semantics
- Positions counted in bytes (double-byte = 2): `MIDB("東京都",3,2)`
  -> `"京"`.
- `start_num` > LENB(text) -> `""`.
- `num_bytes` extending past the end returns to the end; a partial
  double-byte char at either boundary is dropped (same split rule as
  `LEFTB` — confirm).
- Non-DBCS configuration: identical to `MID`.

## Errors
- `start_num` < 1 or `num_bytes` < 0 -> `#VALUE!`.
- Non-coercible args -> `#VALUE!`; errors propagate.

## Examples
- `MIDB("東京都",3,2)` -> `"京"`
- `MIDB("東京都",1,4)` -> `"東京"`
- `MIDB("東京都",2,2)` -> `"東"`? — `start_num=2` lands inside 東
  (bytes 1-2); **SPEC-OPEN** (expected: skip to next boundary or
  `#VALUE!`)
- `MIDB("abcdef",2,3)` -> `"bcd"` (ASCII identical to `MID`)
- `MIDB("abc",4,1)` -> `""`

## Engine requirements
- Shared byte-width model (`FINDB.md`).

## Compatibility
- All Excel versions with DBCS; degrades to `MID` otherwise.

## Open questions
- Boundary rules when `start_num` or `start_num+num_bytes` splits a
  double-byte character.
- Fractional argument truncation.
