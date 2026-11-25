# FORECAST.LINEAR

`FORECAST.LINEAR(x, known_ys, known_xs)` — modern name (Excel 2016+)
for `FORECAST`; identical semantics: least-squares linear prediction.

## Arguments / Errors / Examples
- Identical to `FORECAST.md`. Same examples:
  - `FORECAST.LINEAR(30,{6,7,9,15,21},{20,28,31,38,40})` ->
    `10.607253086419761`
  - `FORECAST.LINEAR(10,{2,4,6},{1,2,3})` -> `20`
  - `FORECAST.LINEAR(5,{1,2,3},{7,7,7})` -> `#DIV/0!`

## Compatibility
- Excel 2016+ (non-backwards file format implications only;
  `FORECAST` remains supported everywhere).

## Open questions
- None beyond `FORECAST`.
