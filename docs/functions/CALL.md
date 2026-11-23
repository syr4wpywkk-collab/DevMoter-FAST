# CALL

`CALL(register_id, [argument1], ...)` or the legacy text form
`CALL(module_text, procedure, type_text, [argument1], ...)` — calls a
procedure in a DLL/code resource (or a previously registered function
via `REGISTER.ID`).

**NOT IMPLEMENTABLE OFFLINE / UNSAFE BY DESIGN** — invokes arbitrary
native code via add-ins; only meaningful in legacy Excel macro sheets.
A modern engine should return `#NAME?`/`#N/A` and refuse to load
libraries. Note also that `CALL` is only available inside macro-sheet
contexts in modern Excel and is blocked in normal worksheets (returns
`#N/A`).

## Arguments (register_id form)
- `register_id`: required; value returned by `REGISTER.ID` (or text of
  the registered procedure's ID).
- `argumentN`: passed to the native procedure per its declared
  signature.

## Arguments (legacy form — Excel 4.0 macro sheets only)
- `module_text`: name/path of the DLL or code resource.
- `procedure`: exported function name or ordinal.
- `type_text`: string encoding return and argument types
  (`"A"`–`"R"` codes — see legacy XLM docs).

## Semantics
- Executes native code; result is whatever the procedure returns,
  marshaled per `type_text`.
- Not deterministic, may have side effects; inherently unsafe —
  sandboxed engines MUST NOT implement actual invocation.

## Errors
- Used outside macro-sheet context in modern Excel -> `#N/A`.
- Unknown register_id / failed load -> `#VALUE!`/`#N/A` (confirm).

## Examples (documentary only — do not implement)
- `B1` = `REGISTER.ID("KERNEL32","GetTickCount","J")`;
  `CALL(B1)` -> tick count.
- `CALL("user32","GetKeyState","J","A", 65)` -> key state (XLM only).

## Engine requirements
- Native code execution; explicitly out of scope. Recommended stub:
  `#NAME?` at parse/binding time or `#N/A` at evaluation; document
  choice.

## Open questions
- Which stub error to standardize (`#NAME?` recommended for parity
  with "function unavailable").
