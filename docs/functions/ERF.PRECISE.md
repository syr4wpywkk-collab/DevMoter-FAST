# ERF.PRECISE

`ERF.PRECISE(x)` — returns the error function `erf(x)` integrated from
`0` to `x`.

## Arguments
- `x`: required numeric.

## Semantics
- `erf(x) = 2/sqrt(pi) * integral_0^x e^{-t^2} dt`; odd function;
  range `(-1, 1)`.
- Equivalent to `ERF(x)`; the `.PRECISE` suffix denotes the Excel 2010
  accuracy-improved implementation.

## Errors
- Non-numeric `x` -> `#VALUE!`.

## Examples
- `ERF.PRECISE(0.745)` = `0.707929` (approx `0.7079286694`)
- `ERF.PRECISE(1)` = `0.842701` (approx `0.8427007929`)
- `ERF.PRECISE(0)` = `0`
- `ERF.PRECISE(-0.5)` = `-0.520500` (approx `-0.5204998778`)

## Compatibility notes
- Excel 2010+. Use `ERF` for 2003/2007 compatibility.

## Engine requirements
- Same erf numerics as `ERF` — implement once, share.

## Open questions
- None identified; confirm parity with `ERF` single-arg.
