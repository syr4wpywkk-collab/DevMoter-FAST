# MAX

`MAX(number1, [number2], ...)` — largest numeric value.

## Arguments / coercion
Same coercion table as SUM.

## Behavior
- No numeric values -> `0`.
- Errors in inputs propagate.

## Edge cases
- `MAX(FALSE,-3)` -> `0` (FALSE coerces to 0 in direct args; see
  P1-MAX-009).
- All-negative range -> least negative value.

## Confirm against reference
- Same error-propagation check as MIN.
