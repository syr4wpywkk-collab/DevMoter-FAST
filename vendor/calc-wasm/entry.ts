// Entry for the generated server/office/calc-engine.mjs bundle: embeds the
// vendored wasm-bindgen output and instantiates it synchronously from the
// inlined bytes, so Node never touches the filesystem or network for wasm.
import * as glue from "./pkg/calc-wasm.js";
import wasmBytes from "./pkg/calc-wasm_bg.wasm";

let loaded: typeof glue | null = null;

/** Instantiate the vendored WASM engine once and return its bindings. */
export function loadCalcEngine(): typeof glue {
  if (!loaded) {
    glue.initSync({ module: wasmBytes } as never);
    loaded = glue;
  }
  return loaded;
}
