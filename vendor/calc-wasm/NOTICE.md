Spreadsheet calc engine vendored from rust-math-engine (crates/calc-wasm)
https://github.com/syr4wpywkk-collab/rust-math-engine, now math-engine/ in this repository
Commit: ced52cb (main, wasm-pack build --target web)
Copyright DevMoter Calc Engine contributors. Proprietary (see LICENSE).

The Rust sources live in math-engine/ (math-engine/crates/calc-wasm); only the compiled WASM
artifact and its wasm-bindgen JS glue are vendored here under pkg/
(calc-wasm.js, calc-wasm_bg.wasm, calc-wasm.d.ts). wasm-opt was disabled
(no binaryen download); the artifact is the unoptimized release build.

Rebuild from math-engine/, matching its toolchain (math-engine/rust-toolchain.toml):

    rustup target add wasm32-unknown-unknown
    cargo build -p calc-wasm --release --target wasm32-unknown-unknown
    wasm-bindgen --target web --out-name calc-wasm \
      --out-dir pkg target/wasm32-unknown-unknown/release/calc_wasm.wasm

server/office/calc.mjs consumes the generated server/office/calc-engine.mjs
bundle (scripts/build-calc-engine.mjs) which embeds the WASM bytes and the
hand-written loadCalcEngine() entry — no network or filesystem load at
runtime.
