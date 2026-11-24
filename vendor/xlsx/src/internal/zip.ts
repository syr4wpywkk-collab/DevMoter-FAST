import JSZip from "jszip";

/** Load a .xlsx (zip) archive from bytes. */
export async function loadXlsx(data: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(data);
}

/** Serialize an archive back to .xlsx bytes. */
export async function saveXlsx(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Read one XML part as text; throws if the part is missing. */
export async function readPart(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`missing part: ${path}`);
  return f.async("string");
}

/** Resolve a relationship Target relative to `baseDir` (e.g. "xl"); leading "/" = package-absolute. */
export function resolveTarget(baseDir: string, target: string): string {
  const parts = (target.startsWith("/") ? target : `${baseDir}/${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}
