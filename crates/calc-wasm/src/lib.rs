//! WASM bindings for calc-core + calc-functions (v2 plan §7, PR14).
//!
//! [`WasmWorkbook`] owns a [`CalcEngine`] with the standard function
//! registry installed and exposes a small, typed JS surface: set cell
//! input (literal or formula), read computed values, recalculate, and
//! list function names. Values cross the boundary as JSON-compatible
//! structures ([`CellValue`]): a `kind` tag plus payload, with
//! spreadsheet errors carried as their `#…` code strings.
//!
//! Values are serialized through `serde-wasm-bindgen` with the
//! JSON-compatible serializer, so structs and internally-tagged enums
//! arrive in JS as plain objects — matching `ts/calc-wasm.d.ts`.

use calc_core::workbook::CellInput;
use calc_core::{CalcEngine, CellId, Clock, EngineError, SplitMix64, Value};
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

/// The JSON-compatible serializer: maps/struct fields and enum tags are
/// emitted as plain JS object properties, matching the .d.ts contract.
const JSON: Serializer = Serializer::json_compatible();

/// JSON-compatible cell value exchanged across the WASM boundary.
///
/// Serialized as `{ "kind": "…", … }`:
/// - `{kind:"blank"}` — empty cell
/// - `{kind:"number","value":<f64>}`
/// - `{kind:"text","value":<string>}`
/// - `{kind:"boolean","value":<bool>}`
/// - `{kind:"error","code":"<#… literal>"}` — spreadsheet errors as codes
/// - `{kind:"array","rows":n,"cols":m,"values":[[CellValue]]}` — row-major
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CellValue {
    Blank,
    Number {
        value: f64,
    },
    Text {
        value: String,
    },
    Boolean {
        value: bool,
    },
    Error {
        code: String,
    },
    Array {
        rows: u32,
        cols: u32,
        values: Vec<Vec<CellValue>>,
    },
}

/// Untagged scalar accepted by `setCellValue`: a JS number, boolean,
/// string, or `null`/`undefined` (which clears the cell). Formulas are
/// never accepted here — use `setCell` with a leading `=`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
enum ScalarInput {
    Boolean(bool),
    Number(f64),
    Text(String),
}

/// JSON view of [`calc_core::RecalcReport`]: cell addresses in A1
/// notation, `evaluated` in evaluation order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecalcReportJs {
    evaluated: Vec<String>,
    cycle_cells: Vec<String>,
    steps: usize,
}

fn value_to_cell(v: &Value) -> CellValue {
    match v {
        Value::Blank => CellValue::Blank,
        Value::Number(n) => CellValue::Number { value: *n },
        Value::Text(s) => CellValue::Text { value: s.clone() },
        Value::Boolean(b) => CellValue::Boolean { value: *b },
        Value::Error(e) => CellValue::Error {
            code: e.code().to_owned(),
        },
        Value::Array(a) => CellValue::Array {
            rows: a.rows(),
            cols: a.cols(),
            values: (0..a.rows())
                .map(|r| {
                    (0..a.cols())
                        .map(|c| value_to_cell(a.get(r, c).unwrap_or(&Value::Blank)))
                        .collect()
                })
                .collect(),
        },
        // Lambdas become #VALUE! at the cell boundary; stay defensive in
        // case one is observed through a future engine path.
        Value::Lambda(_) => CellValue::Error {
            code: calc_core::CalcError::Value.code().to_owned(),
        },
        // References are dereferenced by the evaluator before reaching a
        // cell boundary; same defensive handling as lambdas.
        Value::Reference(_) => CellValue::Error {
            code: calc_core::CalcError::Value.code().to_owned(),
        },
    }
}

fn cell_ids_a1(ids: &[CellId]) -> Vec<String> {
    ids.iter().map(CellId::to_a1).collect()
}

fn build_engine() -> CalcEngine {
    let mut engine = CalcEngine::new();
    engine.set_registry(Box::new(calc_functions::default_registry()));
    engine.set_clock(platform_clock());
    engine
        .add_sheet("Sheet1")
        .expect("fresh engine accepts Sheet1");
    engine
}

/// `std::time::SystemTime` is not implemented on wasm32-unknown-unknown,
/// so volatile functions (`TODAY`/`NOW`) read the JS clock there.
#[cfg(target_arch = "wasm32")]
fn platform_clock() -> Box<dyn Clock> {
    struct JsClock;
    impl Clock for JsClock {
        fn unix_seconds(&self) -> i64 {
            (js_sys::Date::new_0().get_time() / 1000.0) as i64
        }
    }
    Box::new(JsClock)
}

#[cfg(not(target_arch = "wasm32"))]
fn platform_clock() -> Box<dyn Clock> {
    Box::new(calc_core::SystemClock)
}

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&JSON).map_err(|e| JsError::new(&e.to_string()))
}

/// Workbook wrapper exposed to JavaScript.
///
/// ```js
/// const wb = new WasmWorkbook();           // one sheet: "Sheet1"
/// wb.setCell("Sheet1", "A1", "42");
/// wb.setCell("Sheet1", "A2", "=A1*2");
/// wb.recalculate();
/// wb.getValue("Sheet1", "A2");             // { kind: "number", value: 84 }
/// ```
#[wasm_bindgen]
pub struct WasmWorkbook {
    engine: CalcEngine,
}

#[wasm_bindgen]
impl WasmWorkbook {
    /// Create a workbook containing a single `Sheet1` with the standard
    /// function registry installed.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmWorkbook {
        WasmWorkbook {
            engine: build_engine(),
        }
    }

    /// Add a sheet; fails on duplicate or invalid names.
    #[wasm_bindgen(js_name = addSheet)]
    pub fn add_sheet(&mut self, name: &str) -> Result<(), JsError> {
        self.engine.add_sheet(name).map(|_| ()).map_err(engine_err)
    }

    /// Names of all sheets, in creation order.
    #[wasm_bindgen(js_name = sheetNames)]
    pub fn sheet_names(&self) -> Vec<String> {
        self.engine
            .workbook()
            .sheets()
            .iter()
            .map(|s| s.name().to_owned())
            .collect()
    }

    /// Store typed input: a leading `=` marks a formula, anything else is
    /// stored as literal text (the UI-typing convention). A formula that
    /// fails to parse is rejected and the cell is left unchanged.
    /// Use `setCellValue` for typed literal values.
    #[wasm_bindgen(js_name = setCell)]
    pub fn set_cell(&mut self, sheet: &str, address: &str, input: &str) -> Result<(), JsError> {
        self.engine
            .set_cell(sheet, address, CellInput::from_typed(input))
            .map_err(engine_err)
    }

    /// Store a typed literal: number, boolean, string, or `null`/
    /// `undefined` to clear the cell. Non-finite numbers (NaN/±Infinity)
    /// are rejected.
    #[wasm_bindgen(js_name = setCellValue)]
    pub fn set_cell_value(
        &mut self,
        sheet: &str,
        address: &str,
        value: JsValue,
    ) -> Result<(), JsError> {
        let scalar: Option<ScalarInput> =
            serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&e.to_string()))?;
        match scalar {
            None => self.clear_cell(sheet, address),
            Some(ScalarInput::Boolean(b)) => self.put(sheet, address, Value::Boolean(b)),
            Some(ScalarInput::Number(n)) if n.is_finite() => {
                self.put(sheet, address, Value::Number(n))
            }
            Some(ScalarInput::Number(_)) => Err(JsError::new("cell value must be a finite number")),
            Some(ScalarInput::Text(s)) => self.put(sheet, address, Value::Text(s)),
        }
    }

    fn put(&mut self, sheet: &str, address: &str, v: Value) -> Result<(), JsError> {
        self.engine
            .set_cell(sheet, address, CellInput::Value(v))
            .map_err(engine_err)
    }

    /// Clear a cell's contents (back to blank), marking dependents dirty.
    #[wasm_bindgen(js_name = clearCell)]
    pub fn clear_cell(&mut self, sheet: &str, address: &str) -> Result<(), JsError> {
        self.engine.clear_cell(sheet, address).map_err(engine_err)
    }

    /// Current computed value of a cell (recalculates first if needed)
    /// as a JSON-compatible [`CellValue`] structure.
    #[wasm_bindgen(js_name = getValue)]
    pub fn get_value(&mut self, sheet: &str, address: &str) -> Result<JsValue, JsError> {
        let v = self.engine.get_value(sheet, address).map_err(engine_err)?;
        to_js(&value_to_cell(&v))
    }

    /// Evaluate a formula against the current sheet without storing it
    /// in a cell. `formula` may be given with or without the leading `=`.
    #[wasm_bindgen(js_name = evalFormula)]
    pub fn eval_formula(&mut self, sheet: &str, formula: &str) -> Result<JsValue, JsError> {
        let text = formula.strip_prefix('=').unwrap_or(formula);
        let v = self.engine.eval_formula(sheet, text).map_err(engine_err)?;
        to_js(&value_to_cell(&v))
    }

    /// Is this formula cell awaiting (re)evaluation?
    #[wasm_bindgen(js_name = isDirty)]
    pub fn is_dirty(&self, sheet: &str, address: &str) -> bool {
        self.engine.is_dirty(sheet, address)
    }

    /// Recompute every dirty formula cell in dependency order. Returns
    /// `{evaluated: string[], cycleCells: string[], steps: number}` with
    /// A1 cell addresses.
    #[wasm_bindgen(js_name = recalculate)]
    pub fn recalculate(&mut self) -> Result<JsValue, JsError> {
        let r = self.engine.recalculate().map_err(engine_err)?;
        to_js(&RecalcReportJs {
            evaluated: cell_ids_a1(&r.evaluated),
            cycle_cells: cell_ids_a1(&r.cycle_cells),
            steps: r.steps,
        })
    }

    /// Reseed the workbook's RNG (used by `RAND`/`RANDBETWEEN` at the
    /// next recalculation) for reproducible runs.
    #[wasm_bindgen(js_name = setRngSeed)]
    pub fn set_rng_seed(&mut self, seed: u32) {
        self.engine
            .set_rng(Box::new(SplitMix64::new(u64::from(seed))));
    }
}

impl Default for WasmWorkbook {
    fn default() -> Self {
        Self::new()
    }
}

/// Names of all registered worksheet functions, sorted ascending.
#[wasm_bindgen(js_name = functionNames)]
pub fn function_names() -> Vec<String> {
    let mut names: Vec<String> = calc_functions::registered_names()
        .map(str::to_owned)
        .collect();
    names.sort_unstable();
    names
}

fn engine_err(e: EngineError) -> JsError {
    JsError::new(&e.to_string())
}

/// Smoke-level binding: proves the WASM boundary builds and loads.
#[wasm_bindgen]
pub fn engine_name() -> String {
    calc_core::engine_name().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell_value(v: &Value) -> CellValue {
        value_to_cell(v)
    }

    #[test]
    fn converts_scalar_values() {
        assert_eq!(cell_value(&Value::Blank), CellValue::Blank);
        assert_eq!(
            cell_value(&Value::Number(2.5)),
            CellValue::Number { value: 2.5 }
        );
        assert_eq!(
            cell_value(&Value::Text("x".into())),
            CellValue::Text { value: "x".into() }
        );
        assert_eq!(
            cell_value(&Value::Boolean(true)),
            CellValue::Boolean { value: true }
        );
    }

    #[test]
    fn converts_errors_to_codes() {
        for e in calc_core::CalcError::ALL {
            let CellValue::Error { code } = cell_value(&Value::Error(e)) else {
                panic!("error variant expected");
            };
            assert_eq!(code, e.code());
        }
    }

    #[test]
    fn converts_arrays_row_major() {
        let a = calc_core::ArrayValue::new(
            2,
            2,
            vec![
                Value::Number(1.0),
                Value::Number(2.0),
                Value::Text("b".into()),
                Value::Blank,
            ],
        )
        .unwrap();
        assert_eq!(
            cell_value(&Value::Array(a)),
            CellValue::Array {
                rows: 2,
                cols: 2,
                values: vec![
                    vec![
                        CellValue::Number { value: 1.0 },
                        CellValue::Number { value: 2.0 }
                    ],
                    vec![CellValue::Text { value: "b".into() }, CellValue::Blank],
                ],
            }
        );
    }

    #[test]
    fn cell_value_serializes_as_tagged_json() {
        let v =
            serde_json::to_value(cell_value(&Value::Error(calc_core::CalcError::DivZero))).unwrap();
        assert_eq!(v, serde_json::json!({"kind": "error", "code": "#DIV/0!"}));
        let v = serde_json::to_value(CellValue::Number { value: 3.0 }).unwrap();
        assert_eq!(v, serde_json::json!({"kind": "number", "value": 3.0}));
    }

    #[test]
    fn scalar_input_deserializes_primitives() {
        let s: ScalarInput = serde_json::from_str("2.5").unwrap();
        assert_eq!(s, ScalarInput::Number(2.5));
        let s: ScalarInput = serde_json::from_str("true").unwrap();
        assert_eq!(s, ScalarInput::Boolean(true));
        let s: ScalarInput = serde_json::from_str("\"hi\"").unwrap();
        assert_eq!(s, ScalarInput::Text("hi".into()));
        let s: Option<ScalarInput> = serde_json::from_str("null").unwrap();
        assert_eq!(s, None);
    }

    #[test]
    fn workbook_set_and_get_roundtrip() {
        let mut wb = WasmWorkbook::new();
        wb.set_cell("Sheet1", "A1", "42").unwrap();
        wb.set_cell("Sheet1", "A2", "=A1*2").unwrap();
        wb.engine.recalculate().unwrap();
        let v = wb.engine.get_value("Sheet1", "A2").unwrap();
        assert_eq!(
            cell_value(&v),
            CellValue::Number { value: 84.0 },
            "typed '42' is text; A1*2 coerces text to number"
        );
    }

    #[test]
    fn workbook_typed_values_and_functions() {
        let mut wb = WasmWorkbook::new();
        wb.put("Sheet1", "A1", Value::Number(6.0)).unwrap();
        wb.put("Sheet1", "A2", Value::Number(7.0)).unwrap();
        wb.set_cell("Sheet1", "A3", "=SUM(A1:A2)").unwrap();
        let v = wb.engine.get_value("Sheet1", "A3").unwrap();
        assert_eq!(cell_value(&v), CellValue::Number { value: 13.0 });
    }

    #[test]
    fn unknown_sheet_and_bad_address_error() {
        let mut wb = WasmWorkbook::new();
        // JsError construction is a wasm extern; exercise the engine
        // error paths that feed it on the host.
        assert!(
            wb.engine
                .set_cell("Nope", "A1", CellInput::from_typed("1"))
                .is_err()
        );
        assert!(
            wb.engine
                .set_cell("Sheet1", "ZZZ99999", CellInput::from_typed("1"))
                .is_err()
        );
        assert!(wb.engine.get_value("Nope", "A1").is_err());
    }

    #[test]
    fn bad_formula_rejected() {
        let mut wb = WasmWorkbook::new();
        wb.engine
            .set_cell("Sheet1", "A1", CellInput::from_typed("=1+"))
            .unwrap_err();
        // Rejected input leaves the cell untouched.
        wb.engine.recalculate().unwrap();
        let v = wb.engine.get_value("Sheet1", "A1").unwrap();
        assert_eq!(cell_value(&v), CellValue::Blank);
    }

    #[test]
    fn cell_error_surfaces_as_code() {
        let mut wb = WasmWorkbook::new();
        wb.set_cell("Sheet1", "A1", "=1/0").unwrap();
        let v = wb.engine.get_value("Sheet1", "A1").unwrap();
        assert_eq!(
            cell_value(&v),
            CellValue::Error {
                code: "#DIV/0!".into()
            }
        );
    }

    #[test]
    fn circular_reference_reports_cycle_cells() {
        let mut wb = WasmWorkbook::new();
        wb.set_cell("Sheet1", "A1", "=B1").unwrap();
        wb.set_cell("Sheet1", "B1", "=A1").unwrap();
        let r = wb.engine.recalculate().unwrap();
        assert_eq!(cell_ids_a1(&r.cycle_cells).len(), 2);
    }

    #[test]
    fn recalc_report_shape() {
        let mut wb = WasmWorkbook::new();
        wb.set_cell("Sheet1", "A1", "=1+1").unwrap();
        let r = wb.engine.recalculate().unwrap();
        let js = RecalcReportJs {
            evaluated: cell_ids_a1(&r.evaluated),
            cycle_cells: cell_ids_a1(&r.cycle_cells),
            steps: r.steps,
        };
        let v = serde_json::to_value(&js).unwrap();
        assert_eq!(v["evaluated"], serde_json::json!(["A1"]));
        assert_eq!(v["cycleCells"], serde_json::json!([]));
        assert!(v["steps"].as_u64().unwrap() > 0);
    }

    #[test]
    fn function_names_sorted_and_nonempty() {
        let names = function_names();
        assert_eq!(names.len(), 336);
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
        assert!(names.contains(&"SUM".to_owned()));
        assert!(names.contains(&"REDUCE".to_owned()));
    }

    #[test]
    fn clear_and_dirty_tracking() {
        let mut wb = WasmWorkbook::new();
        wb.set_cell("Sheet1", "A1", "=1+1").unwrap();
        assert!(wb.is_dirty("Sheet1", "A1"));
        wb.engine.recalculate().unwrap();
        assert!(!wb.is_dirty("Sheet1", "A1"));
        wb.clear_cell("Sheet1", "A1").unwrap();
        let v = wb.engine.get_value("Sheet1", "A1").unwrap();
        assert_eq!(cell_value(&v), CellValue::Blank);
    }
}
