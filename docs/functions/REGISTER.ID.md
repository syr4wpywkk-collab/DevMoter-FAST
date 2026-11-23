# REGISTER.ID

`REGISTER.ID(module_text, procedure, [type_text], [argument_names], [macro_type], [category], [shortcut_text], [help_topic], [function_help], [argument_help1], ...)` — returns the registration ID of a previously-registered DLL/code-resource function for use with `CALL`, or registers a new one.

**NOT IMPLEMENTABLE OFFLINE / UNSAFE BY DESIGN** — registers native
code entry points; modern engines must not implement real
registration. Recommended stub: `#NAME?`/`#N/A`.

## Arguments
- `module_text`: required; DLL/code-resource name.
- `procedure`: required; exported name or ordinal.
- `type_text`: optional; XLM type signature. **If the function was
  already registered**, `REGISTER.ID` can be called with just
  `module_text` + `procedure` to fetch the existing ID without
  re-registering — that is its sole worksheet-safe usage.
- Remaining args: XLM function-wizard metadata (`argument_names`,
  `macro_type` 1=function/2=command, `category`, shortcut key text,
  help references, per-argument help strings — up to ~20 args total).

## Semantics
- With full args: registers the function, returns a `Number` ID that
  `CALL` consumes.
- With only `module_text`/`procedure`: returns the ID if already
  registered, else an error.

## Errors
- Not previously registered (2-arg form) -> `#VALUE!`? (confirm —
  Excel docs: returns `#VALUE!` if not yet registered).
- Load/registration failure -> `#VALUE!`/`#N/A`.
- In modern Excel worksheet context -> `#N/A`? (confirm; XLM-only).

## Examples (documentary only)
- `REGISTER.ID("mylibrary","MyFunc","2BB")` -> e.g. `12345` (ID).
- `REGISTER.ID("mylibrary","MyFunc")` after prior registration -> same
  ID; before registration -> `#VALUE!` (confirm).

## Engine requirements
- Native code registration. Out of scope. Stub -> `#N/A` (or `#NAME?`
  — document choice; pair with `CALL` stub).

## Open questions
- Exact 2-arg "already registered" lookup error code.
- Whether modern Excel evaluates it at all outside macro sheets.
