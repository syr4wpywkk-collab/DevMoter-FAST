# EUROCONVERT

`EUROCONVERT(number, source, target, [full_precision], [triangulation_precision])` — converts between euro and legacy eurozone currencies (or between two legacy currencies via the euro triangulation). Deterministic offline function — fixed conversion rates.

## Arguments
- `number`: required; numeric coercion (text numbers coerce? Excel
  expects numeric — confirm text-number coercion).
- `source`, `target`: required; text ISO codes, case-insensitive? —
  one may be `"EUR"`; legacy codes: `ATS BEF CYP DEM EEK ESP FIM FRF
  GRD IEP ITL LTL LUF LVL MTL NLG PTE SIT SKK` (adopted-euro set;
  confirm full list — later adopters like `EEK`, `LVL`, `LTL`, `HRK`?
  HRK joined 2023 — included in current Excel? **SPEC-OPEN**).
- `full_precision`: optional logical; `FALSE` (default) rounds the
  result per the *target* currency's decimal rules; `TRUE` keeps full
  computed precision.
- `triangulation_precision`: optional integer >= 3; significant digits
  kept in the intermediate euro value when converting between two
  non-euro currencies. Default: full precision (no rounding? — Excel
  docs: if omitted, no triangulation rounding; **confirm**).

## Semantics / fixed rates (per EUR)
```
ATS 13.7603   BEF 40.3399   CYP 0.585274  DEM 1.95583
EEK 15.6466   ESP 166.386   FIM 5.94573   FRF 6.55957
GRD 340.750   IEP 0.787564  ITL 1936.27   LTL 3.45280
LUF 40.3399   LVL 0.702804  MTL 0.429300  NLG 2.20371
PTE 200.482   SIT 239.640   SKK 30.1260
```
- EUR -> X: `number * rate`. X -> EUR: `number / rate`.
- X -> Y (both legacy): `number / rateX`, rounded to
  `triangulation_precision` significant digits, then `* rateY`.
- Source == target -> returns `number` unchanged.
- Rounding when `full_precision`=FALSE uses the target currency's
  convention: EUR rounds to 2 decimals; most legacy currencies to
  their historic decimals (ATS/BEF/LUF/ITL/ESP -> 0? confirm per-
  currency decimals table — **SPEC-OPEN** for the full table).

## Errors
- Unknown/`""` currency code, or a non-eurozone code (`"USD"`,
  `"GBP"`) -> `#VALUE!`.
- `source`/`target` both non-EUR and not in the adopted set -> `#VALUE!`.
- `triangulation_precision` < 3? -> `#VALUE!` (confirm boundary —
  docs: if < 0 error; Excel states >= 3).

## Examples
- `EUROCONVERT(100, "EUR", "DEM")` -> `195.58` (100 × 1.95583 =
  195.583, rounded to 2 decimals).
- `EUROCONVERT(100, "EUR", "DEM", TRUE)` -> `195.583`.
- `EUROCONVERT(100, "FRF", "EUR")` -> `15.24` (100 / 6.55957 =
  15.2449… -> 15.24).
- `EUROCONVERT(100, "FRF", "DEM")` -> `29.82`? compute: 100/6.55957 =
  15.2449 EUR × 1.95583 = 29.8173 → `29.82` (verify against triangulation
  rounding rules — **SPEC-OPEN** exact fixture value).
- `EUROCONVERT(100, "EUR", "EUR")` -> `100`
- `EUROCONVERT(100, "EUR", "USD")` -> `#VALUE!`

## Compatibility notes
- Excel 2000+ (Euro Currency Tools add-in originally; built-in since
  Excel 2007).

## Open questions
- Whether `HRK` (Croatia, 2023) is supported in current Excel.
- Per-currency decimal table for `full_precision=FALSE`.
- Default `triangulation_precision` and its minimum.
- Text-number coercion of `number`.
