# MULTINOMIAL

`MULTINOMIAL(number1, [number2], ...)` — returns the multinomial
coefficient: the ratio of the factorial of the parameter sum to the
product of each parameter's factorial.

## Arguments
- `number1..N`: 1 to 255 numeric scalars/ranges, coerced per the
  direct-argument model. Non-integer values are truncated toward zero
  (Excel truncates).

## Behavior
- `MULTINOMIAL(a,b,c) = (a+b+c)! / (a! * b! * c!)`.
- `MULTINOMIAL(2,3,4)` -> 1260.
- `MULTINOMIAL(2)` -> 1 (single argument).
- `MULTINOMIAL(1.9)` -> 1 (truncated to 1; 1!/1! = 1).

## Errors
- Any argument < 0 (after truncation? — confirm whether truncation
  precedes the check) -> `#NUM!`.
- Non-numeric/coercion failures -> `#VALUE!`; errors propagate.
- Overflow beyond f64 range -> `#NUM!`.

## Edge cases
- Compute in log-space or with iterative products to avoid factorial
  overflow for moderate inputs.
- Blanks in ranged arguments: direct-argument blanks coerce to 0;
  blank cells inside ranges follow the range-scanning model
  (**SPEC-OPEN**: likely treated as 0 / skipped — confirm).

## Open questions
- Order of truncation vs negativity check.
- Blank-cell handling inside range arguments.
