# STOCKHISTORY

**NOT IMPLEMENTABLE OFFLINE** — `STOCKHISTORY` calls Microsoft's cloud
market-data service (Stocks data type / linked data). There is no
local formula semantics to reproduce: every result depends on live
external quote history, and the v1 plan explicitly lists external
network access as out of scope (§1). This spec exists so the function
is documented and can be stubbed with a defined error.

`STOCKHISTORY(stock, start_date, [end_date], [interval], [headers],
[property0], [property1], ...)` — returns a spilling array of
historical OHLCV market data for a ticker.

## Arguments (documented, for completeness)
- `stock`: required ticker identifier text (e.g. `"MSFT"`, `"XNAS:MSFT"`,
  or a Stocks data-type cell — the data-type form needs linked-entity
  support, also out of scope).
- `start_date`: required; earliest trading date >= this is included.
- `end_date`: optional; defaults to `start_date`.
- `interval`: optional `0` daily (default), `1` weekly, `2` monthly.
- `headers`: optional `0` none, `1` show (default), `2` show with
  instrument identifier.
- `property0..4`: optional column selectors:
  `0` Date, `1` Close, `2` Open, `3` High, `4` Low, `5` Volume.
  Default `{0,1}` (Date, Close).

## Semantics
- Spills rows of `len(properties)` columns, one row per trading day in
  range, ascending by date.
- Weekend/holiday start dates snap to the next trading day
  (documented).
- Errors in real Excel: `#VALUE!` for invalid args, `#N/A` / `#BUSY!` /
  `#CONNECT!` / `#BLOCKED!` for service/data problems — all network
  dependent.

## Offline recommendation
- Do not implement. Register the name so formulas parse, and evaluate
  to a documented error (`#N/A` or `#NAME?`-class) with a message that
  external market data is unavailable — never return fabricated
  prices.

## Examples (nominal, from docs — not verifiable offline)
- `=STOCKHISTORY("MSFT",DATE(2024,1,1))` -> `{Date,Close}` spill for
  the first trading day of 2024 (live data).
- `=STOCKHISTORY("XNAS:AAPL",DATE(2024,6,3),DATE(2024,6,7),0,1,0,1)`
  -> date/close grid for that week (live data).
- `=STOCKHISTORY("MSFT","2024-01-01")` -> same as first example
  (text date accepted — coercion confirm irrelevant offline).

## Open questions
- None to resolve offline; the implementability decision itself is the
  spec. If a data-source abstraction is ever added, revisit with a
  pluggable provider.
