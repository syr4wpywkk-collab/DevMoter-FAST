use wasm_bindgen::prelude::*;

/// Smoke-level binding: proves the WASM boundary builds and loads.
/// The batch API (`setCells` / `getValues`) lands in a later PR.
#[wasm_bindgen]
pub fn engine_name() -> String {
    calc_core::engine_name().to_owned()
}
