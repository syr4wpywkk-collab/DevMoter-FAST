# TRANSLATE

**NOT IMPLEMENTABLE OFFLINE** — `TRANSLATE` calls the Microsoft
Translator cloud service. The calc engine has no network access
(plan §10.4), so this function can only ever return an explicit
unsupported-function error.

`TRANSLATE(text, [source_language], [target_language])` — in Excel,
translates `text` between languages using Microsoft Translator.

## Arguments
- `text`: text to translate.
- `source_language`: optional ISO code (e.g. `"en"`); default
  `"auto"` (service-side detection).
- `target_language`: optional ISO code; default the user's Excel
  display language.

## Semantics
- Cloud-backed; requires connectivity + Microsoft 365. Results are
  nondeterministic and versioned by the service. May return an array
  of alternatives in some UIs — SPEC-OPEN/irrelevant offline.

## Offline behavior
- Engine returns `#NAME?` (or designated unsupported-function
  error); recommend parse-OK / eval error so workbook loading does
  not break — shared SPEC-OPEN with `DETECTLANGUAGE.md`.
- If a workbook stores a cached result, the engine may surface the
  cache per plan §8 cache policy — but must never compute it.

## Examples (reference only; not engine-testable)
- `TRANSLATE("Hello","en","fr")` -> `"Bonjour"` (Excel online only)

## Compatibility
- Microsoft 365 preview function; absent from perpetual Excel.

## Open questions
- Unsupported-function error identity (`#NAME?` vs dedicated code).
- Whether cached values may be read through (same policy question as
  all cloud functions).
