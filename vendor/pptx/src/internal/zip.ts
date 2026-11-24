import JSZip from "jszip";

/** Load a .pptx (zip) archive from bytes. Shared by the read/edit layers. */
export async function loadPptx(data: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(data);
}

/** Serialize an archive back to .pptx bytes. */
export async function savePptx(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Read one XML part as text; throws if the part is missing. */
export async function readPart(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`missing part: ${path}`);
  return f.async("string");
}

/** List slide part paths (ppt/slides/slideN.xml) in numeric order. */
export function slidePartPaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
}
