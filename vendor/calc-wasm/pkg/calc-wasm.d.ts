/* tslint:disable */
/* eslint-disable */

/**
 * Workbook wrapper exposed to JavaScript.
 *
 * ```js
 * const wb = new WasmWorkbook();           // one sheet: "Sheet1"
 * wb.setCell("Sheet1", "A1", "42");
 * wb.setCell("Sheet1", "A2", "=A1*2");
 * wb.recalculate();
 * wb.getValue("Sheet1", "A2");             // { kind: "number", value: 84 }
 * ```
 */
export class WasmWorkbook {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a sheet; fails on duplicate or invalid names.
     */
    addSheet(name: string): void;
    /**
     * Clear a cell's contents (back to blank), marking dependents dirty.
     */
    clearCell(sheet: string, address: string): void;
    /**
     * Evaluate a formula against the current sheet without storing it
     * in a cell. `formula` may be given with or without the leading `=`.
     */
    evalFormula(sheet: string, formula: string): any;
    /**
     * Current computed value of a cell (recalculates first if needed)
     * as a JSON-compatible [`CellValue`] structure.
     */
    getValue(sheet: string, address: string): any;
    /**
     * Is this formula cell awaiting (re)evaluation?
     */
    isDirty(sheet: string, address: string): boolean;
    /**
     * Create a workbook containing a single `Sheet1` with the standard
     * function registry installed.
     */
    constructor();
    /**
     * Recompute every dirty formula cell in dependency order. Returns
     * `{evaluated: string[], cycleCells: string[], steps: number}` with
     * A1 cell addresses.
     */
    recalculate(): any;
    /**
     * Store a typed literal: number, boolean, string, or `null`/
     * `undefined` to clear the cell. Non-finite numbers (NaN/±Infinity)
     * are rejected.
     */
    setCellValue(sheet: string, address: string, value: any): void;
    /**
     * Store typed input: a leading `=` marks a formula, anything else is
     * stored as literal text (the UI-typing convention). A formula that
     * fails to parse is rejected and the cell is left unchanged.
     * Use `setCellValue` for typed literal values.
     */
    setCell(sheet: string, address: string, input: string): void;
    /**
     * Reseed the workbook's RNG (used by `RAND`/`RANDBETWEEN` at the
     * next recalculation) for reproducible runs.
     */
    setRngSeed(seed: number): void;
    /**
     * Names of all sheets, in creation order.
     */
    sheetNames(): string[];
}

/**
 * Smoke-level binding: proves the WASM boundary builds and loads.
 */
export function engine_name(): string;

/**
 * Names of all registered worksheet functions, sorted ascending.
 */
export function functionNames(): string[];

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmworkbook_free: (a: number, b: number) => void;
    readonly engine_name: () => [number, number];
    readonly functionNames: () => [number, number];
    readonly wasmworkbook_addSheet: (a: number, b: number, c: number) => [number, number];
    readonly wasmworkbook_clearCell: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmworkbook_evalFormula: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmworkbook_getValue: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmworkbook_isDirty: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly wasmworkbook_new: () => number;
    readonly wasmworkbook_recalculate: (a: number) => [number, number, number];
    readonly wasmworkbook_setCell: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmworkbook_setCellValue: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number];
    readonly wasmworkbook_setRngSeed: (a: number, b: number) => void;
    readonly wasmworkbook_sheetNames: (a: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
