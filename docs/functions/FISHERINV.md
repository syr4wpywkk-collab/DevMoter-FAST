# FISHERINV

`FISHERINV(y)` — inverse Fisher transformation `tanh(y) =
(e^{2y} - 1) / (e^{2y} + 1)`.

## Arguments
- `y`: any real number; non-numeric -> `#VALUE!`.

## Errors
- None for numeric `y` (saturates toward ±1 for large |y|).

## Examples
- `FISHERINV(0.9729550745276566)` -> `0.75`
- `FISHERINV(0)` -> `0`
- `FISHERINV(10)` -> `0.9999999958776927`
- `FISHERINV("a")` -> `#VALUE!`

## Compatibility
- All Excel versions.

## Open questions
- None.
