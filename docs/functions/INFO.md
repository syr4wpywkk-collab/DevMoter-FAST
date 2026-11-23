# INFO

`INFO(type_text)` — returns information about the operating
environment.

v3 expansion (track S10). Legacy function retained for file
compatibility; most outputs describe the host spreadsheet app, not
the workbook.

## Engine requirements
- Requires the engine to expose host-environment facts (OS string,
  app version, workbook directory, file count). In a headless/WASM
  library most of these have no meaningful value — decide a fixed
  documented result per type_text or return `#N/A`. Do NOT fabricate
  host data silently; whatever is returned must be spec-fixed.

## Arguments
- `type_text`: required text, case-insensitive. Documented values:

| type_text | Excel result |
|---|---|
| `"directory"` | path of current directory/folder |
| `"numfile"` | number of open workbooks |
| `"origin"` | `$A:`-prefixed absolute ref of top-left visible cell
  (scroll state — meaningless headless) |
| `"osversion"` | OS version text, e.g. `"Windows (64-bit) ..."` |
| `"recalc"` | `"Automatic"` or `"Manual"` recalculation mode |
| `"release"` | Excel version text |
| `"system"` | `"pcdos"` (Windows) or `"mac"` (classic) |

## Semantics
- Modern Excel maps several of these to fixed/legacy values and
  documentation marks INFO as retained for compatibility — exact
  modern outputs vary; confirm each type_text against a reference
  version before fixing fixture values.
- Volatile in Excel (recalc state/env changes) — likely model as
  non-volatile constants once values are chosen.

## Errors
- Unknown `type_text` -> `#N/A` (confirm; some references say
  `#VALUE!`).
- Arity errors otherwise.

## Examples (indicative — values must be spec-fixed at implementation)
- `=INFO("system")` -> `"pcdos"` (or engine-fixed constant)
- `=INFO("recalc")` -> `"Automatic"` (assuming only automatic mode)
- `=INFO("numfile")` -> `1` (single-workbook engine)
- `=INFO("bogus")` -> `#N/A`

## Open questions
- Exact return per type_text for this engine (table above is Excel's,
  not ours).
- Error code for unknown type_text.
- Whether to implement at all vs map to `#NAME?`-free stub returning
  documented constants.
