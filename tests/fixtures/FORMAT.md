# Golden fixture format

Golden fixtures are JSON files. Each file contains a top-level object with
metadata plus a `cases` array. Every case records a formula, its cell inputs,
the expected result, and the reference implementation the expectation was
taken from, satisfying the recording requirements of
`docs/IMPLEMENTATION_PLAN.md` §10.5 (implementation, version, OS/locale,
date system, formula, inputs, expected value).

## Top-level object

```json
{
  "formatVersion": 1,
  "generated": "2026-11-23",
  "referenceDefaults": { "...": "see below" },
  "cases": [ { "...": "see below" } ]
}
```

- `formatVersion` (integer, required): schema version of this file.
- `generated` (string, required): ISO date the file was produced/last revised.
- `referenceDefaults` (object, optional): a `reference` object whose fields
  are inherited by every case. A case-level `reference` overrides individual
  fields (shallow merge).
- `cases` (array, required, non-empty): the test cases.

## Case object

```json
{
  "id": "P1-SUM-001",
  "formula": "=SUM(A1:A3)",
  "inputs": { "A1": 1, "A2": 2, "A3": 3 },
  "expected": { "number": 6 },
  "reference": {
    "implementation": "Microsoft Excel",
    "version": "general documented behavior (not empirically recorded)",
    "dateSystem": "1900",
    "locale": "en-US",
    "source": "..."
  },
  "specOpen": false,
  "notes": "optional free text"
}
```

### `id` (string, required, unique)

Format: `<GROUP>-<NNN>` or `<GROUP>-<FUNC>-<NNN>` where `FUNC` is the upper
case function name. Groups used so far:

- `GEN-*`: representative cases from the implementation plan §10.2.
- `P1-<FUNC>-*`: Phase 1 per-function cases.

### `formula` (string, required)

A single formula, always beginning with `=`. Cell references inside the
formula use A1 notation on the default sheet (`Sheet1`).

### `inputs` (object, required, may be empty)

Maps A1 addresses to cell inputs. The formula cell itself is never listed;
the result cell is assumed to be a scratch cell (e.g. `Z1`). Address keys
must match `^[A-Z]{1,3}[0-9]{1,7}$` (optionally `Sheet!A1` later).

Values:

| JSON value      | Meaning                                      |
|-----------------|----------------------------------------------|
| `3`, `-2.5`     | number cell                                  |
| `"x"`           | text cell (a literal `""` is an empty string, NOT blank) |
| `true`/`false`  | boolean cell                                 |
| `{"blank":true}`| explicitly empty/blank cell                  |

Cells not listed are blank. The `{"blank":true}` form exists so fixtures can
express "the cell participates in the range but is empty" explicitly.

### `expected` (object, required)

Exactly one of:

- `{"number": <f64>, "tolerance": <f64?>}` — numeric result. `tolerance`
  gives the absolute error bound; when absent the runner may apply a small
  default epsilon but should first try exact comparison.
- `{"text": "<string>"}` — text result, compared exactly.
- `{"bool": <boolean>}` — boolean result.
- `{"error": "<code>"}` — error result; `code` is one of `#DIV/0!`,
  `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#N/A`, `#NULL!`, `#SPILL!`,
  `#CALC!`, `#CIRC!`.
- `{"blank": true}` — the result is a blank/empty value.
- `{"array": [[...], ...]}` — a spilled/array result as a row-major matrix of
  scalar values (each element: number, string, boolean, `{"error": code}`, or
  `{"blank": true}`). Rows must be rectangular. Used by later-phase dynamic
  array functions; Phase 1 cases do not require it.

### `reference` (object, required after defaults merge)

Records the compatibility oracle per §10.5. Required fields:

- `implementation` (string): e.g. `"Microsoft Excel"`, `"LibreOffice Calc"`.
- `version` (string): product version, or `"general documented behavior"`
  when the expectation follows published/general specification rather than
  an empirical recording.
- `dateSystem` (string): `"1900"` or `"1904"`.
- `source` (string): where the expectation comes from (documentation,
  empirical capture, etc.).

Optional: `os`, `locale`, `recordedBy`.

If a reference implementation cannot be run in CI, the verified fixture is
committed and the generation procedure and source are recorded here (§10.5).

### `specOpen` (boolean, optional, default `false`)

`true` means the expected value is NOT yet pinned: the correct Excel/
LibreOffice behavior is uncertain and the case documents the question. A
`specOpen` case MUST carry `specOpenReason` (string) explaining what must be
confirmed. Expected values MUST NOT be fixed by guess; when in doubt, set
`specOpen` instead.

### `notes` (string, optional)

Free-form context: spec citations, edge-case rationale, related Issue IDs.

## Validation

`tests/fixtures/validate.py <file>` checks structural conformance: required
fields, types, unique ids, formula prefix, address format, `expected`
variants, reference fields, and the `specOpen`/`specOpenReason` rule.
