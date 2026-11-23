#!/usr/bin/env python3
"""Validate golden fixture JSON files against tests/fixtures/FORMAT.md.

Usage: python3 tests/fixtures/validate.py <fixture.json> [<fixture.json> ...]
Exit code 0 = all files valid.
"""

import json
import re
import sys

ERROR_CODES = {
    "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!",
    "#N/A", "#NULL!", "#SPILL!", "#CALC!", "#CIRC!",
}
ADDR_RE = re.compile(r"^(\$?[A-Z]{1,3}\$?[0-9]{1,7})$|^([^!]+![A-Z]{1,3}[0-9]{1,7})$")
EXPECTED_KEYS = {"number", "text", "bool", "error", "blank", "array"}
REFERENCE_REQUIRED = {"implementation", "version", "dateSystem", "source"}


def fail(errors, where, msg):
    errors.append(f"{where}: {msg}")


def check_value(v, where, errors):
    """Check a scalar value used in inputs or array elements."""
    if isinstance(v, bool) or isinstance(v, (int, float)) or isinstance(v, str):
        return
    if isinstance(v, dict):
        if set(v.keys()) == {"blank"} and v["blank"] is True:
            return
        if set(v.keys()) == {"error"} and v["error"] in ERROR_CODES:
            return
    fail(errors, where, f"invalid value {v!r}")


def check_case(case, where, errors):
    if not isinstance(case, dict):
        fail(errors, where, "case is not an object")
        return
    for key in ("id", "formula", "inputs", "expected"):
        if key not in case:
            fail(errors, where, f"missing required field '{key}'")

    cid = case.get("id")
    if not isinstance(cid, str) or not cid:
        fail(errors, where, "'id' must be a non-empty string")

    formula = case.get("formula")
    if not isinstance(formula, str) or not formula.startswith("="):
        fail(errors, where, "'formula' must be a string starting with '='")

    inputs = case.get("inputs")
    if not isinstance(inputs, dict):
        fail(errors, where, "'inputs' must be an object")
    else:
        for addr, v in inputs.items():
            if not ADDR_RE.match(addr):
                fail(errors, where, f"bad cell address {addr!r}")
            check_value(v, f"{where} input {addr}", errors)

    exp = case.get("expected")
    if not isinstance(exp, dict):
        fail(errors, where, "'expected' must be an object")
    else:
        kinds = [k for k in exp if k in EXPECTED_KEYS]
        if len(kinds) != 1:
            fail(errors, where, f"'expected' must have exactly one of {sorted(EXPECTED_KEYS)}")
        else:
            k = kinds[0]
            v = exp[k]
            if k == "number":
                if not isinstance(v, (int, float)) or isinstance(v, bool):
                    fail(errors, where, "expected.number must be numeric")
                if "tolerance" in exp and not isinstance(exp["tolerance"], (int, float)):
                    fail(errors, where, "expected.tolerance must be numeric")
            elif k == "text":
                if not isinstance(v, str):
                    fail(errors, where, "expected.text must be a string")
            elif k == "bool":
                if not isinstance(v, bool):
                    fail(errors, where, "expected.bool must be a boolean")
            elif k == "error":
                if v not in ERROR_CODES:
                    fail(errors, where, f"bad error code {v!r}")
            elif k == "blank":
                if v is not True:
                    fail(errors, where, "expected.blank must be true")
            elif k == "array":
                if not isinstance(v, list) or not all(isinstance(r, list) for r in v):
                    fail(errors, where, "expected.array must be a list of row lists")
                elif v:
                    width = len(v[0])
                    for r in v:
                        if len(r) != width:
                            fail(errors, where, "expected.array must be rectangular")
                            break
                        for el in r:
                            check_value(el, f"{where} array element", errors)
            extra = set(exp) - EXPECTED_KEYS - {"tolerance"}
            if extra:
                fail(errors, where, f"unexpected expected keys {sorted(extra)}")

    ref = case.get("reference")
    if not isinstance(ref, dict):
        fail(errors, where, "'reference' missing or not an object")
    else:
        for key in REFERENCE_REQUIRED:
            if not isinstance(ref.get(key), str) or not ref[key]:
                fail(errors, where, f"reference.{key} must be a non-empty string")
        if ref.get("dateSystem") not in ("1900", "1904"):
            fail(errors, where, "reference.dateSystem must be '1900' or '1904'")

    if case.get("specOpen") is True:
        if not isinstance(case.get("specOpenReason"), str) or not case["specOpenReason"]:
            fail(errors, where, "specOpen cases require a non-empty specOpenReason")
    elif "specOpen" in case and case["specOpen"] is not False:
        fail(errors, where, "specOpen must be a boolean")


def validate(path):
    errors = []
    try:
        doc = json.load(open(path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return [f"{path}: cannot load JSON: {e}"]

    if not isinstance(doc, dict):
        return [f"{path}: top level must be an object"]
    if not isinstance(doc.get("formatVersion"), int):
        fail(errors, path, "missing integer 'formatVersion'")
    if not isinstance(doc.get("generated"), str):
        fail(errors, path, "missing 'generated' date string")
    defaults = doc.get("referenceDefaults", {})
    if not isinstance(defaults, dict):
        fail(errors, path, "'referenceDefaults' must be an object")

    cases = doc.get("cases")
    if not isinstance(cases, list) or not cases:
        fail(errors, path, "'cases' must be a non-empty array")
    else:
        seen = set()
        for i, case in enumerate(cases):
            where = f"{path} case[{i}] id={case.get('id')!r}" if isinstance(case, dict) else f"{path} case[{i}]"
            check_case(case, where, errors)
            if isinstance(case, dict):
                cid = case.get("id")
                if cid in seen:
                    fail(errors, where, "duplicate id")
                seen.add(cid)
                # merge referenceDefaults
                if isinstance(case.get("reference"), dict):
                    merged = {**defaults, **case["reference"]}
                    case["reference"] = merged
                    for key in REFERENCE_REQUIRED:
                        if not isinstance(case["reference"].get(key), str) or not case["reference"][key]:
                            fail(errors, where, f"reference.{key} missing after defaults merge")
    return errors


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    all_errors = []
    for path in sys.argv[1:]:
        errs = validate(path)
        all_errors.extend(errs)
        if not errs:
            print(f"{path}: OK")
    for e in all_errors:
        print("ERROR", e)
    print(f"{len(all_errors)} error(s)")
    return 1 if all_errors else 0


if __name__ == "__main__":
    sys.exit(main())
