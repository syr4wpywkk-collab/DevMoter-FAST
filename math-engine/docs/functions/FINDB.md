# FINDB

`FINDB(find_text, within_text, [start_num])` — byte-oriented variant
of `FIND`: case-sensitive search returning a **byte position**
(counted in the DBCS encoding, where each double-byte character
counts as 2).

## Arguments
- Identical to `FIND`: `find_text`, `within_text`, optional
  `start_num` (default 1), all coerced per `FIND` rules.
- `start_num` is expressed in **bytes**, must be >= 1 and <=
  LENB(within_text), else `#VALUE!`.

## Semantics
- Same matching rules as `FIND` (case-sensitive, no wildcards) but
  positions are byte counts: each double-byte character contributes
  2 to the count, each single-byte 1.
- Outside DBCS locales `FINDB` behaves identically to `FIND` (every
  char counts as 1) — Excel behavior in non-DBCS configurations.

## Engine requirements — byte-oriented text semantics
- Requires a defined "byte width per character" table for the engine's
  DBCS emulation. Recommendation: use the *UTF-16 code-unit* width
  model or a fixed East-Asian-width model — **SPEC-OPEN** which
  reference the fixtures target (CP932 byte semantics is most faithful
  to Excel's DBCS behavior).

## Errors
- `#VALUE!` no match or `start_num` out of range.
- Errors propagate.

## Examples (assuming DBCS where CJK = 2 bytes)
- `FINDB("京","東京都")` -> `3` (東京 = 2+2 bytes before match? No —
  東 occupies bytes 1-2, 京 starts at byte 3) -> `3`
- `FINDB("b","abc")` -> `2` (ASCII-only: identical to `FIND`)
- `FINDB("m","Miriam")` -> `#VALUE!` (case-sensitive)

## Compatibility
- All Excel versions with DBCS support enabled; degrades to `FIND`
  otherwise. Counterpart: `SEARCHB` (case-insensitive + wildcards).

## Open questions
- Byte model to adopt (CP932 bytes vs UTF-16 units vs East-Asian
  width) — fixtures must record the reference system.
- `start_num` alignment: if `start_num` points inside a double-byte
  char, does Excel snap/return `#VALUE!`/match from there?
