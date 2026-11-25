# CONVERT

`CONVERT(number, from_unit, to_unit)` — converts a number between
measurement units.

## Arguments
- `number`: required numeric.
- `from_unit`, `to_unit`: required **text** unit codes; case-sensitive
  (`"g"` gram vs `"G"` prefix giga — see below).

## Semantics
- `result = number * factor(from->base) / factor(to->base)` within a
  unit category. Categories include weight/mass, distance, time,
  pressure, force, energy, power, magnetism, temperature, volume,
  area, information, speed (2013+/365 additions).
- Metric prefixes (`"k"`,`"M"`,`"G"`,...) and binary prefixes
  (`"Ki"`,`"Mi"`,...) may prefix many units, e.g. `"kg"`, `"MiB"`.
- Temperature uses affine conversion (`"C"`, `"F"`, `"K"`).

## Key unit codes (non-exhaustive)
- Weight: `"g"`, `"sg"`, `"lbm"`, `"u"`, `"ozm"`, `"grain"`, `"cwt"`,
  `"stone"`, `"ton"`.
- Distance: `"m"`, `"mi"`, `"Nmi"`, `"in"`, `"ft"`, `"yd"`, `"ang"`,
  `"pc"`, `"ly"` (2013+), `"Pica"`/`"Picapt"`, `"survey_mi"` (365).
- Time: `"yr"`, `"day"`, `"hr"`, `"mn"`, `"sec"`, `"s"`.
- Temperature: `"C"`/`"cel"`, `"F"`/`"fah"`, `"K"`/`"kel"`,
  `"Rank"` (2013+), `"Reau"` (2013+).
- Volume: `"tsp"`, `"tbs"`, `"oz"`, `"cup"`, `"pt"`, `"qt"`, `"gal"`,
  `"l"`/`"lt"`, `"uk_pt"`, plus cubic `"m3"`-style spellings
  (`"m3"` not canonical — Excel uses `"m^3"`? **SPEC-OPEN**).
- Energy/power/force/pressure/magnetism/information: `"J"`, `"e"`,
  `"c"`, `"cal"`, `"eV"`, `"HPh"`, `"Wh"`, `"flb"`, `"BTU"`/`"btu"`;
  `"W"`, `"HP"`, `"PS"`; `"N"`, `"dyn"`, `"lbf"`, `"pond"`;
  `"Pa"`, `"atm"`, `"mmHg"`, `"psi"`, `"Torr"`; `"T"`, `"ga"`;
  `"bit"`, `"byte"`.

## Errors
- Non-numeric `number` -> `#VALUE!`.
- Unrecognized unit code -> `#N/A`.
- Units from different categories (`"m"` to `"kg"`) -> `#N/A`.
- Invalid prefix on a unit (`"k"` on `"F"`) -> `#N/A`.
- Kelvin below absolute zero result — permitted? Confirm
  (`CONVERT(0,"C","K")` = `273.15`; negative-result `K` errors?).

## Examples
- `CONVERT(1, "lbm", "kg")` = `0.45359237`
- `CONVERT(68, "F", "C")` = `20`
- `CONVERT(2.5, "ft", "sec")` -> `#N/A` (different categories)
- `CONVERT(100, "m", "km")` = `0.1`
- `CONVERT(1, "gal", "l")` = `3.785411784`
- `CONVERT(1, "C", "K")` = `274.15`

## Compatibility notes
- Excel 2003+ (ATP earlier); unit list expanded in 2007, 2013, 2021/
  365 (added `"ly"`, `"Pica"`, `"PS"`, `"bit"/"byte"`, speed, area,
  `"Rank"`, `"Reau"`, `"survey_mi"`, etc.). Full authoritative table:
  Microsoft `CONVERT` docs — catalog must be version-pinned
  (**SPEC-OPEN**: pick Excel 2013 vs 365 unit set).

## Engine requirements
- Static unit-category/prefix table (~100+ entries) — large but pure
  data; no external deps. Case-sensitive unit matching is unusual vs
  other functions.

## Open questions
- Which vintage of the unit table to implement (2013 vs current 365).
- Exact spelling of cubic units and `"teaspoon"` variants (`"tspm"` vs
  `"tsp"` — modern uses `"tspm"`/`"tsp"` both?).
- Whether text `number` like `"5"` coerces (expected yes -> `#VALUE!`
  only for non-numeric text — confirm).
- Prefix applicability rules (prefix allowed on mass in grams, not on
  `"kg"` itself? `"kg"` is a canonical code — is `"kkg"` valid?).
