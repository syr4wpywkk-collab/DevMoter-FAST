# LAMBDA

`LAMBDA(param1, [param2], ..., calculation)` — creates an anonymous
function value; called inline as `LAMBDA(x,x+1)(5)` or passed to
MAP/REDUCE.

## Arguments
- `param`s: names bound when the lambda is invoked; same identifier
  rules as LET names.
- `calculation`: expression evaluated per call in an environment of the
  bound params plus the captured outer scope (closure).

## Behavior
- The result of `LAMBDA(...)` is a `Lambda` value (plan §3 value
  model). Without a call site it evaluates to `#CALC!` in Excel
  (displayed value cannot be a function) — see open questions.
- Closure captures the enclosing LET scope: `LET(a,10,LAMBDA(x,x+a))(5)`
  -> `15`.
- Arity mismatch at call -> `#VALUE!`.

## Recursion & budget limits
- Recursive LAMBDAs (self-reference via LET or named lambdas) are
  bounded by the evaluator's recursion-depth limit and step/memory
  budget (plan §3 実行制限, §9 risk row "LAMBDA/MAP/REDUCEの計算爆
  発: 深度・ステップ・メモリ予算を強制"). Exceeding depth ->
  `#NUM!`-class budget error, not a crash.
- Concrete limits (max depth, max steps per recalc) are set in the
  evaluator budget spec; recommended starting point: depth <= 256,
  total lambda invocations per recalc <= 100,000 — open question
  pending the budget ADR.

## Errors
- `#NAME?` invalid param name; `#VALUE!` arity mismatch at call.
- Budget exhaustion -> defined budget error.

## Open questions
- Display/value of an uncalled LAMBDA result (`#CALC!` vs a printable
  `<function>` text vs engine Lambda value).
- Whether lambdas may be stored in cells/named ranges at all in v2.
- Exact numeric budget constants (deferred to the evaluator budget ADR,
  PR13).
