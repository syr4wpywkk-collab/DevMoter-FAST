import type JSZip from "jszip";
import { loadPptx, readPart, slidePartPaths } from "./internal/zip.js";
import { parseXml, asArray } from "./internal/xml.js";

export interface DeckOutline {
  slideCount: number;
  size?: { wEmu: number; hEmu: number };
  slides: SlideOutline[];
}

export interface SlideOutline {
  index: number;
  texts: { shapeName?: string; text: string }[];
  tables: { rows: string[][] }[];
  images: { partPath: string; contentType: string }[];
  notes?: string;
  placeholders: string[];
  /** Part paths of embedded charts / SmartArt referenced by this slide. */
  graphics: string[];
}

type Node = Record<string, unknown>;

interface Rel {
  id: string;
  type: string;
  target: string;
}

/** Resolve a relationship Target relative to `baseDir` (e.g. "ppt/slides"). */
function resolveTarget(baseDir: string, target: string): string {
  const parts = (baseDir + "/" + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === ".." ) out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

/** Parse a .rels part; returns [] when absent. */
async function readRels(zip: JSZip, relsPath: string): Promise<Rel[]> {
  const f = zip.file(relsPath);
  if (!f) return [];
  const doc = parseXml(await f.async("string"));
  return asArray((doc["Relationships"] as Node | undefined)?.["Relationship"]).map(
    (r) => {
      const n = r as Node;
      return {
        id: String(n["@_Id"] ?? ""),
        type: String(n["@_Type"] ?? ""),
        target: String(n["@_Target"] ?? ""),
      };
    },
  );
}

/** Map part name / file extension -> content type from [Content_Types].xml. */
function contentTypeLookup(doc: Node): { byPart: Map<string, string>; byExt: Map<string, string> } {
  const byPart = new Map<string, string>();
  const byExt = new Map<string, string>();
  const types = doc["Types"] as Node | undefined;
  for (const d of asArray(types?.["Default"])) {
    const n = d as Node;
    byExt.set(String(n["@_Extension"]), String(n["@_ContentType"]));
  }
  for (const o of asArray(types?.["Override"])) {
    const n = o as Node;
    // PartName is stored with a leading slash.
    byPart.set(String(n["@_PartName"]).replace(/^\//, ""), String(n["@_ContentType"]));
  }
  return { byPart, byExt };
}

/** Join all <a:t> runs found anywhere inside `node`, in traversal order. */
function joinRuns(node: unknown): string {
  let out = "";
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(n as Node)) {
      if (key === "a:t") {
        for (const t of asArray(value)) out += String(t ?? "");
      } else {
        walk(value);
      }
    }
  };
  walk(node);
  return out;
}

/** Placeholder type for a shape node ("body" when @type is absent per OOXML). */
function placeholderType(sp: Node): string | undefined {
  const ph = (sp["p:nvSpPr"] as Node | undefined)?.["p:nvPr"] as Node | undefined;
  const phEl = ph?.["p:ph"] as Node | undefined;
  if (!phEl) return undefined;
  return String(phEl["@_type"] ?? "body");
}

async function readSlide(
  zip: JSZip,
  slidePath: string,
  contentTypes: { byPart: Map<string, string>; byExt: Map<string, string> },
  index: number,
): Promise<SlideOutline> {
  const doc = parseXml(await readPart(zip, slidePath));
  const slideDir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const slideName = slidePath.slice(slidePath.lastIndexOf("/") + 1);
  const rels = await readRels(zip, `${slideDir}/_rels/${slideName}.rels`);
  const relById = new Map(rels.map((r) => [r.id, r]));

  const spTree =
    ((doc["p:sld"] as Node | undefined)?.["p:cSld"] as Node | undefined)?.[
      "p:spTree"
    ] as Node | undefined;

  const texts: SlideOutline["texts"] = [];
  const tables: SlideOutline["tables"] = [];
  const images: SlideOutline["images"] = [];
  const placeholders: string[] = [];
  const graphics: string[] = [];

  for (const sp of asArray(spTree?.["p:sp"])) {
    const n = sp as Node;
    const phType = placeholderType(n);
    if (phType !== undefined) placeholders.push(phType);
    const txBody = n["p:txBody"];
    if (txBody === undefined) continue;
    const runs = joinRuns(txBody);
    const cNvPr = (n["p:nvSpPr"] as Node | undefined)?.["p:cNvPr"] as
      | Node
      | undefined;
    const shapeName =
      cNvPr && cNvPr["@_name"] !== undefined ? String(cNvPr["@_name"]) : undefined;
    // Only report shapes that actually contain text runs.
    const hasRun = JSON.stringify(txBody).includes('"a:t"');
    if (hasRun) texts.push(shapeName ? { shapeName, text: runs } : { text: runs });
  }

  for (const gf of asArray(spTree?.["p:graphicFrame"])) {
    const n = gf as Node;
    const graphicData = ((n["a:graphic"] as Node | undefined)?.[
      "a:graphicData"
    ] ?? undefined) as Node | undefined;
    const tbl = graphicData?.["a:tbl"] as Node | undefined;
    if (tbl) {
      const rows: string[][] = asArray(tbl["a:tr"]).map((tr) =>
        asArray((tr as Node)["a:tc"]).map((tc) => joinRuns(tc)),
      );
      tables.push({ rows });
    }
  }

  for (const pic of asArray(spTree?.["p:pic"])) {
    const n = pic as Node;
    const blipFill = n["p:blipFill"] as Node | undefined;
    const blip = asArray(blipFill?.["a:blip"])[0] as Node | undefined;
    const embed = blip?.["@_r:embed"];
    const rel = embed !== undefined ? relById.get(String(embed)) : undefined;
    if (!rel) continue;
    const partPath = resolveTarget(slideDir, rel.target);
    const ext = partPath.split(".").pop() ?? "";
    const contentType =
      contentTypes.byPart.get(partPath) ?? contentTypes.byExt.get(ext) ?? "";
    images.push({ partPath, contentType });
  }

  // Charts / SmartArt / other embedded graphics: report part paths.
  for (const rel of rels) {
    if (/\/(chart|diagram)/.test(rel.type)) {
      graphics.push(resolveTarget(slideDir, rel.target));
    }
  }

  const notesRel = rels.find((r) => r.type.endsWith("/notesSlide"));
  let notes: string | undefined;
  if (notesRel) {
    const notesPath = resolveTarget(slideDir, notesRel.target);
    const notesFile = zip.file(notesPath);
    if (notesFile) {
      const notesDoc = parseXml(await notesFile.async("string"));
      const notesTree =
        ((notesDoc["p:notes"] as Node | undefined)?.["p:cSld"] as
          | Node
          | undefined)?.["p:spTree"] as Node | undefined;
      const chunks: string[] = [];
      for (const sp of asArray(notesTree?.["p:sp"])) {
        const n = sp as Node;
        const phType = placeholderType(n);
        // Keep the notes body and non-placeholder text; skip slide image,
        // date, footer, slide number and header placeholders.
        if (phType !== undefined && phType !== "body") continue;
        const t = joinRuns(n["p:txBody"]);
        if (t) chunks.push(t);
      }
      if (chunks.length) notes = chunks.join("\n");
    }
  }

  const outline: SlideOutline = { index, texts, tables, images, placeholders, graphics };
  if (notes !== undefined) outline.notes = notes;
  return outline;
}

/**
 * Extract a structural outline from .pptx bytes: slide count/size and, per
 * slide, shape texts (runs joined), tables, images, speaker notes,
 * placeholders, and chart/SmartArt part references.
 */
export async function readOutline(data: Uint8Array): Promise<DeckOutline> {
  const zip = await loadPptx(data);
  const contentTypes = contentTypeLookup(
    parseXml(await readPart(zip, "[Content_Types].xml")),
  );

  let size: DeckOutline["size"];
  const presFile = zip.file("ppt/presentation.xml");
  if (presFile) {
    const pres = parseXml(await presFile.async("string"));
    const sldSz = (pres["p:presentation"] as Node | undefined)?.["p:sldSz"] as
      | Node
      | undefined;
    if (sldSz && sldSz["@_cx"] !== undefined && sldSz["@_cy"] !== undefined) {
      size = { wEmu: Number(sldSz["@_cx"]), hEmu: Number(sldSz["@_cy"]) };
    }
  }

  const paths = slidePartPaths(zip);
  const slides: SlideOutline[] = [];
  for (let i = 0; i < paths.length; i++) {
    slides.push(await readSlide(zip, paths[i], contentTypes, i));
  }
  return { slideCount: slides.length, ...(size ? { size } : {}), slides };
}
