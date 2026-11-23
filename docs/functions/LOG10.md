# LOG10

`LOG10(number)` — returns the base-10 logarithm of `number`.

## Arguments
- `number`: required positive numeric scalar, coerced per the
  direct-argument model.

## Behavior
- `LOG10(x) = log10(x)`, equivalent to `LOG(x, 10)`.
- `LOG10(10)` -> 1; `LOG10(100)` -> 2; `LOG10(1)` -> 0;
  `LOG10(86)` -> 1.9344984512435675 (approx).

## Errors
- `number` <= 0 -> `#NUM!` (includes blank -> 0).
- Coercion failures -> `#VALUE!`.
- Error inputs propagate.

## Edge cases
- Powers of 10 should return exact integers where representable;
  document tolerance vs `f64::log10`.

## Compatibility
- Legacy function; equivalent to `LOG(number,10)`. `LOG` with omitted
  base also defaults to 10.

## Open questions
- Whether to implement via `log10` or `ln/ln(10)` — compare against
  reference fixtures.
