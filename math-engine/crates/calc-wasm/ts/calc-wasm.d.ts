/**
 * TypeScript definitions for the `calc-wasm` package (v2 plan §7 API).
 *
 * Build the crate with `wasm-pack build` (or `wasm-bindgen` CLI) and use
 * these declarations alongside the generated JS glue; the exported
 * surface below is hand-written to match `src/lib.rs` exactly.
 *
 * Method failures (unknown sheet, bad address, formula parse errors)
 * throw a JS `Error`. Spreadsheet-level failures (`#DIV/0!`, `#N/A`, …)
 * never throw — they are returned as `{kind: "error", code}` values.
 */

/** JSON-compatible cell value returned by `getValue` / `evalFormula`. */
export type CellValue =
  | { kind: "blank" }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "error"; code: CalcErrorCode }
  | { kind: "array"; rows: number; cols: number; values: CellValue[][] };

/** Excel-style error literals produced by the engine. */
export type CalcErrorCode =
  | "#DIV/0!"
  | "#VALUE!"
  | "#REF!"
  | "#NAME?"
  | "#NUM!"
  | "#N/A"
  | "#NULL!"
  | "#SPILL!"
  | "#CALC!"
  | "#CIRC!";

/** Literal accepted by `setCellValue`; `null`/`undefined` clears the cell. */
export type ScalarInput = number | boolean | string | null | undefined;

/** Result of `recalculate()`. Cell addresses are A1 notation. */
export interface RecalcReport {
  /** Formula cells (re)evaluated, in evaluation order. */
  evaluated: string[];
  /** Cells found inside a dependency cycle (assigned `#CIRC!`). */
  cycleCells: string[];
  /** Evaluation steps consumed. */
  steps: number;
}

/** Spreadsheet workbook backed by the Rust engine. */
export declare class WasmWorkbook {
  /** Create a workbook containing a single `Sheet1`. */
  constructor();

  /** Add a sheet; throws on duplicate or invalid names. */
  addSheet(name: string): void;

  /** Names of all sheets, in creation order. */
  sheetNames(): string[];

  /**
   * Store input as typed into a cell: a leading `=` marks a formula,
   * `'` forces text, `TRUE`/`FALSE` and number text (`42`, `-1.5`, `5%`)
   * are typed values, `""` clears the cell, anything else is text. A
   * formula that fails to parse throws and leaves the cell unchanged.
   */
  setCell(sheet: string, address: string, input: string): void;

  /**
   * Store a typed literal (number, boolean, string); `null` clears the
   * cell. Throws for non-finite numbers (NaN/±Infinity).
   */
  setCellValue(sheet: string, address: string, value: ScalarInput): void;

  /** Clear a cell's contents (back to blank). */
  clearCell(sheet: string, address: string): void;

  /**
   * Current computed value of a cell as a JSON-compatible structure.
   * Recalculates dirty cells first.
   */
  getValue(sheet: string, address: string): CellValue;

  /**
   * Evaluate a formula against the current sheet without storing it.
   * The formula may be given with or without the leading `=`.
   */
  evalFormula(sheet: string, formula: string): CellValue;

  /** Is this formula cell awaiting (re)evaluation? */
  isDirty(sheet: string, address: string): boolean;

  /** Recompute every dirty formula cell in dependency order. */
  recalculate(): RecalcReport;

  /**
   * Reseed the workbook's RNG (used by `RAND`/`RANDBETWEEN` at the next
   * recalculation) for reproducible runs.
   */
  setRngSeed(seed: number): void;

  /** Free the workbook's WASM memory. */
  free(): void;
}

/** Names of all registered worksheet functions, sorted ascending. */
export declare function functionNames(): string[];

/** Name of the underlying engine crate (`"calc-core"`). */
export declare function engineName(): string;
