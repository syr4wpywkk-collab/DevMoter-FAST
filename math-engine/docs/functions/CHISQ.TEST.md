# CHISQ.TEST

`CHISQ.TEST(actual_range, expected_range)` — chi-squared independence /
goodness-of-fit test; returns the *right-tailed* p-value
`P(χ² >= statistic)` where `statistic = Σ (A_ij - E_ij)² / E_ij`.

## Arguments
- `actual_range`: rectangular range/array of observed values.
- `expected_range`: same dimensions as `actual_range`.

## Semantics
- Degrees of freedom: for an `r × c` table with `r,c > 1`,
  `df = (r-1)(c-1)`; for a single row or column, `df = n - 1`; for a
  single cell the test is undefined -> `#N/A`.
- p-value computed as `CHISQ.DIST.RT(statistic, df)`.

## Coercion / Errors
- Dimension mismatch -> `#N/A` (documented Excel behavior).
- Non-numeric cells -> `#VALUE!` (**confirm**: Excel requires numeric
  data in both ranges).
- Any `E_ij = 0` -> `#DIV/0!`.
- Single-cell input -> `#N/A`.
- Negative expected values: mathematically invalid — Excel behavior
  **SPEC-OPEN** (likely `#NUM!` or nonsense p).

## Examples
- `CHISQ.TEST({58,35;11,25},{45.22,47.78;23.78,25.22})` — statistic
  ≈ 8.0018, df=1 -> p ≈ `0.004683` (fixture: compute exact)
- `CHISQ.TEST({10,20,30},{20,20,20})` -> statistic `5`, df=2, p =
  `CHISQ.DIST.RT(5,2)` = `0.0820849986238988`
- `CHISQ.TEST({5,10},{5,10})` -> statistic `0`, p = `1`
- `CHISQ.TEST({1,2},{1,2,3})` -> `#N/A`

## Compatibility
- Excel 2010+. Legacy `CHITEST` (same signature).

## Engine requirements
- **Distribution numerics**: chi-squared RT (incomplete gamma).

## Open questions
- Non-numeric/blank cells inside ranges: error vs ignore — flag.
- Behavior when expected contains zeros or negatives.
