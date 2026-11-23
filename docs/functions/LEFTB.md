# LEFTB

`LEFTB(text, [num_bytes])` — byte-oriented variant of `LEFT`: returns
the leftmost `num_bytes` **bytes** of `text`, where double-byte
characters count as 2.

## Arguments
- `text`: required; coerced to text.
- `num_bytes`: optional, default `1`; coerced to number, truncated
  toward zero.

## Semantics
- Under DBCS emulation each double-byte character occupies 2 units;
  ASCII occupies 1. `LEFTB("東京都",4)` -> `"東京"`.
- If `num_bytes` falls inside a double-byte character, Excel returns
  fewer bytes (it does not split a character) — the trailing
  half-character is dropped; **confirm** exact rule (e.g.
  `LEFTB("東",1)` -> `""` expected under CP932 semantics).
- Non-DBCS configuration: identical to `LEFT`.

## Errors
- `num_bytes` < 0 -> `#VALUE!`; non-coercible -> `#VALUE!`.
- Errors propagate.

## Examples
- `LEFTB("東京都",4)` -> `"東京"`
- `LEFTB("東京都",3)` -> `"東"` (partial char dropped — confirm)
- `LEFTB("abc",2)` -> `"ab"` (ASCII identical to LEFT)
- `LEFTB("abc")` -> `"a"`
- `LEFTB("abc",-1)` -> `#VALUE!`

## Engine requirements
- Byte-width model shared with `FINDB`/`LENB`/`MIDB`/`RIGHTB`/
  `REPLACEB`/`SEARCHB` (see `FINDB.md` Engine requirements).

## Compatibility
- All Excel versions with DBCS; degrades to `LEFT` otherwise.

## Open questions
- Byte model (CP932 vs UTF-16-unit vs East-Asian width).
- Split-character rule: drop the partial char vs include vs `#VALUE!`.
- Fractional `num_bytes` truncation (expected truncate toward zero).
