# ROUNDDOWN

`ROUNDDOWN(number, num_digits)` — rounds `number` toward zero to
`num_digits` decimal places.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.
- `num_digits`: required integer; negative values round to the left
  of the decimal point; non-integers truncated.

## Behavior
- `ROUNDDOWN(3.2, 0)` -> 3; `ROUNDDOWN(76.9, 0)` -> 76;
  `ROUNDDOWN(3.14159, 3)` -> 3.141; `ROUNDDOWN(-3.14159, 1)` -> -3.1;
  `ROUNDDOWN(31415.92654, -2)` -> 31400.
- Always toward zero — the counterpart of `ROUNDUP`.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- Extreme `num_digits` (|d| > ~308) -> `#NUM!` or clamps to 0
  magnitude (confirm vs Excel: `ROUNDDOWN(1, -400)` -> 0?).

## Edge cases
- Implement via decimal-string or scaled `trunc` to match Excel; raw
  `f64` scaling introduces boundary drift — pin fixtures near .5
  boundaries.

## Open questions
- Excel behavior for |num_digits| beyond representable scale.
