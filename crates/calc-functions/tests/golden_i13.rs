//! Golden-fixture runner (plan §10.2/§10.5): loads
//! `fixtures/golden-i13.json` and runs every case with
//! `specOpen: false` through parse + eval on `Sheet1`, asserting the
//! expected value/error. `specOpen` cases are skipped, not guessed.
//!
//! Mirrors `calc-core/tests/golden_phase1.rs`; lives in calc-functions so
//! new function categories can add their own golden file without touching
//! calc-core. calc-functions has no external dependencies either, so this
//! file carries the same small JSON reader.

use calc_core::{CalcEngine, CalcError, CellInput, Value};

const FIXTURE: &str = include_str!("fixtures/golden-i13.json");

// ---------- minimal JSON reader ----------

#[derive(Debug, Clone, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn as_str(&self) -> &str {
        match self {
            Json::Str(s) => s,
            _ => panic!("expected string, got {self:?}"),
        }
    }
    fn as_num(&self) -> f64 {
        match self {
            Json::Num(n) => *n,
            _ => panic!("expected number, got {self:?}"),
        }
    }
    fn as_bool(&self) -> bool {
        match self {
            Json::Bool(b) => *b,
            _ => panic!("expected bool, got {self:?}"),
        }
    }
}

fn parse_json(s: &str) -> Json {
    let mut p = JsonParser {
        b: s.as_bytes(),
        i: 0,
    };
    p.ws();
    let v = p.value();
    p.ws();
    assert_eq!(p.i, p.b.len(), "trailing JSON input");
    v
}

struct JsonParser<'a> {
    b: &'a [u8],
    i: usize,
}

impl JsonParser<'_> {
    fn ws(&mut self) {
        while matches!(self.b.get(self.i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn value(&mut self) -> Json {
        self.ws();
        match *self.b.get(self.i).unwrap_or(&0) {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => Json::Str(self.string()),
            b't' => self.lit("true", Json::Bool(true)),
            b'f' => self.lit("false", Json::Bool(false)),
            b'n' => self.lit("null", Json::Null),
            _ => self.number(),
        }
    }

    fn lit(&mut self, word: &str, v: Json) -> Json {
        assert!(
            self.b[self.i..].starts_with(word.as_bytes()),
            "bad literal at {}",
            self.i
        );
        self.i += word.len();
        v
    }

    fn number(&mut self) -> Json {
        let start = self.i;
        while matches!(
            self.b.get(self.i),
            Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
        ) {
            self.i += 1;
        }
        let s = std::str::from_utf8(&self.b[start..self.i]).unwrap();
        Json::Num(s.parse().unwrap_or_else(|_| panic!("bad number {s:?}")))
    }

    fn string(&mut self) -> String {
        assert_eq!(self.b[self.i], b'"');
        self.i += 1;
        let mut out = String::new();
        loop {
            match self.b[self.i] {
                b'"' => {
                    self.i += 1;
                    return out;
                }
                b'\\' => {
                    self.i += 1;
                    match self.b[self.i] {
                        b'n' => out.push('\n'),
                        b't' => out.push('\t'),
                        b'r' => out.push('\r'),
                        b'u' => {
                            let hex = std::str::from_utf8(&self.b[self.i + 1..self.i + 5]).unwrap();
                            let cp = u32::from_str_radix(hex, 16).unwrap();
                            out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
                            self.i += 4;
                        }
                        c => out.push(c as char),
                    }
                    self.i += 1;
                }
                _ => {
                    // Consume one UTF-8 char.
                    let s = std::str::from_utf8(&self.b[self.i..]).unwrap();
                    let c = s.chars().next().unwrap();
                    out.push(c);
                    self.i += c.len_utf8();
                }
            }
        }
    }

    fn array(&mut self) -> Json {
        self.i += 1;
        let mut out = Vec::new();
        self.ws();
        if self.b.get(self.i) == Some(&b']') {
            self.i += 1;
            return Json::Arr(out);
        }
        loop {
            out.push(self.value());
            self.ws();
            match self.b[self.i] {
                b',' => self.i += 1,
                b']' => {
                    self.i += 1;
                    return Json::Arr(out);
                }
                c => panic!("expected ',' or ']', got {:?}", c as char),
            }
        }
    }

    fn object(&mut self) -> Json {
        self.i += 1;
        let mut out = Vec::new();
        self.ws();
        if self.b.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Json::Obj(out);
        }
        loop {
            self.ws();
            let k = self.string();
            self.ws();
            assert_eq!(self.b[self.i], b':', "expected ':' at {}", self.i);
            self.i += 1;
            let v = self.value();
            out.push((k, v));
            self.ws();
            match self.b[self.i] {
                b',' => self.i += 1,
                b'}' => {
                    self.i += 1;
                    return Json::Obj(out);
                }
                c => panic!("expected ',' or '}}', got {:?}", c as char),
            }
        }
    }
}

// ---------- fixture runner ----------

fn json_to_input(v: &Json) -> Value {
    match v {
        Json::Num(n) => Value::Number(*n),
        Json::Str(s) => Value::Text(s.clone()),
        Json::Bool(b) => Value::Boolean(*b),
        Json::Obj(_) if v.get("blank") == Some(&Json::Bool(true)) => Value::Blank,
        Json::Obj(_) if v.get("error").is_some() => {
            Value::Error(CalcError::from_code(v.get("error").unwrap().as_str()).unwrap())
        }
        other => panic!("unsupported input {other:?}"),
    }
}

fn expected_matches(expected: &Json, actual: &Value) -> bool {
    if let Some(n) = expected.get("number") {
        let tol = expected.get("tolerance").map(Json::as_num).unwrap_or(0.0);
        return matches!(actual, Value::Number(a) if (a - n.as_num()).abs() <= tol.max(1e-9));
    }
    if let Some(t) = expected.get("text") {
        return matches!(actual, Value::Text(s) if s == t.as_str());
    }
    if let Some(b) = expected.get("bool") {
        return matches!(actual, Value::Boolean(a) if *a == b.as_bool());
    }
    if let Some(e) = expected.get("error") {
        return matches!(actual, Value::Error(a) if a.code() == e.as_str());
    }
    if let Some(Json::Bool(true)) = expected.get("blank") {
        return matches!(actual, Value::Blank);
    }
    if let Some(Json::Arr(rows)) = expected.get("array") {
        let Value::Array(a) = actual else {
            return false;
        };
        if a.rows() as usize != rows.len() {
            return false;
        }
        for (r, row) in rows.iter().enumerate() {
            let Json::Arr(cols) = row else {
                return false;
            };
            if a.cols() as usize != cols.len() {
                return false;
            }
            for (c, cell) in cols.iter().enumerate() {
                let want = match cell {
                    Json::Num(n) => Value::Number(*n),
                    Json::Str(s) => Value::Text(s.clone()),
                    Json::Bool(b) => Value::Boolean(*b),
                    Json::Obj(_) if cell.get("blank") == Some(&Json::Bool(true)) => Value::Blank,
                    Json::Obj(_) => Value::Error(
                        CalcError::from_code(cell.get("error").unwrap().as_str()).unwrap(),
                    ),
                    _ => return false,
                };
                if a.get(r as u32, c as u32) != Some(&want) {
                    return false;
                }
            }
        }
        return true;
    }
    panic!("unrecognized expected {expected:?}");
}

#[test]
fn golden_i13_non_specopen_cases() {
    let doc = parse_json(FIXTURE);
    let Json::Arr(cases) = doc.get("cases").unwrap() else {
        panic!("cases is not an array");
    };

    let mut run = 0usize;
    let mut skipped = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for case in cases {
        let id = case.get("id").unwrap().as_str();
        if case.get("specOpen") == Some(&Json::Bool(true)) {
            skipped += 1;
            continue;
        }
        run += 1;

        let mut engine = CalcEngine::new();
        engine.set_registry(Box::new(calc_functions::default_registry()));
        engine.add_sheet("Sheet1").unwrap();
        if let Some(Json::Obj(inputs)) = case.get("inputs") {
            for (addr, v) in inputs {
                let value = json_to_input(v);
                if value.is_blank() {
                    continue; // explicitly blank: leave the cell unset
                }
                engine
                    .set_cell("Sheet1", addr, CellInput::Value(value))
                    .unwrap_or_else(|e| panic!("{id}: set_cell {addr}: {e}"));
            }
        }
        let formula = case.get("formula").unwrap().as_str();
        let actual = match engine.eval_formula("Sheet1", formula) {
            Ok(v) => v,
            Err(e) => {
                failures.push(format!("{id}: {formula} -> engine error {e}"));
                continue;
            }
        };
        let expected = case.get("expected").unwrap();
        if !expected_matches(expected, &actual) {
            failures.push(format!(
                "{id}: {formula} -> {actual:?}, expected {expected:?}"
            ));
        }
    }

    eprintln!(
        "golden-i13: {run} non-specOpen cases, {skipped} specOpen skipped, \
         {} passed",
        run - failures.len(),
    );
    assert!(
        failures.is_empty(),
        "{} fixture failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
