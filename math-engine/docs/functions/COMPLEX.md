# COMPLEX

`COMPLEX(real_num, i_num, [suffix])` — converts real and imaginary
coefficients into a complex number **text** value like `"3+4i"` or
`"2-j"`.

## Arguments
- `real_num`: required numeric; real coefficient.
- `i_num`: required numeric; imaginary coefficient.
- `suffix`: optional text; either `"i"` (default) or `"j"`. Case —
  Excel lowercases output; passing `"I"`/`"J"` is accepted (confirm).

## Semantics
- Returns a **text** complex number that other `IM*` functions accept.
- Formatting rules: imaginary part `0` -> `"2"` (bare real); real part
  `0` -> `"4i"`; imaginary coefficient `±1` renders without the digit
  (`"3+i"`, `"3-i"`); negative imaginary uses `-` (`"3-4i"`).

## Errors
- Non-numeric `real_num`/`i_num` -> `#VALUE!`.
- `suffix` other than `"i"`/`"j"` -> `#VALUE!`.

## Examples
- `COMPLEX(3, 4)` = `"3+4i"`
- `COMPLEX(3, 4, "j")` = `"3+4j"`
- `COMPLEX(0, 1)` = `"i"`
- `COMPLEX(2, 0)` = `"2"`
- `COMPLEX(3, 4, "k")` -> `#VALUE!`

## Engine requirements
- Requires a complex-number value type or, at minimum, a canonical
  text representation parsed by all `IM*` functions. If the engine has
  no complex type, `COMPLEX` and every `IM*` function must agree on
  the serialized text format (including coefficient precision — Excel
  keeps full double precision internally).

## Compatibility notes
- Excel 2003+ (ATP earlier). `IM*` functions parse only this canonical
  form plus bare reals/imaginaries.

## Open questions
- Accepted `suffix` case variants (`"I"`, `"J"`, mixed?) — confirm.
- Whether the returned text preserves full double precision when fed to
  `IMREAL`/`IMAGINARY` (expected yes).
- Blank coefficient -> `0` (confirm).
