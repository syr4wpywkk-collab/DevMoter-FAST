import { readFile } from "node:fs/promises";
import ts from "typescript";

/** Load stateless extracted .ts modules in legacy CommonJS-based DOM harnesses. */
export async function loadPureTypeScript(relativePath) {
  const source = await readFile(new URL("../../src/" + relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports = {};
  const noImports = name => { throw new Error("Unexpected runtime dependency in pure module: " + name); };
  new Function("require", "exports", compiled)(noImports, exports);
  return exports;
}
