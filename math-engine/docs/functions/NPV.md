# NPV

`NPV(rate, value1, [value2], ...)` — net present value of a series of
cash flows discounted at `rate`, where `value1` is one period from
now.

## Arguments
- `rate`: required; discount rate per period.
- `value1..valueN`: at least one required; up to 253 in modern Excel.
  May be scalars, ranges, or arrays.

## Semantics
- `NPV = sum_i value_i / (1+rate)^i` for `i = 1..n`. Cash flows occur
  at **end** of each period; a t=0 investment is added separately
  (`NPV(r, flows) + initial`, the classic idiom).
- This is NOT the same as `PV`, which handles the annuity/`type`
  timing convention.

## Argument/value coercion (Excel rules — verify)
- Scalar args that are numbers, or text representing numbers, or
  booleans: coerced and included.
- Scalar args that are non-numeric text -> `#VALUE!`.
- Inside ranges/arrays: numbers included; **text, booleans, and
  blanks are skipped** (they do not contribute a term — confirm
  whether they consume a period index or are skipped entirely:
  Excel skips them *and* they still occupy a period? Per docs, empty
  cells/logical/text in ranges are ignored — the position still
  advances the period count? **SPEC-OPEN** — test both readings
  against reference).
- Errors anywhere propagate.

## Errors
- `rate <= -1` -> `#NUM!`? (result blows up; Excel may produce
  `#NUM!` or a huge number — confirm).
- Non-numeric scalar -> `#VALUE!`.

## Examples
- `NPV(0.1, -10000, 3000, 4200, 6800)` -> `1188.44...` (Excel doc
  example; verify).
- `NPV(0.08, {8000,9200,10000,12000,14500})` -> `41059.2...` approx
  plus separate initial outlay idiom `+(-40000)`.
- `NPV(0, 100, 200)` -> `300`.
- `NPV(0.1, 100, "abc")` -> `#VALUE!` (direct scalar text).

## Edge cases
- Range containing blanks among numbers: period indexing question
  above is critical for golden fixtures.

## Open questions
- Do skipped (blank/text/bool) range elements consume a period index?
- `rate = -1` behavior (`#NUM!` vs `#DIV/0!` vs inf).
- Error element inside a range: propagate (expected).
