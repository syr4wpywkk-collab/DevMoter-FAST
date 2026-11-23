# SEARCHB

`SEARCHB(find_text, within_text, [start_num])` — byte-oriented
variant of `SEARCH`: case-insensitive search with wildcards,
returning a **byte position**.

## Arguments
- Same as `SEARCH`: `find_text`, `within_text`, optional `start_num`
  (default 1, byte-based, must be within `1..LENB(within_text)`).

## Semantics
- Same matching rules as `SEARCH` — case-insensitive; wildcards `?`
  matches any **one byte**? — **SPEC-OPEN**: under DBCS semantics `?`
  in `SEARCH` matches one character; whether `SEARCHB`'s `?` matches
  one byte or one character is undocumented (expected: one character,
  matching `SEARCH`). Record from reference.
- `*` matches any byte/char sequence; `~` escapes as in `SEARCH`.
- Return value is the byte index of the first match.
- Non-DBCS configuration: identical to `SEARCH`.

## Errors
- `#VALUE!` no match or `start_num` out of range.
- Errors propagate.

## Examples
- `SEARCHB("B","abc")` -> `2` (case-insensitive, ASCII)
- `SEARCHB("京","東京都")` -> `3` (byte position under DBCS model)
- `SEARCHB("b*n","banana")` -> `1`
- `SEARCHB("x","abc")` -> `#VALUE!`

## Engine requirements
- Shared byte-width model (`FINDB.md`).

## Compatibility
- All Excel versions with DBCS; degrades to `SEARCH` otherwise.
- Case-sensitivity note: `FINDB`/`SEARCHB` mirror `FIND`/`SEARCH` —
  use `FINDB` for case-sensitive byte search.

## Open questions
- Wildcard `?` width under byte semantics.
- Case-folding scope (ASCII vs Unicode) — shared with `SEARCH`.
- `start_num` inside a double-byte character.
