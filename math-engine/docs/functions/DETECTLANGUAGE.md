# DETECTLANGUAGE

**NOT IMPLEMENTABLE OFFLINE** — `DETECTLANGUAGE` calls the Microsoft
Translator cloud service. The calc engine has no network access
(plan §10.4: no network permission for the calculation core), so this
function can only ever return an explicit unsupported-function error.

`DETECTLANGUAGE(text)` — in Excel, returns an ISO language code
(e.g. `"en"`, `"ja"`) for the detected language of `text`.

## Arguments
- `text`: text to analyze (empty/short input returns an error or
  low-confidence result in Excel).

## Semantics
- Cloud-backed detection; results are nondeterministic across service
  versions and require a Microsoft 365 subscription + connectivity.

## Offline behavior
- Engine returns `#NAME?` (or the engine's designated
  unsupported-function error) — **SPEC-OPEN**: whether to reserve
  the name (so formulas containing it parse but fail at eval) or to
  fail at parse time. Recommend parse-OK / eval `#NAME?`-class error
  so workbook loading does not break.

## Examples (recorded for completeness; not engine-testable)
- `DETECTLANGUAGE("Hello world")` -> `"en"` (Excel online only)
- `DETECTLANGUAGE("こんにちは")` -> `"ja"`

## Compatibility
- Microsoft 365 web/desktop preview feature; not present in perpetual
  Excel. Requires connectivity.

## Open questions
- Which error value the engine uses for known-but-unimplementable
  functions (`#NAME?` vs dedicated code).
- Whether to ship a stub that returns a stored cache value if a
  workbook carries a cached result (plan §8 formula cache policy).
