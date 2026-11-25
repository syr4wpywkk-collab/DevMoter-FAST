# RTD

`RTD(progID, server, topic1, [topic2], ...)` — retrieves real-time data
from a COM automation server that supports RTD.

**NOT IMPLEMENTABLE OFFLINE** — requires a registered COM RTD server
and a live data feed. An offline engine should return `#N/A` (Excel's
result when no RTD server supplies data) or `#NAME?` and document the
stub.

## Arguments
- `progID`: required; text — registered ProgID of the RTD add-in
  (e.g. `"excel.rtd"` for the built-in RTD server).
- `server`: required; text — server name where the RTD server runs;
  `""` or omitted for local machine.
- `topicN`: 1..253 topic strings/values identifying the data item.

## Semantics
- Connects to the RTD server, subscribes to `topicN`s, and updates the
  cell whenever the server pushes new data (throttled by Excel's RTD
  throttle interval).
- While no data has arrived, the cell shows `#N/A`.
- Disconnected/unavailable server -> `#N/A`.
- Volatile/push-driven: outside the pull-based dependency model.

## Errors
- Invalid `progID` or unreachable server -> `#N/A`.
- Malformed topics -> `#N/A` (confirm whether any path yields
  `#VALUE!`).

## Examples
- `RTD("excel.rtd", "", "5")` -> data pushed by the RTD add-in for
  topic `"5"`; `#N/A` until data arrives.
- `RTD("myrtdserver", "", "MSFT", "Price")` -> live quote
- `RTD("no.such.server", "", "x")` -> `#N/A`

## Engine requirements
- Push-based external data source; COM interop. Not part of a pure
  value engine — specify stub error `#N/A`.

## Compatibility notes
- Windows/desktop Excel only; not supported in Excel for the web or
  non-Windows builds.

## Open questions
- Whether argument-count violations produce `#VALUE!` vs `#N/A`.
- Behavior of `server` argument on non-Windows builds (moot if stubbed).
