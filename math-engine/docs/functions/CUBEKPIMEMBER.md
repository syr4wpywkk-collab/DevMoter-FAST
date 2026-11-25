# CUBEKPIMEMBER

`CUBEKPIMEMBER(connection, kpi_name, kpi_property, [caption])` —
returns a KPI component (value/goal/status/trend/weight) from an OLAP
cube.

**NOT IMPLEMENTABLE OFFLINE** — requires a live OLAP connection;
offline stub returns `#N/A`.

## Arguments
- `connection`: required; connection name.
- `kpi_name`: required; text — name of the KPI in the cube.
- `kpi_property`: required; integer `1`–`7`? Excel uses:
  `1` KPIValue, `2` KPIGoal, `3` KPIStatus, `4` KPITrend,
  `5` KPIWeight, `6` KPICurrentTimeMember (confirm numeric enum —
  Excel documents these as integers 1–6; `7` reserved/absent).
- `caption`: optional; cell display text.

## Semantics
- `KPIStatus` is conventionally in `[-1,1]` and Excel displays it with
  the workbook's KPI graphic; raw numeric value is returned.
- KPITrend indicates direction (e.g. up/down arrows); raw numeric.

## Errors
- Unknown connection -> `#NAME?`.
- Unknown KPI or out-of-range property -> `#N/A`.
- KPIs unsupported by the cube -> `#N/A`? (confirm).

## Examples
- `CUBEKPIMEMBER("Sales","Revenue KPI",1)` -> KPI current value.
- `CUBEKPIMEMBER("Sales","Revenue KPI",3)` -> status in `[-1,1]`.
- `CUBEKPIMEMBER("Sales","NoKPI",1)` -> `#N/A`

## Engine requirements
- OLAP connection. Stub -> `#N/A`.

## Open questions
- Exact `kpi_property` integer enumeration and allowed range.
- Display semantics (icon sets) vs raw value.
