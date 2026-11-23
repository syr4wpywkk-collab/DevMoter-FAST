#!/usr/bin/env python3
"""Generate tests/fixtures/golden-lookup.json (run from repo root)."""

import json

REF = {
    "implementation": "Microsoft Excel",
    "version": "general documented behavior (not empirically recorded)",
    "dateSystem": "1900",
    "os": "any",
    "locale": "en-US",
    "source": "Published Excel/LibreOffice general specification; to be re-recorded empirically per plan section 10.5",
}

cases = []


def c(cid, formula, inputs, expected, specOpen=None, notes=None):
    case = {
        "id": cid,
        "formula": formula,
        "inputs": inputs,
        "expected": expected,
        "reference": REF,
    }
    if specOpen:
        case["specOpen"] = True
        case["specOpenReason"] = specOpen
    if notes:
        case["notes"] = notes
    cases.append(case)


num = lambda n: {"number": n}
text = lambda s: {"text": s}
err = lambda s: {"error": s}
blank = {"blank": True}

# ---------- INDEX ----------
c("LK-INDEX-001", "=INDEX(A1:A3,2)", {"A1": 10, "A2": 20, "A3": 30}, num(20))
c("LK-INDEX-002", "=INDEX(A1:C1,2)", {"A1": 10, "B1": 20, "C1": 30}, num(20),
  notes="Row vector: single index counts across columns.")
c("LK-INDEX-003", "=INDEX(A1:B2,2,1)", {"A1": 1, "B1": 2, "A2": 3, "B2": 4}, num(3))
c("LK-INDEX-004", "=INDEX(A1:B2,1,2)", {"A1": 1, "B1": 2, "A2": 3, "B2": 4}, num(2))
c("LK-INDEX-005", "=INDEX(A1:A3,1.9)", {"A1": 10, "A2": 20, "A3": 30}, num(10),
  notes="Fractional index truncates toward zero.")
c("LK-INDEX-006", "=INDEX(A1:A3,4)", {"A1": 10, "A2": 20, "A3": 30}, err("#REF!"))
c("LK-INDEX-007", "=INDEX(A1:A3,-1)", {"A1": 10, "A2": 20, "A3": 30}, err("#REF!"))
c("LK-INDEX-008", "=INDEX(A1:B2,1,3)", {"A1": 1, "B1": 2, "A2": 3, "B2": 4}, err("#REF!"))
c("LK-INDEX-009", "=INDEX(A1:A3,2)", {"A1": 10, "A2": {"blank": True}, "A3": 30}, blank,
  notes="Indexing a blank cell returns blank.")
c("LK-INDEX-010", "=INDEX(A1:A3,2)",
  {"A1": 10, "A2": {"error": "#DIV/0!"}, "A3": 30}, err("#DIV/0!"),
  notes="Returning an error cell propagates the error.")
c("LK-INDEX-011", "=INDEX(A1:A3,\"x\")", {"A1": 10, "A2": 20, "A3": 30}, err("#VALUE!"),
  notes="Non-coercible index.")
c("LK-INDEX-012", "=INDEX(A1:A3,\"2\")", {"A1": 10, "A2": 20, "A3": 30}, num(20),
  specOpen="Numeric-text index coercion to 2 (expected); confirm.")
c("LK-INDEX-013", "=INDEX(A1:B2,2)", {"A1": 1, "B1": 2, "A2": 3, "B2": 4},
  {"array": [[3, 4]]},
  specOpen="Omitted column on a 2-D range: whole-row array under dynamic semantics; legacy Excel implicit-intersects. Engine returns the array.")
c("LK-INDEX-014", "=INDEX(A1:A3,0)", {"A1": 10, "A2": 20, "A3": 30},
  {"array": [[10], [20], [30]]},
  specOpen="Index 0 returns the whole column array under dynamic semantics; pre-spill Excel may differ.")

# ---------- MATCH ----------
c("LK-MATCH-001", "=MATCH(2,A1:A4,0)", {"A1": 1, "A2": 2, "A3": 3, "A4": 4}, num(2))
c("LK-MATCH-002", "=MATCH(\"APPLE\",A1:A3,0)", {"A1": "banana", "A2": "apple", "A3": "cherry"}, num(2),
  notes="Case-insensitive text match.")
c("LK-MATCH-003", "=MATCH(\"ap*\",A1:A3,0)", {"A1": "zzz", "A2": "apple", "A3": "apex"}, num(2),
  notes="Wildcards under match_type 0.")
c("LK-MATCH-004", "=MATCH(\"1\",A1:A3,0)", {"A1": 1, "A2": 2, "A3": 3}, err("#N/A"),
  notes="Type-strict: text '1' does not match number 1.")
c("LK-MATCH-005", "=MATCH(4,A1:A4)", {"A1": 1, "A2": 2, "A3": 3, "A4": 4}, num(4),
  notes="Omitted match_type defaults to 1.")
c("LK-MATCH-006", "=MATCH(2.5,A1:A4,1)", {"A1": 1, "A2": 2, "A3": 3, "A4": 4}, num(2))
c("LK-MATCH-007", "=MATCH(5,A1:A4,-1)", {"A1": 8, "A2": 6, "A3": 4, "A4": 2}, num(2),
  notes="Descending data, match_type -1.")
c("LK-MATCH-008", "=MATCH(9,A1:A4,0)", {"A1": 1, "A2": 2, "A3": 3, "A4": 4}, err("#N/A"))
c("LK-MATCH-009", "=MATCH(0,A1:A4,1)", {"A1": 1, "A2": 2, "A3": 3, "A4": 4}, err("#N/A"),
  notes="Lookup below all elements under match_type 1.")
c("LK-MATCH-010", "=MATCH(2,A1:B2,0)", {"A1": 1, "B1": 2, "A2": 3, "B2": 4}, err("#N/A"),
  notes="2-D lookup_array is #N/A in Excel.")
c("LK-MATCH-011", "=MATCH(3,A1:A4,0)", {"A1": 4, "A2": 3, "A3": 3, "A4": 1}, num(2),
  notes="First duplicate wins under match_type 0.")
c("LK-MATCH-012", "=MATCH(\"y\",A1:B1,0)", {"A1": "x", "B1": "y"}, num(2),
  notes="Row vector lookup_array.")
c("LK-MATCH-013", "=MATCH(2,A1:A4,7)", {"A1": 1, "A2": 2, "A3": 3, "A4": 4}, err("#N/A"),
  specOpen="Invalid match_type error code: #N/A assumed per spec doc; confirm vs #VALUE!.")
c("LK-MATCH-014", "=MATCH(3,A1:A4,1)", {"A1": 4, "A2": 1, "A3": 9, "A4": 2}, num(2),
  specOpen="Unsorted input under match_type 1: engine binary-search result; Excel's own result is order-dependent — record empirically.")

# ---------- XLOOKUP ----------
xl_table = {"A1": "a", "A2": "b", "A3": "c", "B1": 10, "B2": 20, "B3": 30}
c("LK-XLOOKUP-001", "=XLOOKUP(\"b\",A1:A3,B1:B3)", xl_table, num(20))
c("LK-XLOOKUP-002", "=XLOOKUP(\"B\",A1:A3,B1:B3)", xl_table, num(20),
  notes="Case-insensitive exact match.")
c("LK-XLOOKUP-003", "=XLOOKUP(\"z\",A1:A3,B1:B3)", xl_table, err("#N/A"))
c("LK-XLOOKUP-004", "=XLOOKUP(\"z\",A1:A3,B1:B3,\"missing\")", xl_table, text("missing"))
c("LK-XLOOKUP-005", "=XLOOKUP(\"bb\",A1:A3,B1:B3,,-1)", xl_table, num(20),
  notes="match_mode -1: exact or next smaller.")
c("LK-XLOOKUP-006", "=XLOOKUP(\"bb\",A1:A3,B1:B3,,1)", xl_table, num(30),
  notes="match_mode 1: exact or next larger.")
c("LK-XLOOKUP-007", "=XLOOKUP(\"b*\",A1:A3,B1:B3,,2)", xl_table, num(20),
  notes="match_mode 2: wildcard match.")
c("LK-XLOOKUP-008", "=XLOOKUP(\"x\",A1:A2,B1:B2,,0,-1)",
  {"A1": "x", "A2": "x", "B1": 1, "B2": 2}, num(2),
  notes="search_mode -1: last match wins.")
c("LK-XLOOKUP-009", "=XLOOKUP(\"b\",A1:A3,B1:B2)", xl_table, err("#VALUE!"),
  notes="return_array length mismatch along the search dimension.")
c("LK-XLOOKUP-010", "=XLOOKUP(\"b\",A1:B3,B1:B3)", xl_table, err("#VALUE!"),
  notes="2-D lookup_array is #VALUE!.")
c("LK-XLOOKUP-011", "=XLOOKUP(2,A1:A3,B1:B3,,0,2)",
  {"A1": 1, "A2": 2, "A3": 3, "B1": 10, "B2": 20, "B3": 30}, num(20),
  notes="search_mode 2: binary search ascending.")
c("LK-XLOOKUP-012", "=XLOOKUP(2,A1:A3,B1:B3,,0,-2)",
  {"A1": 3, "A2": 2, "A3": 1, "B1": 30, "B2": 20, "B3": 10}, num(20),
  notes="search_mode -2: binary search descending.")
c("LK-XLOOKUP-013", "=XLOOKUP(\"y\",A1:B1,A2:B2)",
  {"A1": "x", "B1": "y", "A2": 1, "B2": 2}, num(2),
  notes="Row-vector lookup.")
c("LK-XLOOKUP-014", "=XLOOKUP(\"b\",A1:A2,B1:C2)",
  {"A1": "a", "A2": "b", "B1": 1, "B2": 2, "C1": 10, "C2": 20},
  {"array": [[2, 20]]},
  specOpen="Wide return_array produces a row-slice array; legacy Excel spills — engine returns the array value directly.")
c("LK-XLOOKUP-015", "=XLOOKUP(\"b\",A1:A3,B1:B3,,9)", xl_table, err("#VALUE!"),
  notes="Invalid match_mode.")
c("LK-XLOOKUP-016", "=XLOOKUP(\"b\",A1:A3,B1:B3,,0,9)", xl_table, err("#VALUE!"),
  notes="Invalid search_mode.")

# ---------- VLOOKUP ----------
vt = {"A1": "apple", "A2": "banana", "A3": "cherry", "B1": 10, "B2": 20, "B3": 30}
c("LK-VLOOKUP-001", "=VLOOKUP(\"banana\",A1:B3,2,FALSE)", vt, num(20))
c("LK-VLOOKUP-002", "=VLOOKUP(\"BANANA\",A1:B3,2,0)", vt, num(20),
  notes="Exact match is case-insensitive.")
c("LK-VLOOKUP-003", "=VLOOKUP(\"ch*\",A1:B3,2,FALSE)", vt, num(30),
  specOpen="Wildcard support in exact mode (expected per spec doc); confirm ~ escape handling.")
c("LK-VLOOKUP-004", "=VLOOKUP(\"fig\",A1:B3,2,FALSE)", vt, err("#N/A"))
c("LK-VLOOKUP-005", "=VLOOKUP(4,A1:B3,2)",
  {"A1": 1, "A2": 3, "A3": 5, "B1": 10, "B2": 30, "B3": 50}, num(30),
  notes="Approximate (default TRUE): largest key <= 4 is 3.")
c("LK-VLOOKUP-006", "=VLOOKUP(0,A1:B3,2)",
  {"A1": 1, "A2": 3, "A3": 5, "B1": 10, "B2": 30, "B3": 50}, err("#N/A"),
  notes="Approximate lookup below all keys.")
c("LK-VLOOKUP-007", "=VLOOKUP(\"banana\",A1:B3,0,FALSE)", vt, err("#VALUE!"),
  notes="col_index_num < 1.")
c("LK-VLOOKUP-008", "=VLOOKUP(\"banana\",A1:B3,3,FALSE)", vt, err("#REF!"),
  notes="col_index_num beyond table width.")
c("LK-VLOOKUP-009", "=VLOOKUP(\"banana\",A1:B3,1.9,FALSE)", vt, text("banana"),
  notes="Fractional col_index_num truncates to 1.")
c("LK-VLOOKUP-010", "=VLOOKUP(1/0,A1:B3,2,FALSE)", vt, err("#DIV/0!"),
  notes="Error lookup_value propagates.")
c("LK-VLOOKUP-011", "=VLOOKUP(\"k\",A1:B1,2,FALSE)", {"A1": "k", "B1": 9}, num(9),
  notes="Single-row table is legal.")
c("LK-VLOOKUP-012", "=VLOOKUP(TRUE,A1:B3,1,FALSE)",
  {"A1": False, "A2": True, "A3": "x", "B1": 1, "B2": 2, "B3": 3}, num(2),
  specOpen="Boolean key exact match (expected position 2); confirm.")

# ---------- HLOOKUP ----------
ht = {"A1": "apple", "B1": "banana", "C1": "cherry", "A2": 10, "B2": 20, "C2": 30}
c("LK-HLOOKUP-001", "=HLOOKUP(\"banana\",A1:C2,2,FALSE)", ht, num(20))
c("LK-HLOOKUP-002", "=HLOOKUP(\"BANANA\",A1:C2,2,0)", ht, num(20),
  notes="Case-insensitive exact match.")
c("LK-HLOOKUP-003", "=HLOOKUP(\"ch?rry\",A1:C2,2,FALSE)", ht, num(30),
  notes="Wildcard ? in exact mode.")
c("LK-HLOOKUP-004", "=HLOOKUP(\"fig\",A1:C2,2,FALSE)", ht, err("#N/A"))
c("LK-HLOOKUP-005", "=HLOOKUP(4,A1:C2,2)",
  {"A1": 1, "B1": 3, "C1": 5, "A2": 10, "B2": 30, "C2": 50}, num(30),
  notes="Approximate default: largest key <= 4.")
c("LK-HLOOKUP-006", "=HLOOKUP(0,A1:C2,2,TRUE)",
  {"A1": 1, "B1": 3, "C1": 5, "A2": 10, "B2": 30, "C2": 50}, err("#N/A"))
c("LK-HLOOKUP-007", "=HLOOKUP(\"banana\",A1:C2,0,FALSE)", ht, err("#VALUE!"),
  notes="row_index_num < 1.")
c("LK-HLOOKUP-008", "=HLOOKUP(\"banana\",A1:C2,3,FALSE)", ht, err("#REF!"),
  notes="row_index_num beyond table height.")
c("LK-HLOOKUP-009", "=HLOOKUP(\"banana\",A1:C2,1,FALSE)", ht, text("banana"),
  notes="Returning from the header row itself.")
c("LK-HLOOKUP-010", "=HLOOKUP(1/0,A1:C2,2,FALSE)", ht, err("#DIV/0!"))
c("LK-HLOOKUP-011", "=HLOOKUP(\"k\",A1:A2,2,FALSE)", {"A1": "k", "A2": 9}, num(9),
  notes="Single-column table is legal.")

# ---------- LOOKUP ----------
lt = {"A1": 1, "A2": 2, "A3": 3, "A4": 4, "B1": "a", "B2": "b", "B3": "c", "B4": "d"}
c("LK-LOOKUP-001", "=LOOKUP(2.5,A1:A4,B1:B4)", lt, text("b"))
c("LK-LOOKUP-002", "=LOOKUP(3,A1:A4,B1:B4)", lt, text("c"))
c("LK-LOOKUP-003", "=LOOKUP(0,A1:A4,B1:B4)", lt, err("#N/A"),
  notes="Lookup below all elements.")
c("LK-LOOKUP-004", "=LOOKUP(99,A1:A4,B1:B4)", lt, text("d"),
  notes="Lookup above all elements returns the last.")
c("LK-LOOKUP-005", "=LOOKUP(2,A1:A4,B1:B2)", lt, err("#N/A"),
  specOpen="result_vector size mismatch -> #N/A per spec doc; confirm error code.")
c("LK-LOOKUP-006", "=LOOKUP(2.5,A1:B4)",
  {"A1": 1, "A2": 2, "A3": 3, "A4": 4, "B1": 10, "B2": 20, "B3": 30, "B4": 40},
  num(20), notes="Array form, taller than wide: first column / last column.")
c("LK-LOOKUP-007", "=LOOKUP(2.5,A1:D2)",
  {"A1": 1, "B1": 2, "C1": 3, "D1": 4, "A2": 10, "B2": 20, "C2": 30, "D2": 40},
  num(20), notes="Array form, wider than tall: first row / last row.")
c("LK-LOOKUP-008", "=LOOKUP(1.5,A1:B2)",
  {"A1": 1, "B1": 100, "A2": 2, "B2": 200}, num(100),
  specOpen="Square array form orientation: column search assumed; confirm vs Excel.")
c("LK-LOOKUP-009", "=LOOKUP(\"BANANA\",A1:A2,B1:B2)",
  {"A1": "apple", "A2": "banana", "B1": 1, "B2": 2}, num(2),
  notes="Case-insensitive approximate text match.")
c("LK-LOOKUP-010", "=LOOKUP(1/0,A1:A4,B1:B4)", lt, err("#DIV/0!"))
c("LK-LOOKUP-011", "=LOOKUP(2.5,A1:C1,A2:C2)",
  {"A1": 1, "B1": 2, "C1": 3, "A2": "a", "B2": "b", "C2": "c"}, text("b"),
  notes="Horizontal vector form.")

# ---------- CHOOSE ----------
c("LK-CHOOSE-001", "=CHOOSE(2,\"a\",\"b\",\"c\")", {}, text("b"))
c("LK-CHOOSE-002", "=CHOOSE(1,42,1/0)", {}, num(42),
  notes="Lazy: unselected error argument is not evaluated.")
c("LK-CHOOSE-003", "=CHOOSE(2,42,1/0)", {}, err("#DIV/0!"),
  notes="Error in the selected argument propagates.")
c("LK-CHOOSE-004", "=CHOOSE(1.9,10,20)", {}, num(10),
  notes="Fractional index truncates toward zero.")
c("LK-CHOOSE-005", "=CHOOSE(TRUE,10,20)", {}, num(10),
  specOpen="Boolean index coercion TRUE->1 (expected); confirm.")
c("LK-CHOOSE-006", "=CHOOSE(0,10,20)", {}, err("#VALUE!"))
c("LK-CHOOSE-007", "=CHOOSE(3,10,20)", {}, err("#VALUE!"))
c("LK-CHOOSE-008", "=CHOOSE(\"x\",10,20)", {}, err("#VALUE!"))
c("LK-CHOOSE-009", "=CHOOSE(A1,10,20)", {"A1": 2}, num(20))
c("LK-CHOOSE-010", "=CHOOSE(1/0,10,20)", {}, err("#DIV/0!"))
c("LK-CHOOSE-011", "=CHOOSE(2,A1:A2,B1:B2)", {"A1": 1, "A2": 2, "B1": 7, "B2": 8},
  {"array": [[7], [8]]},
  specOpen="Range-valued result returned as an array; no reference type exists yet.")

# ---------- ROW ----------
c("LK-ROW-001", "=ROW(A5)", {}, num(5))
c("LK-ROW-002", "=ROW(X1000)", {}, num(1000))
c("LK-ROW-003", "=ROW($A$7)", {}, num(7))
c("LK-ROW-004", "=ROW(A5:A7)", {}, {"array": [[5], [6], [7]]},
  specOpen="Multi-cell reference: dynamic-array {5;6;7} vs legacy implicit intersection.")
c("LK-ROW-005", "=ROW(B3:D5)", {}, {"array": [[3], [4], [5]]},
  notes="Row span of a 2-D range.")
c("LK-ROW-006", "=ROW(3)", {}, err("#VALUE!"),
  specOpen="Non-reference argument error code (#VALUE! assumed); confirm.")
c("LK-ROW-007", "=ROW(A7:A5)", {}, {"array": [[5], [6], [7]]},
  notes="Reversed range normalizes.")
c("LK-ROW-008", "=ROW()", {}, err("#N/A"),
  specOpen="Caller-cell position is not available in the engine's function context yet; #N/A is a placeholder for the engine gap, not Excel semantics.")
c("LK-ROW-009", "=ROWS(A1:A1)+ROW(A2)", {}, num(3))
c("LK-ROW-010", "=ROW(A5:A5)", {}, {"array": [[5]]})

# ---------- COLUMN ----------
c("LK-COLUMN-001", "=COLUMN(C3)", {}, num(3))
c("LK-COLUMN-002", "=COLUMN(AA10)", {}, num(27))
c("LK-COLUMN-003", "=COLUMN($D$1)", {}, num(4))
c("LK-COLUMN-004", "=COLUMN(A1:C1)", {}, {"array": [[1, 2, 3]]},
  specOpen="Multi-cell reference: dynamic-array {1,2,3} vs legacy implicit intersection.")
c("LK-COLUMN-005", "=COLUMN(B3:D5)", {}, {"array": [[2, 3, 4]]})
c("LK-COLUMN-006", "=COLUMN(3)", {}, err("#VALUE!"),
  specOpen="Non-reference argument error code; confirm.")
c("LK-COLUMN-007", "=COLUMN()", {}, err("#N/A"),
  specOpen="Caller-cell position unavailable in function context; placeholder for the engine gap.")
c("LK-COLUMN-008", "=COLUMN(C3:C3)", {}, {"array": [[3]]})
c("LK-COLUMN-009", "=COLUMNS(A1:C1)+COLUMN(E1)", {}, num(8))
c("LK-COLUMN-010", "=COLUMN(XFD1)", {}, num(16384),
  notes="Rightmost column.")

# ---------- ROWS ----------
c("LK-ROWS-001", "=ROWS(A1:A10)", {}, num(10))
c("LK-ROWS-002", "=ROWS(A1:C10)", {}, num(10))
c("LK-ROWS-003", "=ROWS(A1:E1)", {}, num(1))
c("LK-ROWS-004", "=ROWS(B7)", {}, num(1), notes="Single cell reference.")
c("LK-ROWS-005", "=ROWS(A1:A3)", {"A1": {"error": "#DIV/0!"}}, num(3),
  specOpen="Error cells inside the range do not propagate (shape query); confirm.")
c("LK-ROWS-006", "=ROWS(A1:A100)", {}, num(100), notes="Blank cells count.")
c("LK-ROWS-007", "=ROWS(5)", {}, err("#VALUE!"),
  specOpen="Scalar input behavior: #VALUE! assumed; Excel may differ.")
c("LK-ROWS-008", "=ROWS(1/0)", {}, err("#DIV/0!"))
c("LK-ROWS-009", "=ROWS(ROW(A2:A5))", {}, num(4),
  notes="Array result of another function.")
c("LK-ROWS-010", "=ROWS(C3:F8)", {}, num(6))

# ---------- COLUMNS ----------
c("LK-COLUMNS-001", "=COLUMNS(A1:E1)", {}, num(5))
c("LK-COLUMNS-002", "=COLUMNS(A1:C10)", {}, num(3))
c("LK-COLUMNS-003", "=COLUMNS(A1:A9)", {}, num(1))
c("LK-COLUMNS-004", "=COLUMNS(B7)", {}, num(1))
c("LK-COLUMNS-005", "=COLUMNS(A1:C1)", {"A1": {"error": "#DIV/0!"}}, num(3),
  specOpen="Error cells inside the range do not propagate; confirm.")
c("LK-COLUMNS-006", "=COLUMNS(A1:ZZ1)", {}, num(702))
c("LK-COLUMNS-007", "=COLUMNS(5)", {}, err("#VALUE!"),
  specOpen="Scalar input behavior; confirm.")
c("LK-COLUMNS-008", "=COLUMNS(1/0)", {}, err("#DIV/0!"))
c("LK-COLUMNS-009", "=COLUMNS(COLUMN(A1:C1))", {}, num(3))
c("LK-COLUMNS-010", "=COLUMNS(C3:F8)", {}, num(4))

doc = {
    "formatVersion": 1,
    "generated": "2026-11-23",
    "referenceDefaults": {},
    "cases": cases,
}
with open("tests/fixtures/golden-lookup.json", "w") as f:
    json.dump(doc, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{len(cases)} cases written")
