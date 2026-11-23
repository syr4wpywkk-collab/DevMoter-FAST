# GAMMALN.PRECISE

`GAMMALN.PRECISE(x)` — identical to `GAMMALN` (Excel 2010+ rename with
claimed better accuracy at the edges; results are the same within
f64 for our purposes — flag any measurable difference).

## Arguments / Errors / Examples
- `x <= 0` -> `#NUM!`; non-numeric -> `#VALUE!`.
- `GAMMALN.PRECISE(4)` -> `1.791759469228055`
- `GAMMALN.PRECISE(0.5)` -> `0.5723649429247001`
- `GAMMALN.PRECISE(0)` -> `#NUM!`

## Compatibility
- Excel 2010+. `GAMMALN` and `GAMMALN.PRECISE` can share one
  implementation; document if Excel results differ in edge regions
  (near x=1, x=2 where Γ=1 and cancellation occurs — `PRECISE` may
  use `lgamma1p`-style paths).

## Engine requirements
- Same as `GAMMALN`; consider a `log1p`-accurate branch near x ∈
  {1,2} if fixtures demand it.

## Open questions
- Whether Excel actually returns different values than `GAMMALN` in
  edge cases.
