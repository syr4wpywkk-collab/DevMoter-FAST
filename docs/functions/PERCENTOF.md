# PERCENTOF

`PERCENTOF(data_subset, data_all)` — returns the percentage that the
sum of `data_subset` makes up of the sum of `data_all`.

## Arguments
- `data_subset`: numeric range/array contributing to the numerator.
  Required.
- `data_all`: numeric range/array contributing to the denominator.
  Required.

## Behavior
- Result = `SUM(data_subset) / SUM(data_all)` expressed as a ratio
  (0-1); display as % is a formatting concern.
- `PERCENTOF({1;2},{1;2;7})` -> 0.3 (3/10).
- Typically used inside `GROUPBY`/`PIVOTBY` lambdas:
  `=GROUPBY(A1:A10,B1:B10,LAMBDA(x,PERCENTOF(x,B1:B10)))`.
- Non-numeric values inside ranges follow the aggregate range-scanning
  model (text/boolean/blank in ranged args are skipped — confirm;
  direct scalar coercion rules apply to direct args).

## Errors
- `SUM(data_all)` = 0 -> `#DIV/0!` (confirm; Excel may return
  `#DIV/0!` or 0 with a warning).
- Empty subsets -> 0 numerator -> 0 (or `#DIV/0!` if all empty).
- Errors inside ranges propagate (aggregate semantics — confirm).

## Compatibility
- New in Excel 365 (2024+); not in Excel 2019/2021 perpetual.
  Requires engine support for passing arrays/ranges to lambda
  parameters (GROUPBY context).

## Engine requirements
- Useful primarily alongside `GROUPBY`/`PIVOTBY` (other tracks);
  standalone implementation is a simple ratio of sums.

## Open questions
- Exact error for empty denominator vs zero-sum denominator.
- Treatment of text/boolean/blank inside ranged arguments.
