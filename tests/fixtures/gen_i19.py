#!/usr/bin/env python3
"""Generate tests/fixtures/golden-i19.json (run from repo root).

Track i19: lookup/reference wave — ADDRESS, AREAS, CHOOSECOLS,
CHOOSEROWS, EXPAND, FORMULATEXT, GROUPBY, HYPERLINK, INDIRECT, OFFSET,
PIVOTBY, SORTBY, TRIMRANGE, WRAPCOLS, WRAPROWS, XMATCH.

GETPIVOTDATA, IMAGE and RTD are skipped per their specs (no pivot
model / not implementable offline) — see the track-i19 PR body.
"""

import json

REF = {
    "implementation": "Microsoft Excel",
    "version": "general documented behavior (not empirically recorded)",
    "dateSystem": "1900",
    "os": "any",
    "locale": "en-US",
    "source": "docs/functions/<NAME>.md worked examples plus the track-i19 unit tests; to be re-recorded empirically per plan section 10.5",
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
boolean = lambda b: {"bool": b}
err = lambda s: {"error": s}
blank = {"blank": True}
arr = lambda rows: {"array": rows}
fml = lambda s: {"formula": s}
E_NA = {"error": "#N/A"}
E_DIV0 = {"error": "#DIV/0!"}
E_REF = {"error": "#REF!"}

# ---------- ADDRESS ----------
c("I19-ADDRESS-001", "=ADDRESS(3,2)", {}, text("$B$3"))
c("I19-ADDRESS-002", "=ADDRESS(3,2,2)", {}, text("B$3"))
c("I19-ADDRESS-003", "=ADDRESS(3,2,3)", {}, text("$B3"))
c("I19-ADDRESS-004", "=ADDRESS(3,2,4)", {}, text("B3"))
c("I19-ADDRESS-005", "=ADDRESS(3,2,1,FALSE)", {}, text("R3C2"))
c(
    "I19-ADDRESS-006",
    "=ADDRESS(3,2,4,FALSE)",
    {},
    text("R[3]C[2]"),
    specOpen="R1C1 relative offsets anchor to the caller cell in Excel; engine assumes row 1 col 1",
)
c("I19-ADDRESS-007", "=ADDRESS(1,1,4,FALSE)", {}, text("R[1]C[1]"))
c("I19-ADDRESS-008", '=ADDRESS(3,2,1,TRUE,"My Sheet")', {}, text("'My Sheet'!$B$3"))
c("I19-ADDRESS-009", '=ADDRESS(3,2,1,TRUE,"Data")', {}, text("Data!$B$3"))
c("I19-ADDRESS-010", "=ADDRESS(0,1)", {}, err("#VALUE!"))
c("I19-ADDRESS-011", "=ADDRESS(1,16385)", {}, err("#VALUE!"))
c("I19-ADDRESS-012", "=ADDRESS(1048577,1)", {}, err("#VALUE!"))
c("I19-ADDRESS-013", "=ADDRESS(1,1,5)", {}, err("#VALUE!"))
c("I19-ADDRESS-014", "=ADDRESS(3.9,2.1)", {}, text("$B$3"))
c("I19-ADDRESS-015", '=ADDRESS("3","2")', {}, text("$B$3"))
c("I19-ADDRESS-016", '=ADDRESS("x",1)', {}, err("#VALUE!"))

# ---------- AREAS ----------
c("I19-AREAS-001", "=AREAS(A1)", {}, num(1))
c("I19-AREAS-002", "=AREAS(B2:D4)", {}, num(1))
c(
    "I19-AREAS-003",
    "=AREAS((B2:D4,E5,F6:I9))",
    {},
    num(3),
    specOpen="multi-area union references are not expressible in the current parser (evaluator error, not a semantic guess)",
)
c("I19-AREAS-004", "=AREAS(OFFSET(A1,1,1,2,2))", {}, num(1))
c("I19-AREAS-005", '=AREAS(INDIRECT("A1:B2"))', {}, num(1))
c("I19-AREAS-006", '=AREAS("A1:B2")', {}, err("#VALUE!"))
c("I19-AREAS-007", "=AREAS(3)", {}, err("#VALUE!"))
c("I19-AREAS-008", "=AREAS(NoSheet!A1)", {}, err("#REF!"))
c("I19-AREAS-009", "=AREAS(#REF!)", {}, err("#REF!"))
c("I19-AREAS-010", "=AREAS(TRUE)", {}, err("#VALUE!"))
c("I19-AREAS-011", "=AREAS({1,2})", {}, err("#VALUE!"))
c("I19-AREAS-012", "=AREAS()", {}, err("#VALUE!"))

# ---------- CHOOSECOLS ----------
c("I19-CHOOSECOLS-001", "=CHOOSECOLS({1,2,3;4,5,6},1,3)", {}, arr([[1, 3], [4, 6]]))
c("I19-CHOOSECOLS-002", "=CHOOSECOLS({1,2,3;4,5,6},-1)", {}, arr([[3], [6]]))
c("I19-CHOOSECOLS-003", "=CHOOSECOLS({1,2,3;4,5,6},3,1,3)", {}, arr([[3, 1, 3], [6, 4, 6]]))
c("I19-CHOOSECOLS-004", "=CHOOSECOLS({1,2,3},4)", {}, err("#VALUE!"))
c("I19-CHOOSECOLS-005", "=CHOOSECOLS({1,2,3},-4)", {}, err("#VALUE!"))
c("I19-CHOOSECOLS-006", "=CHOOSECOLS({1,2,3},0)", {}, err("#VALUE!"))
c("I19-CHOOSECOLS-007", "=CHOOSECOLS(7,1)", {}, arr([[7]]))
c(
    "I19-CHOOSECOLS-008",
    "=CHOOSECOLS(A1:B1,2)",
    {"A1": 1, "B1": 2},
    arr([[2]]),
)
c("I19-CHOOSECOLS-009", "=CHOOSECOLS({1,2;3,#N/A},2)", {}, arr([[2], [E_NA]]))
c("I19-CHOOSECOLS-010", "=CHOOSECOLS({1,2,3},2.9)", {}, arr([[2]]))
c("I19-CHOOSECOLS-011", '=CHOOSECOLS({1,2,3},"2")', {}, arr([[2]]))
c("I19-CHOOSECOLS-012", "=CHOOSECOLS(1/0,1)", {}, err("#DIV/0!"))
c("I19-CHOOSECOLS-013", "=CHOOSECOLS({1,2},#N/A)", {}, err("#N/A"))

# ---------- CHOOSEROWS ----------
c("I19-CHOOSEROWS-001", "=CHOOSEROWS({1,2;3,4;5,6},1,3)", {}, arr([[1, 2], [5, 6]]))
c("I19-CHOOSEROWS-002", "=CHOOSEROWS({1,2;3,4;5,6},-1)", {}, arr([[5, 6]]))
c("I19-CHOOSEROWS-003", "=CHOOSEROWS({1,2;3,4;5,6},3,1)", {}, arr([[5, 6], [1, 2]]))
c("I19-CHOOSEROWS-004", "=CHOOSEROWS({1;2;3},4)", {}, err("#VALUE!"))
c("I19-CHOOSEROWS-005", "=CHOOSEROWS({1;2;3},-4)", {}, err("#VALUE!"))
c("I19-CHOOSEROWS-006", "=CHOOSEROWS({1;2;3},0)", {}, err("#VALUE!"))
c("I19-CHOOSEROWS-007", "=CHOOSEROWS(9,1)", {}, arr([[9]]))
c("I19-CHOOSEROWS-008", "=CHOOSEROWS(9,2)", {}, err("#VALUE!"))
c("I19-CHOOSEROWS-009", "=CHOOSEROWS({1;2;#N/A},3)", {}, arr([[E_NA]]))
c("I19-CHOOSEROWS-010", "=CHOOSEROWS({1;2;3},2.9)", {}, arr([[2]]))
c("I19-CHOOSEROWS-011", "=CHOOSEROWS(1/0,1)", {}, err("#DIV/0!"))
c("I19-CHOOSEROWS-012", "=CHOOSEROWS({1,2,3;4,5,6},2)", {}, arr([[4, 5, 6]]))

# ---------- EXPAND ----------
c(
    "I19-EXPAND-001",
    "=EXPAND({1,2;3,4},4)",
    {},
    arr([[1, 2], [3, 4], [E_NA, E_NA], [E_NA, E_NA]]),
)
c("I19-EXPAND-002", "=EXPAND({1,2;3,4},2,3,0)", {}, arr([[1, 2, 0], [3, 4, 0]]))
c(
    "I19-EXPAND-003",
    '=EXPAND({1,2;3,4},3,3,"x")',
    {},
    arr([[1, 2, "x"], [3, 4, "x"], ["x", "x", "x"]]),
)
c("I19-EXPAND-004", "=EXPAND({1,2;3,4},1)", {}, err("#VALUE!"))
c("I19-EXPAND-005", "=EXPAND({1,2;3,4},2,1)", {}, err("#VALUE!"))
c("I19-EXPAND-006", "=EXPAND({1,2;3,4},2,2)", {}, arr([[1, 2], [3, 4]]))
c("I19-EXPAND-007", "=EXPAND({1,2,3;4,5,6},3)", {}, arr([[1, 2, 3], [4, 5, 6], [E_NA, E_NA, E_NA]]))
c("I19-EXPAND-008", '=EXPAND({1},"x")', {}, err("#VALUE!"))
c("I19-EXPAND-009", "=EXPAND(7,2,2,0)", {}, arr([[7, 0], [0, 0]]))
c("I19-EXPAND-010", "=EXPAND(1/0,2)", {}, err("#DIV/0!"))
c("I19-EXPAND-011", "=EXPAND({1},1,2,#DIV/0!)", {}, arr([[1, E_DIV0]]))

# ---------- FORMULATEXT ----------
c(
    "I19-FORMULATEXT-001",
    "=FORMULATEXT(B2)",
    {"B2": fml("=A1*2")},
    text("=A1*2"),
)
c("I19-FORMULATEXT-002", "=FORMULATEXT(B2)", {"B2": 42}, err("#N/A"))
c("I19-FORMULATEXT-003", "=FORMULATEXT(A1)", {}, err("#N/A"))
c(
    "I19-FORMULATEXT-004",
    "=FORMULATEXT(B2:B3)",
    {"B2": fml("=1+1"), "B3": fml("=2")},
    text("=1+1"),
    specOpen="range argument returns the top-left cell's text (spec open question)",
)
c("I19-FORMULATEXT-005", '=FORMULATEXT("=1+1")', {}, err("#VALUE!"))
c("I19-FORMULATEXT-006", "=FORMULATEXT(5)", {}, err("#VALUE!"))
c("I19-FORMULATEXT-007", "=FORMULATEXT(1/0)", {}, err("#DIV/0!"))
c(
    "I19-FORMULATEXT-008",
    '=FORMULATEXT(INDIRECT("C3"))',
    {"C3": fml("=99")},
    text("=99"),
)
c(
    "I19-FORMULATEXT-009",
    "=FORMULATEXT(B1)",
    {"B1": fml("=  SUM( A1 , 2 )")},
    text("=  SUM( A1 , 2 )"),
)
c("I19-FORMULATEXT-010", "=FORMULATEXT()", {}, err("#VALUE!"))
c("I19-FORMULATEXT-011", "=FORMULATEXT(A1,A2)", {}, err("#VALUE!"))

# ---------- GROUPBY ----------
c(
    "I19-GROUPBY-001",
    '=GROUPBY({"a";"b";"a"},{1;2;3},"SUM")',
    {},
    arr([["a", 4], ["b", 2]]),
)
c(
    "I19-GROUPBY-002",
    '=GROUPBY({"a";"b";"a"},{1;2;3},"AVERAGE",0,1)',
    {},
    arr([["a", 2], ["b", 2], ["Grand Total", 2]]),
    specOpen='grand-total row label "Grand Total" is localized in real Excel; engine fixes a canonical string',
)
c(
    "I19-GROUPBY-003",
    '=GROUPBY({"x";"y"},{10;20},"MAX",0,0,-2)',
    {},
    arr([["y", 20], ["x", 10]]),
)
c(
    "I19-GROUPBY-004",
    '=GROUPBY({"a";"b"},{1;2},"SUM",0,0,0,{TRUE;FALSE})',
    {},
    arr([["a", 1]]),
)
c(
    "I19-GROUPBY-005",
    '=GROUPBY({"a";"a"},{1,10;2,20},"SUM")',
    {},
    arr([["a", 3, 30]]),
)
c(
    "I19-GROUPBY-006",
    '=GROUPBY({"a","x";"a","y";"b","x"},{1;2;3},"SUM")',
    {},
    arr([["a", "x", 1], ["a", "y", 2], ["b", "x", 3]]),
)
c(
    "I19-GROUPBY-007",
    '=GROUPBY({"k";"a";"b"},{"v";1;2},"SUM",3)',
    {},
    arr([["k", "SUM of v"], ["a", 1], ["b", 2]]),
    specOpen='generated header text "SUM of v" is an engine-chosen canonical string',
)
c(
    "I19-GROUPBY-008",
    '=GROUPBY({"a";"b"},{1;2},"SUM",0,-1)',
    {},
    arr([["Grand Total", 3], ["a", 1], ["b", 2]]),
    specOpen='grand-total row label "Grand Total" is an engine-chosen canonical string',
)
c("I19-GROUPBY-009", '=GROUPBY({"a";"b"},{1;2;3},"SUM")', {}, err("#VALUE!"))
c(
    "I19-GROUPBY-010",
    '=GROUPBY({"a";"b"},{1;2},"SUM",0,0,0,{TRUE})',
    {},
    err("#VALUE!"),
)
c("I19-GROUPBY-011", '=GROUPBY({"a"},{1},"NOPE")', {}, err("#VALUE!"))
c("I19-GROUPBY-012", '=GROUPBY({"a"},{1},"SUM",4)', {}, err("#VALUE!"))
c("I19-GROUPBY-013", '=GROUPBY({"a"},{1},"SUM",0,3)', {}, err("#VALUE!"))
c(
    "I19-GROUPBY-014",
    '=GROUPBY({"a";"b"},{#DIV/0!;2},"SUM")',
    {},
    arr([["a", E_DIV0], ["b", 2]]),
)
c(
    "I19-GROUPBY-015",
    '=GROUPBY({"a";"b";"a"},{1;2;3},LAMBDA(x,SUM(x)*10))',
    {},
    arr([["a", 40], ["b", 20]]),
)

# ---------- HYPERLINK ----------
c(
    "I19-HYPERLINK-001",
    '=HYPERLINK("https://example.com","Example")',
    {},
    text("Example"),
)
c(
    "I19-HYPERLINK-002",
    '=HYPERLINK("https://example.com")',
    {},
    text("https://example.com"),
)
c("I19-HYPERLINK-003", "=HYPERLINK(\"#'Sheet 2'!B5\",\"Go\")", {}, text("Go"))
c("I19-HYPERLINK-004", '=HYPERLINK("https://example.com",42)', {}, num(42))
c("I19-HYPERLINK-005", '=HYPERLINK("https://example.com",TRUE)', {}, boolean(True))
c("I19-HYPERLINK-006", '=HYPERLINK("https://x",1/0)', {}, err("#DIV/0!"))
c("I19-HYPERLINK-007", '=HYPERLINK("https://x",#N/A)', {}, err("#N/A"))
c("I19-HYPERLINK-008", "=HYPERLINK(1/0)", {}, err("#DIV/0!"))
c("I19-HYPERLINK-009", "=HYPERLINK(42)", {}, text("42"))
c("I19-HYPERLINK-010", '=HYPERLINK("https://x","")', {}, text(""))
c("I19-HYPERLINK-011", "=HYPERLINK()", {}, err("#VALUE!"))

# ---------- INDIRECT ----------
c("I19-INDIRECT-001", '=INDIRECT("B2")', {"B2": 10}, num(10))
c("I19-INDIRECT-002", '=INDIRECT(A1&"2")', {"A1": "B", "B2": 10}, num(10))
c("I19-INDIRECT-003", '=INDIRECT("$B$2")', {"B2": 5}, num(5))
c("I19-INDIRECT-004", '=SUM(INDIRECT("A1:A3"))', {"A1": 1, "A2": 2, "A3": 3}, num(6))
c("I19-INDIRECT-005", '=INDIRECT("R1C1",FALSE)', {"A1": 4}, num(4))
c("I19-INDIRECT-006", '=INDIRECT("ZZZ999")', {}, err("#REF!"))
c("I19-INDIRECT-007", '=INDIRECT("A0")', {}, err("#REF!"))
c("I19-INDIRECT-008", '=INDIRECT("NoSheet!A1")', {}, err("#REF!"))
c("I19-INDIRECT-009", "=INDIRECT(5)", {}, err("#REF!"))
c("I19-INDIRECT-010", '=INDIRECT("A1","x")', {}, err("#VALUE!"))
c("I19-INDIRECT-011", "=INDIRECT(1/0)", {}, err("#DIV/0!"))
c("I19-INDIRECT-012", "=INDIRECT()", {}, err("#VALUE!"))

# ---------- OFFSET ----------
c("I19-OFFSET-001", "=OFFSET(A1,1,1)", {"B2": 10}, num(10))
c("I19-OFFSET-002", "=OFFSET(B2,-1,-1)", {"A1": 7}, num(7))
c("I19-OFFSET-003", "=SUM(OFFSET(A1,0,0,3,1))", {"A1": 1, "A2": 2, "A3": 3}, num(6))
c(
    "I19-OFFSET-004",
    "=SUM(OFFSET(A1:B2,1,1))",
    {"B2": 1, "C2": 2, "B3": 3, "C3": 4},
    num(10),
)
c(
    "I19-OFFSET-005",
    "=OFFSET(A1,0,0,2,2)",
    {"A1": 1, "B1": 2, "A2": 3, "B2": 4},
    arr([[1, 2], [3, 4]]),
)
c("I19-OFFSET-006", "=OFFSET(A1,-1,0)", {}, err("#REF!"))
c("I19-OFFSET-007", "=OFFSET(A1,0,-1)", {}, err("#REF!"))
c("I19-OFFSET-008", "=OFFSET(XFD1048576,1,0)", {}, err("#REF!"))
c("I19-OFFSET-009", "=OFFSET(A1,0,0,0,1)", {}, err("#REF!"))
c(
    "I19-OFFSET-010",
    "=SUM(OFFSET(A3,0,0,-2,1))",
    {"A1": 1, "A2": 2, "A3": 3},
    num(5),
)
c("I19-OFFSET-011", "=OFFSET(5,0,0)", {}, err("#VALUE!"))
c("I19-OFFSET-012", "=OFFSET(A1,1.9,1.9)", {"B2": 10}, num(10))
c("I19-OFFSET-013", "=OFFSET(A1,1/0,0)", {}, err("#DIV/0!"))
c("I19-OFFSET-014", "=OFFSET(A1,0)", {}, err("#VALUE!"))

# ---------- PIVOTBY ----------
c(
    "I19-PIVOTBY-001",
    '=PIVOTBY({"a";"a";"b";"b"},{"x";"y";"x";"y"},{1;2;3;4},"SUM")',
    {},
    arr([[blank, "x", "y"], ["a", 1, 2], ["b", 3, 4]]),
    specOpen="exact header row/column placement is open in the spec; engine emits one header row + one key column",
)
c(
    "I19-PIVOTBY-002",
    '=PIVOTBY({"a";"b"},{"x";"y"},{5;7},"SUM")',
    {},
    arr([[blank, "x", "y"], ["a", 5, blank], ["b", blank, 7]]),
    specOpen="missing intersections surface as blank cells (spec open)",
)
c(
    "I19-PIVOTBY-003",
    '=PIVOTBY({"a";"a"},{"x";"x"},{1;2},"AVERAGE")',
    {},
    arr([["", "x"], ["a", 1.5]]),
)
c(
    "I19-PIVOTBY-004",
    '=PIVOTBY({"a";"b"},{"x";"x"},{1;2},"SUM",0,0,0,0,0,{FALSE;TRUE})',
    {},
    arr([["", "x"], ["b", 2]]),
)
c(
    "I19-PIVOTBY-005",
    '=PIVOTBY({"a";"b"},{"x";"y"},{1;2},"SUM",0,1,0,1)',
    {},
    arr(
        [
            [blank, "x", "y", "Grand Total"],
            ["a", 1, blank, 1],
            ["b", blank, 2, 2],
            ["Grand Total", 1, 2, 3],
        ]
    ),
    specOpen='grand-total label "Grand Total" and blank missing intersections are engine-chosen',
)
c(
    "I19-PIVOTBY-006",
    '=PIVOTBY({"a";"b"},{"x";"x"},{1;2},"SUM",0,0,-1)',
    {},
    arr([["", "x"], ["b", 2], ["a", 1]]),
)
c(
    "I19-PIVOTBY-007",
    '=PIVOTBY({"a";"a"},{"x","p";"x","q"},{1;2},"SUM")',
    {},
    arr([[blank, "x", "x"], [blank, "p", "q"], ["a", 1, 2]]),
    specOpen="two header rows for two-column col_fields (layout open in spec)",
)
c(
    "I19-PIVOTBY-008",
    '=PIVOTBY({"a";"a"},{"x";"x"},{1;2},LAMBDA(x,MAX(x)))',
    {},
    arr([["", "x"], ["a", 2]]),
)
c("I19-PIVOTBY-009", '=PIVOTBY({"a";"b"},{"x"},{1;2},"SUM")', {}, err("#VALUE!"))
c("I19-PIVOTBY-010", '=PIVOTBY({"a"},{"x"},{1},"SUM",4)', {}, err("#VALUE!"))
c("I19-PIVOTBY-011", '=PIVOTBY({"a"},{"x"},{1},"NOPE")', {}, err("#VALUE!"))
c("I19-PIVOTBY-012", '=PIVOTBY(1/0,{1},{1},"SUM")', {}, err("#DIV/0!"))
c("I19-PIVOTBY-013", '=PIVOTBY({"a"},{"x"},{1})', {}, err("#VALUE!"))

# ---------- SORTBY ----------
c("I19-SORTBY-001", "=SORTBY({3,1;1,2;2,3},{3;1;2})", {}, arr([[1, 2], [2, 3], [3, 1]]))
c("I19-SORTBY-002", '=SORTBY({"b",1;"a",2},{"b";"a"})', {}, arr([["a", 2], ["b", 1]]))
c(
    "I19-SORTBY-003",
    "=SORTBY({1,5;2,6},{2;1},-1)",
    {},
    arr([[1, 5], [2, 6]]),
    specOpen="SORTBY.md's worked example {2,6;1,5} contradicts the spec's own -1=descending semantics; engine sorts descending",
)
c("I19-SORTBY-004", "=SORTBY({1;2;3},{2;1;2},1,{9;8;7},-1)", {}, arr([[2], [1], [3]]))
c("I19-SORTBY-005", "=SORTBY({1,2;3,4},{2,1})", {}, arr([[2, 1], [4, 3]]))
c("I19-SORTBY-006", "=SORTBY({1,2;3,4},{1;2;3})", {}, err("#VALUE!"))
c("I19-SORTBY-007", "=SORTBY({1,2;3,4},{1,2,3})", {}, err("#VALUE!"))
c("I19-SORTBY-008", "=SORTBY({1;2},{2;1},0)", {}, err("#VALUE!"))
c("I19-SORTBY-009", "=SORTBY({1;2},{2;1},2)", {}, err("#VALUE!"))
c("I19-SORTBY-010", "=SORTBY({2;1},{2;1})", {}, arr([[1], [2]]))
c("I19-SORTBY-011", "=SORTBY(1/0,{1})", {}, err("#DIV/0!"))
c(
    "I19-SORTBY-012",
    "=SORTBY({1;2;3},B1:B3)",
    {"B1": 2, "B3": 1},
    arr([[3], [1], [2]]),
    specOpen="blank ordering in sort keys is open in the spec; engine puts blank keys last ascending (Excel SORT parity)",
)
c("I19-SORTBY-013", "=SORTBY({1})", {}, err("#VALUE!"))

# ---------- TRIMRANGE ----------
c(
    "I19-TRIMRANGE-001",
    "=TRIMRANGE(A1:C5)",
    {"B2": 1, "C2": 2, "B3": 3, "C3": 4},
    arr([[1, 2], [3, 4]]),
)
c(
    "I19-TRIMRANGE-002",
    "=TRIMRANGE(A1:C5,2,0)",
    {"B2": 1, "C2": 2, "B3": 3, "C3": 4},
    arr([[blank, blank, blank], [blank, 1, 2], [blank, 3, 4]]),
)
c(
    "I19-TRIMRANGE-003",
    "=TRIMRANGE(A1:C5,1,0)",
    {"B2": 1, "C2": 2, "B3": 3, "C3": 4},
    arr(
        [
            [blank, 1, 2],
            [blank, 3, 4],
            [blank, blank, blank],
            [blank, blank, blank],
        ]
    ),
)
c("I19-TRIMRANGE-004", "=TRIMRANGE({0,0;0,5})", {}, arr([[0, 0], [0, 5]]))
c(
    "I19-TRIMRANGE-005",
    "=SUM(TRIMRANGE(A1:C5))",
    {"B2": 1, "C2": 2, "B3": 3, "C3": 4},
    num(10),
)
c("I19-TRIMRANGE-006", "=TRIMRANGE(A1:B2)", {}, blank)
c(
    "I19-TRIMRANGE-007",
    '=TRIMRANGE({"","","x",""})',
    {},
    arr([["", "", "x", ""]]),
    specOpen='whether "" cells count as non-empty is open in the spec; engine treats them as non-empty',
)
c("I19-TRIMRANGE-008", "=TRIMRANGE({1},4)", {}, err("#VALUE!"))
c("I19-TRIMRANGE-009", "=TRIMRANGE({1},0,4)", {}, err("#VALUE!"))
c("I19-TRIMRANGE-010", "=TRIMRANGE({1},-1)", {}, err("#VALUE!"))
c("I19-TRIMRANGE-011", "=TRIMRANGE(5)", {}, num(5))
c("I19-TRIMRANGE-012", "=TRIMRANGE(1/0)", {}, err("#DIV/0!"))
c("I19-TRIMRANGE-013", "=TRIMRANGE()", {}, err("#VALUE!"))

# ---------- WRAPCOLS ----------
c(
    "I19-WRAPCOLS-001",
    "=WRAPCOLS({1,2,3,4,5},2)",
    {},
    arr([[1, 3, 5], [2, 4, E_NA]]),
)
c("I19-WRAPCOLS-002", "=WRAPCOLS({1;2;3;4;5;6},3)", {}, arr([[1, 4], [2, 5], [3, 6]]))
c("I19-WRAPCOLS-003", "=WRAPCOLS({1,2,3,4,5},2,0)", {}, arr([[1, 3, 5], [2, 4, 0]]))
c("I19-WRAPCOLS-004", "=WRAPCOLS({1,2},0)", {}, err("#VALUE!"))
c("I19-WRAPCOLS-005", "=WRAPCOLS({1,2},-1)", {}, err("#VALUE!"))
c("I19-WRAPCOLS-006", "=WRAPCOLS({1,2;3,4},2)", {}, err("#VALUE!"))
c("I19-WRAPCOLS-007", "=WRAPCOLS({1,2},5,0)", {}, arr([[1], [2], [0], [0], [0]]))
c("I19-WRAPCOLS-008", "=WRAPCOLS({1,2,3,4},2.9)", {}, arr([[1, 3], [2, 4]]))
c("I19-WRAPCOLS-009", '=WRAPCOLS({1,2},"x")', {}, err("#VALUE!"))
c("I19-WRAPCOLS-010", "=WRAPCOLS(1/0,2)", {}, err("#DIV/0!"))
c("I19-WRAPCOLS-011", "=WRAPCOLS({1},1/0)", {}, err("#DIV/0!"))
c("I19-WRAPCOLS-012", "=WRAPCOLS({1})", {}, err("#VALUE!"))

# ---------- WRAPROWS ----------
c(
    "I19-WRAPROWS-001",
    "=WRAPROWS({1,2,3,4,5},2)",
    {},
    arr([[1, 2], [3, 4], [5, E_NA]]),
)
c("I19-WRAPROWS-002", "=WRAPROWS({1;2;3;4;5;6},3)", {}, arr([[1, 2, 3], [4, 5, 6]]))
c("I19-WRAPROWS-003", "=WRAPROWS({1,2,3,4,5},2,0)", {}, arr([[1, 2], [3, 4], [5, 0]]))
c("I19-WRAPROWS-004", "=WRAPROWS({1,2},0)", {}, err("#VALUE!"))
c("I19-WRAPROWS-005", "=WRAPROWS({1,2},-1)", {}, err("#VALUE!"))
c("I19-WRAPROWS-006", "=WRAPROWS({1,2;3,4},2)", {}, err("#VALUE!"))
c("I19-WRAPROWS-007", "=WRAPROWS({1,2},5,0)", {}, arr([[1, 2, 0, 0, 0]]))
c("I19-WRAPROWS-008", "=WRAPROWS({1,2,3,4},2.9)", {}, arr([[1, 2], [3, 4]]))
c("I19-WRAPROWS-009", '=WRAPROWS({1,2,3},2,"-")', {}, arr([[1, 2], [3, "-"]]))
c("I19-WRAPROWS-010", "=WRAPROWS(1/0,2)", {}, err("#DIV/0!"))
c("I19-WRAPROWS-011", "=WRAPROWS({1},1/0)", {}, err("#DIV/0!"))
c("I19-WRAPROWS-012", "=WRAPROWS({1})", {}, err("#VALUE!"))

# ---------- XMATCH ----------
c("I19-XMATCH-001", '=XMATCH("b",{"a","b","c"})', {}, num(2))
c("I19-XMATCH-002", '=XMATCH("B",{"a","b","c"})', {}, num(2))
c("I19-XMATCH-003", "=XMATCH(4,{1,3,5,7},1)", {}, num(3))
c("I19-XMATCH-004", "=XMATCH(4,{1,3,5,7},-1)", {}, num(2))
c("I19-XMATCH-005", "=XMATCH(9,{1,3,5},-1)", {}, num(3))
c("I19-XMATCH-006", "=XMATCH(9,{1,3,5},1)", {}, err("#N/A"))
c("I19-XMATCH-007", "=XMATCH(0,{1,3,5},-1)", {}, err("#N/A"))
c("I19-XMATCH-008", '=XMATCH("b*",{"apple","banana"},2)', {}, num(2))
c("I19-XMATCH-009", '=XMATCH("a?ple",{"apple","banana"},2)', {}, num(1))
c("I19-XMATCH-010", '=XMATCH("b",{"a","b","b"},,-1)', {}, num(3))
c("I19-XMATCH-011", '=XMATCH("b",{"a","b","b"},,1)', {}, num(2))
c("I19-XMATCH-012", "=XMATCH(5,{1,3,5,7},0,2)", {}, num(3))
c("I19-XMATCH-013", "=XMATCH(5,{7,5,3,1},0,-2)", {}, num(2))
c("I19-XMATCH-014", '=XMATCH("z",{"a","b"})', {}, err("#N/A"))
c("I19-XMATCH-015", "=XMATCH(1,{1},3)", {}, err("#VALUE!"))
c("I19-XMATCH-016", "=XMATCH(1,{1},0,0)", {}, err("#VALUE!"))
c("I19-XMATCH-017", "=XMATCH(1,{1,2;3,4})", {}, err("#N/A"))
c("I19-XMATCH-018", "=XMATCH(3,{1;3;5})", {}, num(2))
c("I19-XMATCH-019", '=XMATCH("5",{3,5,7})', {}, err("#N/A"))
c("I19-XMATCH-020", "=XMATCH(1/0,{1})", {}, err("#DIV/0!"))

doc = {
    "formatVersion": 1,
    "generated": "2026-11-24",
    "referenceDefaults": {"reference": REF},
    "cases": cases,
}

with open("tests/fixtures/golden-i19.json", "w") as fh:
    json.dump(doc, fh, indent=2, ensure_ascii=False)
    fh.write("\n")

print(f"wrote {len(cases)} cases")
