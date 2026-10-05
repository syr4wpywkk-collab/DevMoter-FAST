// Generated from pinned Apache-2.0 GenOffice sources. See vendor/genoffice/NOTICE.md.

// vendor/genoffice/docx/lazy-media.ts
var LAZY_MEDIA_SCHEME = "genoffice-docx-media";
var MAGIC = "GENOFFICE-LAZY-MEDIA\n";
var HASH_RE = /^[0-9a-f]{64}$/;
var LAZY_MEDIA_PLACEHOLDER_BYTES = MAGIC.length + 64 + 1;
function lazyMediaHashOf(bytes) {
  if (bytes.length !== LAZY_MEDIA_PLACEHOLDER_BYTES) return null;
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith(MAGIC) || !text.endsWith("\n")) return null;
  const hash = text.slice(MAGIC.length, MAGIC.length + 64);
  return HASH_RE.test(hash) ? hash : null;
}
function lazyMediaUrl(hash, partPath) {
  if (!HASH_RE.test(hash)) throw new Error(`lazy media: not a sha256 hex: ${hash}`);
  return `${LAZY_MEDIA_SCHEME}://${hash}/${partPath.split("/").map(encodeURIComponent).join("/")}`;
}

// vendor/genoffice/custgeom.ts
var TAG_RE = /<\/?(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
var NAME_RE = /^<\/?\s*([A-Za-z_][\w:.-]*)/;
var ATTR_RE = /([\w:]+)\s*=\s*"([^"]*)"/g;
function tagAttrs(tag2) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while (m = ATTR_RE.exec(tag2)) out[m[1]] = m[2];
  return out;
}
var DEG = Math.PI / 180;
var a2r = (v) => v / 6e4 * DEG;
function evalGuides(gds, w, h) {
  const ss = Math.min(w, h);
  const env = {
    w,
    h,
    ss,
    ls: Math.max(w, h),
    hc: w / 2,
    vc: h / 2,
    l: 0,
    t: 0,
    r: w,
    b: h,
    wd2: w / 2,
    wd3: w / 3,
    wd4: w / 4,
    wd5: w / 5,
    wd6: w / 6,
    wd8: w / 8,
    wd10: w / 10,
    wd12: w / 12,
    wd32: w / 32,
    hd2: h / 2,
    hd3: h / 3,
    hd4: h / 4,
    hd5: h / 5,
    hd6: h / 6,
    hd8: h / 8,
    hd10: h / 10,
    hd12: h / 12,
    ssd2: ss / 2,
    ssd4: ss / 4,
    ssd6: ss / 6,
    ssd8: ss / 8,
    ssd16: ss / 16,
    ssd32: ss / 32,
    cd2: 108e5,
    cd4: 54e5,
    cd8: 27e5,
    "3cd4": 162e5,
    "3cd8": 81e5,
    "5cd8": 135e5,
    "7cd8": 189e5
  };
  const val2 = (tok) => {
    if (tok == null) return 0;
    const n = Number(tok);
    return Number.isFinite(n) ? n : env[tok] ?? 0;
  };
  for (const gd of gds) {
    const parts = gd.fmla.trim().split(/\s+/);
    const op = parts[0];
    const x = val2(parts[1]);
    const y = val2(parts[2]);
    const z = val2(parts[3]);
    let out;
    switch (op) {
      case "val":
        out = x;
        break;
      case "*/":
        out = z === 0 ? 0 : x * y / z;
        break;
      case "+-":
        out = x + y - z;
        break;
      case "+/":
        out = z === 0 ? 0 : (x + y) / z;
        break;
      case "?:":
        out = x > 0 ? y : z;
        break;
      case "abs":
        out = Math.abs(x);
        break;
      case "min":
        out = Math.min(x, y);
        break;
      case "max":
        out = Math.max(x, y);
        break;
      case "pin":
        out = Math.min(Math.max(y, x), z);
        break;
      case "mod":
        out = Math.sqrt(x * x + y * y + z * z);
        break;
      case "sqrt":
        out = Math.sqrt(Math.max(x, 0));
        break;
      case "at2":
        out = Math.atan2(y, x) / DEG * 6e4;
        break;
      case "cat2":
        out = x * Math.cos(Math.atan2(z, y));
        break;
      case "sat2":
        out = x * Math.sin(Math.atan2(z, y));
        break;
      case "cos":
        out = x * Math.cos(a2r(y));
        break;
      case "sin":
        out = x * Math.sin(a2r(y));
        break;
      case "tan":
        out = x * Math.tan(a2r(y));
        break;
      default:
        out = 0;
    }
    env[gd.name] = out;
  }
  return env;
}
var CMD_PT_COUNT = {
  "a:moveTo": 1,
  "a:lnTo": 1,
  "a:quadBezTo": 2,
  "a:cubicBezTo": 3
};
var CMD_LETTER = {
  "a:moveTo": "M",
  "a:lnTo": "L",
  "a:quadBezTo": "Q",
  "a:cubicBezTo": "C"
};
function parseCustGeom(shapeXml, shapeW, shapeH) {
  const start = shapeXml.indexOf("<a:custGeom");
  if (start < 0) return void 0;
  const end = shapeXml.indexOf("</a:custGeom>", start);
  if (end < 0) return void 0;
  const xml = shapeXml.slice(start, end);
  const gds = [];
  const paths = [];
  let inGuides = false;
  let cur = null;
  let pending = null;
  TAG_RE.lastIndex = 0;
  let m;
  while (m = TAG_RE.exec(xml)) {
    const tag2 = m[0];
    if (tag2.startsWith("<!--") || tag2.startsWith("<![") || tag2.startsWith("<?")) continue;
    const closing = tag2.startsWith("</");
    const name = NAME_RE.exec(tag2)?.[1] ?? "";
    if (closing) {
      if (name === "a:avLst" || name === "a:gdLst") inGuides = false;
      else if (name === "a:path" && cur) {
        paths.push(cur);
        cur = null;
        pending = null;
      }
      continue;
    }
    const self = tag2.endsWith("/>");
    switch (name) {
      case "a:avLst":
      case "a:gdLst":
        if (!self) inGuides = true;
        break;
      case "a:gd": {
        if (!inGuides) break;
        const a = tagAttrs(tag2);
        if (a.name && a.fmla) gds.push({ name: a.name, fmla: a.fmla });
        break;
      }
      case "a:path": {
        const a = tagAttrs(tag2);
        cur = {
          w: a.w ? Number(a.w) || 0 : void 0,
          h: a.h ? Number(a.h) || 0 : void 0,
          fill: a.fill,
          stroke: a.stroke,
          cmds: []
        };
        if (self) {
          paths.push(cur);
          cur = null;
        }
        break;
      }
      case "a:moveTo":
      case "a:lnTo":
      case "a:quadBezTo":
      case "a:cubicBezTo":
        if (cur) pending = { c: CMD_LETTER[name], need: CMD_PT_COUNT[name], pts: [] };
        break;
      case "a:pt": {
        if (!cur || !pending) break;
        const a = tagAttrs(tag2);
        pending.pts.push([a.x ?? "0", a.y ?? "0"]);
        if (pending.pts.length >= pending.need) {
          cur.cmds.push({ c: pending.c, pts: pending.pts });
          pending = null;
        }
        break;
      }
      case "a:arcTo": {
        if (!cur) break;
        const a = tagAttrs(tag2);
        cur.cmds.push({
          c: "A",
          arc: { wR: a.wR ?? "0", hR: a.hR ?? "0", stAng: a.stAng ?? "0", swAng: a.swAng ?? "0" }
        });
        break;
      }
      case "a:close":
        if (cur) cur.cmds.push({ c: "Z" });
        break;
    }
  }
  const env = evalGuides(gds, shapeW, shapeH);
  const resolve = (tok) => {
    const n = Number(tok);
    return Number.isFinite(n) ? n : env[tok] ?? 0;
  };
  const absList = paths.map((p) => toAbsCmds(p, resolve));
  let fw = 0;
  let fh = 0;
  paths.forEach((p, i) => {
    if (!p.w) fw = Math.max(fw, maxCoord(absList[i], 0));
    if (!p.h) fh = Math.max(fh, maxCoord(absList[i], 1));
  });
  const buckets = { path: [], fillPath: [], strokePath: [] };
  paths.forEach((p, i) => {
    const abs = absList[i];
    if (!abs.length) return;
    const vw = p.w || shapeW || fw || 1;
    const vh = p.h || shapeH || fh || 1;
    const d = emitNorm(abs, vw, vh);
    if (!d) return;
    const fillNone = p.fill === "none";
    const strokeNone = p.stroke === "0" || p.stroke === "false" || p.stroke === "none";
    if (fillNone && strokeNone) return;
    if (fillNone) buckets.strokePath.push(d);
    else if (strokeNone) buckets.fillPath.push(d);
    else buckets.path.push(d);
  });
  const out = {};
  if (buckets.path.length) out.path = buckets.path.join(" ");
  if (buckets.fillPath.length) out.fillPath = buckets.fillPath.join(" ");
  if (buckets.strokePath.length) out.strokePath = buckets.strokePath.join(" ");
  return out.path || out.fillPath || out.strokePath ? out : void 0;
}
function paramAngle(a, wR, hR) {
  if (wR === hR || !wR || !hR) return a;
  const t = Math.atan2(Math.sin(a) * wR, Math.cos(a) * hR);
  return t + 2 * Math.PI * Math.round((a - t) / (2 * Math.PI));
}
function toAbsCmds(p, resolve) {
  const out = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const cmd of p.cmds) {
    if (cmd.c === "Z") {
      out.push({ c: "Z", xy: [] });
      cx = sx;
      cy = sy;
      continue;
    }
    if (cmd.c === "A") {
      const wR = resolve(cmd.arc.wR);
      const hR = resolve(cmd.arc.hR);
      const stRay = a2r(resolve(cmd.arc.stAng));
      const swRay = a2r(resolve(cmd.arc.swAng));
      if (swRay === 0) continue;
      const st = paramAngle(stRay, wR, hR);
      let sw = paramAngle(stRay + swRay, wR, hR) - st;
      sw += 2 * Math.PI * Math.round((swRay - sw) / (2 * Math.PI));
      const fullTurn = 2 * Math.PI;
      if (Math.abs(sw) > fullTurn) {
        sw = Math.sign(sw) * (fullTurn + Math.abs(sw) % fullTurn);
      }
      const ecx = cx - wR * Math.cos(st);
      const ecy = cy - hR * Math.sin(st);
      const segs = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2)));
      const da = sw / segs;
      const k = 4 / 3 * Math.tan(da / 4);
      for (let i = 0; i < segs; i++) {
        const a1 = st + i * da;
        const a2 = a1 + da;
        const x1 = ecx + wR * Math.cos(a1);
        const y1 = ecy + hR * Math.sin(a1);
        const x2 = ecx + wR * Math.cos(a2);
        const y2 = ecy + hR * Math.sin(a2);
        out.push({
          c: "C",
          xy: [
            x1 - k * wR * Math.sin(a1),
            y1 + k * hR * Math.cos(a1),
            x2 + k * wR * Math.sin(a2),
            y2 - k * hR * Math.cos(a2),
            x2,
            y2
          ]
        });
        cx = x2;
        cy = y2;
      }
      continue;
    }
    const xy = [];
    for (const [xs, ys] of cmd.pts) {
      xy.push(resolve(xs), resolve(ys));
    }
    out.push({ c: cmd.c, xy });
    if (cmd.c === "M") {
      sx = xy[0];
      sy = xy[1];
    }
    cx = xy[xy.length - 2];
    cy = xy[xy.length - 1];
  }
  return out;
}
function maxCoord(cmds, axis) {
  let mx = 0;
  for (const c of cmds) for (let i = axis; i < c.xy.length; i += 2) mx = Math.max(mx, c.xy[i]);
  return mx;
}
function emitNorm(cmds, vw, vh) {
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const parts = [];
  for (const c of cmds) {
    parts.push(c.c);
    for (let i = 0; i < c.xy.length; i += 2) {
      parts.push(String(r5(c.xy[i] / vw)), String(r5(c.xy[i + 1] / vh)));
    }
  }
  return parts.length ? parts.join(" ") : "";
}

// vendor/genoffice/docx/chart.ts
import JSZip from "jszip";

// vendor/genoffice/docx/xml-utils.ts
import { XMLParser } from "fast-xml-parser";
var parserOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false
};
var xmlParser = new XMLParser(parserOptions);
var deepXmlParser = new XMLParser({ ...parserOptions, maxNestedTags: 1e5 });
function nameOf(node) {
  return Object.keys(node).find((k) => k !== ":@" && k !== "#text");
}
function childrenOf(node) {
  const name = nameOf(node);
  if (!name) return [];
  const value = node[name];
  return Array.isArray(value) ? value : [];
}
function attrsOf(node) {
  return node[":@"] ?? {};
}
function textOf(node) {
  let out = "";
  for (const child of childrenOf(node)) {
    if ("#text" in child) out += String(child["#text"]);
    else out += textOf(child);
  }
  return out;
}
function findChild(node, name) {
  return childrenOf(node).find((c) => nameOf(c) === name);
}
function findChildren(node, name) {
  return childrenOf(node).filter((c) => nameOf(c) === name);
}
function childrenThroughSdt(node, name) {
  const names = Array.isArray(name) ? name : [name];
  const out = [];
  const visit = (n) => {
    for (const child of childrenOf(n)) {
      const cn = nameOf(child);
      if (cn !== void 0 && names.includes(cn)) out.push(child);
      else if (cn === "w:sdt") {
        const content = findChild(child, "w:sdtContent");
        if (content) visit(content);
      }
    }
  };
  visit(node);
  return out;
}
function boolProp(parent, name) {
  const child = findChild(parent, name);
  if (!child) return false;
  const val2 = attrsOf(child)["w:val"];
  if (val2 === void 0) return true;
  return !["0", "false", "none", "off"].includes(val2.toLowerCase());
}
function underlineProp(parent) {
  const child = findChild(parent, "w:u");
  if (!child) return false;
  const val2 = attrsOf(child)["w:val"];
  return val2 !== void 0 && val2 !== "none";
}
function serializeXNode(node) {
  if ("#text" in node) return escapeXmlText(String(node["#text"]));
  const name = nameOf(node);
  if (!name) return "";
  const attrs = Object.entries(attrsOf(node)).map(([k, v]) => ` ${k}="${escapeXmlAttr(String(v))}"`).join("");
  const inner = childrenOf(node).map(serializeXNode).join("");
  return inner === "" ? `<${name}${attrs}/>` : `<${name}${attrs}>${inner}</${name}>`;
}
var ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
function escapeXmlText(text) {
  return text.replace(ILLEGAL_XML_CHARS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeXmlAttr(text) {
  return escapeXmlText(text).replace(/"/g, "&quot;");
}

// vendor/genoffice/docx/chart.ts
var CHART_KINDS = {
  "c:barChart": "bar",
  "c:bar3DChart": "bar",
  "c:lineChart": "line",
  "c:line3DChart": "line",
  "c:pieChart": "pie",
  "c:pie3DChart": "pie",
  "c:doughnutChart": "pie",
  "c:areaChart": "area",
  "c:area3DChart": "area",
  "c:scatterChart": "scatter",
  "c:bubbleChart": "bubble",
  "c:radarChart": "radar"
};
var DEFAULT_FRAME_LINE = "868686";
var MAX_CHART_CACHE_POINTS = 1048576;
var MAX_CHART_SERIES = 256;
function parseChartPartXml(xml, partPath, theme) {
  const parsed = xmlParser.parse(xml);
  if (xml.includes("<cx:chartSpace")) return parseChartexPartXml(parsed, partPath);
  const space = parsed.find((n) => nameOf(n) === "c:chartSpace");
  const chart = space ? findChild(space, "c:chart") : void 0;
  const plotArea = chart ? findChild(chart, "c:plotArea") : void 0;
  if (!space || !chart || !plotArea) return null;
  const plot = childrenOf(plotArea).find((c) => (nameOf(c) ?? "").endsWith("Chart"));
  if (!plot) return null;
  const kind = CHART_KINDS[nameOf(plot) ?? ""] ?? "other";
  const horizontal = kind === "bar" && attrsOf(findChild(plot, "c:barDir") ?? {})["val"] === "bar";
  const groupingVal = attrsOf(findChild(plot, "c:grouping") ?? {})["val"];
  const grouping = (kind === "bar" || kind === "area" || kind === "line") && (groupingVal === "stacked" || groupingVal === "percentStacked") ? groupingVal : void 0;
  const scatterStyle = attrsOf(findChild(plot, "c:scatterStyle") ?? {})["val"];
  const radarStyleVal = attrsOf(findChild(plot, "c:radarStyle") ?? {})["val"];
  const radarStyle = kind === "radar" ? radarStyleVal === "filled" || radarStyleVal === "marker" ? radarStyleVal : "standard" : void 0;
  const symbolsOff = findChildren(plot, "c:ser").every(
    (ser) => attrsOf(findChild(findChild(ser, "c:marker") ?? {}, "c:symbol") ?? {})["val"] === "none"
  );
  const markers = kind === "line" ? attrsOf(findChild(plot, "c:marker") ?? {})["val"] === "1" && !symbolsOff : kind === "scatter" ? (scatterStyle === void 0 || scatterStyle.toLowerCase().includes("marker")) && !symbolsOff : kind === "radar" ? radarStyle === "marker" && !symbolsOff : false;
  const scatterLines = kind === "scatter" && /line|smooth/i.test(scatterStyle ?? "");
  const holeVal = attrsOf(findChild(plot, "c:holeSize") ?? {})["val"];
  const holeParsed = holeVal !== void 0 ? parseInt(holeVal, 10) : NaN;
  const holePct = nameOf(plot) === "c:doughnutChart" ? Number.isFinite(holeParsed) ? holeParsed : 50 : 0;
  const legendPos = legendPosOf(chart);
  const legendFontPt = textProps(findChild(findChild(chart, "c:legend") ?? {}, "c:txPr")).fontPt;
  const dataLabels = dataLabelsOf(plot, theme);
  const frameLine = lineHex(findChild(space, "c:spPr"), theme, DEFAULT_FRAME_LINE);
  const axes = axesOf(plotArea, theme);
  const dTable = findChild(plotArea, "c:dTable");
  const tableLine = dTable ? lineHex(findChild(dTable, "c:spPr"), theme, autoLineHex(theme)) : void 0;
  const dataTable = dTable ? {
    keys: boolFlag(dTable, "c:showKeys"),
    horz: boolFlag(dTable, "c:showHorzBorder"),
    vert: boolFlag(dTable, "c:showVertBorder"),
    outline: boolFlag(dTable, "c:showOutline"),
    ...tableLine ? { line: tableLine } : {}
  } : void 0;
  let explosionPct;
  let categories = [];
  const series = [];
  const sers = findChildren(plot, "c:ser");
  const maxPoints = Math.max(
    1,
    Math.floor(MAX_CHART_CACHE_POINTS / Math.min(sers.length, MAX_CHART_SERIES))
  );
  for (const ser of sers) {
    if (series.length >= MAX_CHART_SERIES) break;
    const val2 = findChild(ser, "c:val") ?? findChild(ser, "c:yVal");
    const values = val2 ? cacheNumbers(val2, maxPoints) : [];
    if (values.length === 0) continue;
    const cat = findChild(ser, "c:cat") ?? findChild(ser, "c:xVal");
    if (cat && categories.length === 0) {
      categories = cachePoints(cat, maxPoints).map((v) => v ?? "");
      const fmt = catFormatCode(cat);
      if (fmt && /[yd]/i.test(fmt)) {
        categories = categories.map((v) => serialDateText(v) ?? v);
      } else if (nameOf(cat) === "c:xVal") {
        categories = categories.map((v) => {
          const n = Number(v);
          return v !== "" && Number.isFinite(n) ? String(Math.round(n * 1e4) / 1e4) : v;
        });
      }
    }
    const name = seriesName(ser);
    const entry = { ...name !== void 0 ? { name } : {}, values };
    const color = solidFillHex(findChild(ser, "c:spPr"), theme);
    if (color) entry.color = color;
    const pointColors = dataPointColors(ser, theme, maxPoints);
    if (pointColors) entry.pointColors = pointColors;
    if (kind === "pie" && series.length === 0) {
      const expl = parseInt(attrsOf(findChild(ser, "c:explosion") ?? {})["val"] ?? "", 10);
      if (expl > 0) explosionPct = expl;
    }
    if (kind === "scatter" || kind === "bubble") {
      const xVal = findChild(ser, "c:xVal");
      const xValues = xVal ? cacheNumbers(xVal, maxPoints) : [];
      if (xValues.some((v) => v !== null)) entry.xValues = xValues;
      const sizeVal = findChild(ser, "c:bubbleSize");
      const sizes = sizeVal ? cacheNumbers(sizeVal, maxPoints) : [];
      if (sizes.some((v) => v !== null)) entry.sizes = sizes;
      if (scatterLines && !seriesLineHidden(ser)) entry.line = true;
    }
    series.push(entry);
  }
  if (series.length === 0) return null;
  const palette = chartPalette(chartStyleVal(space), theme);
  const titleFontPt = textProps(findChild(chart, "c:title")).fontPt;
  let title = chartTitle(chart);
  if (title === "Chart Title" && series.length === 1 && series[0].name) title = series[0].name;
  return {
    partPath,
    kind,
    ...horizontal ? { horizontal } : {},
    ...grouping ? { grouping } : {},
    ...markers ? { markers } : {},
    ...radarStyle ? { radarStyle } : {},
    ...holePct > 0 ? { holePct } : {},
    ...explosionPct ? { explosionPct } : {},
    ...dataLabels ? { dataLabels } : {},
    ...legendPos ? { legendPos } : { noLegend: true },
    ...legendFontPt !== void 0 ? { legendFontPt } : {},
    ...frameLine ? { frameLine } : {},
    ...axes,
    ...dataTable ? { dataTable } : {},
    ...title !== void 0 ? { title } : {},
    ...titleFontPt !== void 0 ? { titleFontPt } : {},
    categories,
    series,
    ...palette ? { palette } : {}
  };
}
function boolFlag(parent, tag2) {
  const node = findChild(parent, tag2);
  if (!node) return false;
  const val2 = attrsOf(node)["val"];
  return val2 === void 0 || val2 === "1" || val2 === "true";
}
function textProps(node, theme) {
  if (!node) return {};
  let rPr;
  const walk = (n) => {
    for (const child of childrenOf(n)) {
      if (rPr) return;
      const name = nameOf(child);
      if (name === "a:defRPr" || name === "a:rPr") rPr = child;
      else walk(child);
    }
  };
  walk(node);
  if (!rPr) return {};
  const sz = parseInt(attrsOf(rPr)["sz"] ?? "", 10);
  const color = solidFillHex(rPr, theme);
  return { ...sz > 0 ? { fontPt: sz / 100 } : {}, ...color ? { color } : {} };
}
function dataLabelsOf(plot, theme) {
  const ser = findChild(plot, "c:ser");
  const dLbls = (ser ? findChild(ser, "c:dLbls") : void 0) ?? findChild(plot, "c:dLbls");
  if (!dLbls || boolFlag(dLbls, "c:delete")) return void 0;
  const flagsOf = (n) => ({
    val: boolFlag(n, "c:showVal"),
    pct: boolFlag(n, "c:showPercent"),
    cat: boolFlag(n, "c:showCatName")
  });
  const val2 = ser ? findChild(ser, "c:val") ?? findChild(ser, "c:yVal") : void 0;
  const points = val2 ? cacheNumbers(val2).length : 0;
  const perPoint = findChildren(dLbls, "c:dLbl").filter((d) => !boolFlag(d, "c:delete"));
  let source = dLbls;
  let flags = flagsOf(dLbls);
  if (points > 0 && perPoint.length >= points) {
    source = perPoint[0];
    flags = perPoint.map(flagsOf).reduce((a, f) => ({
      val: a.val || f.val,
      pct: a.pct || f.pct,
      cat: a.cat || f.cat
    }));
  }
  if (!flags.val && !flags.pct && !flags.cat) return void 0;
  const out = {};
  if (flags.val) out.val = true;
  if (flags.pct) out.pct = true;
  if (flags.cat) out.cat = true;
  const text = textProps(findChild(source, "c:txPr") ?? findChild(dLbls, "c:txPr"), theme);
  if (text.fontPt !== void 0) out.fontPt = text.fontPt;
  if (text.color) out.color = text.color;
  const numFmt = attrsOf(findChild(source, "c:numFmt") ?? findChild(dLbls, "c:numFmt") ?? {})["formatCode"];
  if (numFmt) out.numFmt = numFmt;
  return out;
}
function axesOf(plotArea, theme) {
  const out = {};
  const autoLine = autoLineHex(theme);
  for (const ax of childrenOf(plotArea)) {
    const name = nameOf(ax);
    if (name !== "c:catAx" && name !== "c:valAx" && name !== "c:dateAx" && name !== "c:serAx")
      continue;
    const pos = attrsOf(findChild(ax, "c:axPos") ?? {})["val"];
    const slot2 = pos === "b" || pos === "t" ? "xAxis" : pos === "l" || pos === "r" ? "yAxis" : void 0;
    if (!slot2 || out[slot2]) continue;
    const axis = {};
    const title = findChild(ax, "c:title");
    if (title) axis.title = richText(title) || "Axis Title";
    const line = lineHex(findChild(ax, "c:spPr"), theme, autoLine);
    if (line) axis.line = line;
    if (boolFlag(ax, "c:delete")) axis.deleted = true;
    const text = textProps(findChild(ax, "c:txPr"), theme);
    if (text.fontPt !== void 0) axis.fontPt = text.fontPt;
    if (text.color) axis.color = text.color;
    const gridlines = findChild(ax, "c:majorGridlines");
    if (gridlines) {
      const grid = lineHex(findChild(gridlines, "c:spPr"), theme, autoGridHex(theme));
      if (grid) axis.gridLine = grid;
    }
    out[slot2] = axis;
  }
  return out;
}
function autoGridHex(theme) {
  return tintHex(theme?.dk1 && /^[0-9A-Fa-f]{6}$/.test(theme.dk1) ? theme.dk1 : "000000", 0.15);
}
function autoLineHex(theme) {
  return tintHex(theme?.dk1 && /^[0-9A-Fa-f]{6}$/.test(theme.dk1) ? theme.dk1 : "000000", 0.75);
}
function richText(node) {
  const texts = [];
  const walk = (n, tag2) => {
    for (const child of childrenOf(n)) {
      if (nameOf(child) === tag2) texts.push(textOf(child));
      else walk(child, tag2);
    }
  };
  walk(node, "a:t");
  if (texts.length === 0) walk(node, "c:v");
  return texts.join("");
}
function lineHex(spPr, theme, auto) {
  const ln = spPr ? findChild(spPr, "a:ln") : void 0;
  if (!ln) return auto;
  if (findChild(ln, "a:noFill")) return void 0;
  return solidFillHex(ln, theme) ?? auto;
}
var LEGEND_POSITIONS = /* @__PURE__ */ new Set(["b", "l", "r", "t", "tr"]);
function legendPosOf(chart) {
  const legend = findChild(chart, "c:legend");
  if (!legend) return void 0;
  const val2 = attrsOf(findChild(legend, "c:legendPos") ?? {})["val"];
  return val2 !== void 0 && LEGEND_POSITIONS.has(val2) ? val2 : "r";
}
function cacheNumbers(container, maxPoints = MAX_CHART_CACHE_POINTS) {
  return cachePoints(container, maxPoints).map((v) => {
    if (v === null || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
}
function seriesLineHidden(ser) {
  const ln = findChild(findChild(ser, "c:spPr") ?? {}, "a:ln");
  return ln !== void 0 && findChild(ln, "a:noFill") !== void 0;
}
function dataPointColors(ser, theme, maxPoints = MAX_CHART_CACHE_POINTS) {
  const out = [];
  let any = false;
  for (const dPt of findChildren(ser, "c:dPt")) {
    const idx = parseInt(attrsOf(findChild(dPt, "c:idx") ?? {})["val"] ?? "", 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= maxPoints) continue;
    const color = solidFillHex(findChild(dPt, "c:spPr"), theme);
    if (!color) continue;
    out[idx] = color;
    any = true;
  }
  if (!any) return null;
  for (let i = 0; i < out.length; i++) out[i] ??= null;
  return out;
}
var SCHEME_SLOTS = {
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  dk1: "dk1",
  lt1: "lt1",
  dk2: "dk2",
  lt2: "lt2",
  tx1: "dk1",
  bg1: "lt1",
  tx2: "dk2",
  bg2: "lt2"
};
function solidFillHex(spPr, theme) {
  if (!spPr) return void 0;
  const fill = findChild(spPr, "a:solidFill");
  if (!fill) return void 0;
  for (const clr of childrenOf(fill)) {
    const name = nameOf(clr);
    let base;
    if (name === "a:srgbClr") base = attrsOf(clr)["val"];
    else if (name === "a:sysClr") base = attrsOf(clr)["lastClr"];
    else if (name === "a:schemeClr") {
      const slot2 = SCHEME_SLOTS[attrsOf(clr)["val"] ?? ""];
      base = slot2 ? theme?.[slot2] : void 0;
    }
    if (!base || !/^[0-9A-Fa-f]{6}$/.test(base)) continue;
    return applyColorMods(base.toUpperCase(), clr);
  }
  return void 0;
}
function applyColorMods(hex, clr) {
  let lumMod;
  let lumOff;
  let shadeV;
  let tintV;
  for (const child of childrenOf(clr)) {
    const v = parseInt(attrsOf(child)["val"] ?? "", 10);
    if (!Number.isFinite(v)) continue;
    const name = nameOf(child);
    if (name === "a:lumMod") lumMod = v / 1e5;
    else if (name === "a:lumOff") lumOff = v / 1e5;
    else if (name === "a:shade") shadeV = v / 1e5;
    else if (name === "a:tint") tintV = v / 1e5;
  }
  let out = hex;
  if (shadeV !== void 0) out = shadeHex(out, shadeV);
  if (tintV !== void 0) out = tintHex(out, tintV);
  if (lumMod !== void 0 || lumOff !== void 0) out = lumHex(out, lumMod ?? 1, lumOff ?? 0);
  return out;
}
var hexRgb = (hex) => [
  parseInt(hex.slice(0, 2), 16),
  parseInt(hex.slice(2, 4), 16),
  parseInt(hex.slice(4, 6), 16)
];
var rgbHex = (r, g, b) => [r, g, b].map(
  (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")
).join("").toUpperCase();
function shadeHex(hex, factor) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(r * factor, g * factor, b * factor);
}
function tintHex(hex, factor) {
  const [r, g, b] = hexRgb(hex);
  const t = (c) => c * factor + 255 * (1 - factor);
  return rgbHex(t(r), t(g), t(b));
}
function lumHex(hex, mod, off) {
  const [r, g, b] = hexRgb(hex).map((c2) => c2 / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l0 = (max + min) / 2;
  const d = max - min;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l0 - 1));
    if (max === r) h = (g - b) / d % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = Math.max(0, Math.min(1, l0 * mod + off));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(h / 60 % 2 - 1));
  const m = l - c / 2;
  const seg = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex((seg[0] + m) * 255, (seg[1] + m) * 255, (seg[2] + m) * 255);
}
function chartStyleVal(space) {
  let node = findChild(space, "c:style");
  if (!node) {
    const alt = findChild(space, "mc:AlternateContent");
    const choice = alt ? findChild(alt, "mc:Choice") : void 0;
    const fallback = alt ? findChild(alt, "mc:Fallback") : void 0;
    node = (choice ? childrenOf(choice).find((c) => (nameOf(c) ?? "").endsWith(":style")) : void 0) ?? (fallback ? findChild(fallback, "c:style") : void 0);
  }
  let v = parseInt(attrsOf(node ?? {})["val"] ?? "", 10);
  if (v > 100) v -= 100;
  return Number.isFinite(v) && v >= 1 && v <= 48 ? v : void 0;
}
var GRAYSCALE_PALETTE = ["595959", "D9D9D9", "A6A6A6", "404040", "BFBFBF", "8C8C8C"];
function chartPalette(styleVal, theme) {
  const pos = styleVal === void 0 ? 2 : (styleVal - 1) % 8 + 1;
  if (pos === 1) return GRAYSCALE_PALETTE;
  const accents = [
    theme?.accent1,
    theme?.accent2,
    theme?.accent3,
    theme?.accent4,
    theme?.accent5,
    theme?.accent6
  ];
  if (accents.some((a) => !a || !/^[0-9A-Fa-f]{6}$/.test(a))) return void 0;
  const list = accents.map((a) => a.toUpperCase());
  if (pos === 2) return list;
  const base = list[pos - 3];
  return [
    base,
    tintHex(base, 0.6),
    shadeHex(base, 0.75),
    tintHex(base, 0.3),
    shadeHex(base, 0.5),
    tintHex(base, 0.8)
  ];
}
var CHARTEX_KINDS = {
  clusteredColumn: "bar",
  boxWhisker: "bar",
  waterfall: "bar",
  funnel: "bar",
  paretoLine: "line",
  sunburst: "pie",
  treemap: "pie"
};
function parseChartexPartXml(parsed, partPath) {
  const space = parsed.find((n) => nameOf(n) === "cx:chartSpace");
  if (!space) return null;
  const chartData = findChild(space, "cx:chartData") ?? childrenOf(space).find((c) => findChild(c, "cx:data") !== void 0);
  const dataById = /* @__PURE__ */ new Map();
  for (const data of chartData ? findChildren(chartData, "cx:data") : []) {
    const id = attrsOf(data)["id"] ?? "";
    const entry = { cats: [], vals: [] };
    const ptsOf = (dim) => {
      const lvl = findChild(dim, "cx:lvl");
      if (!lvl) return [];
      const out = [];
      for (const pt of findChildren(lvl, "cx:pt")) {
        const idx = parseInt(attrsOf(pt)["idx"] ?? "", 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < MAX_CHART_CACHE_POINTS) out[idx] = textOf(pt);
      }
      return out;
    };
    for (const dim of childrenOf(data)) {
      const dimName = nameOf(dim);
      if (dimName === "cx:strDim") {
        entry.cats = ptsOf(dim).map((v) => v ?? "");
      } else if (dimName === "cx:numDim") {
        entry.vals = ptsOf(dim).map((v) => {
          if (v === null || v.trim() === "") return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        });
      }
    }
    dataById.set(id, entry);
  }
  const chart = findChild(space, "cx:chart");
  const plotRegion = chart ? findChild(findChild(chart, "cx:plotArea") ?? {}, "cx:plotAreaRegion") : void 0;
  let kind = "other";
  let categories = [];
  const series = [];
  for (const ser of plotRegion ? findChildren(plotRegion, "cx:series") : []) {
    const layout = attrsOf(ser)["layoutId"] ?? "";
    if (kind === "other" && CHARTEX_KINDS[layout]) kind = CHARTEX_KINDS[layout];
    const dataId = attrsOf(findChild(ser, "cx:dataId") ?? {})["val"] ?? "";
    const data = dataById.get(dataId);
    if (!data || data.vals.length === 0) continue;
    if (categories.length === 0) categories = data.cats;
    const name = textOf(
      findChild(findChild(findChild(ser, "cx:tx") ?? {}, "cx:txData") ?? {}, "cx:v") ?? {}
    );
    series.push({ ...name ? { name } : {}, values: data.vals });
  }
  if (series.length === 0) return null;
  const title = chart ? chartexTitle(chart) : void 0;
  return {
    partPath,
    kind,
    ...title !== void 0 ? { title } : {},
    categories,
    series
  };
}
function chartexTitle(chart) {
  const title = findChild(chart, "cx:title");
  if (!title) return void 0;
  const texts = [];
  const walk = (node) => {
    for (const child of childrenOf(node)) {
      if (nameOf(child) === "a:t") texts.push(textOf(child));
      else walk(child);
    }
  };
  walk(title);
  const joined = texts.join("");
  return joined !== "" ? joined : void 0;
}
function catFormatCode(container) {
  const ref = findChild(container, "c:numRef");
  const cache = ref ? findChild(ref, "c:numCache") : findChild(container, "c:numLit");
  const code = cache ? findChild(cache, "c:formatCode") : void 0;
  return code ? textOf(code) : void 0;
}
function serialDateText(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 8e4) return null;
  const base = n < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.round(n) * 864e5);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}
function cachePoints(container, maxPoints = MAX_CHART_CACHE_POINTS) {
  const ref = findChild(container, "c:strRef") ?? findChild(container, "c:numRef");
  const cache = ref ? findChild(ref, "c:strCache") ?? findChild(ref, "c:numCache") : findChild(container, "c:strLit") ?? findChild(container, "c:numLit");
  if (!cache) return [];
  const count = parseInt(attrsOf(findChild(cache, "c:ptCount") ?? {})["val"] ?? "", 10);
  const points = [];
  for (const pt of findChildren(cache, "c:pt")) {
    const idx = parseInt(attrsOf(pt)["idx"] ?? "", 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= maxPoints) continue;
    points[idx] = textOf(findChild(pt, "c:v") ?? {});
  }
  const requestedLength = Number.isFinite(count) ? Math.max(count, points.length) : points.length;
  const length = Math.min(Math.max(requestedLength, 0), maxPoints);
  const out = [];
  for (let i = 0; i < length; i++) out.push(points[i] ?? null);
  return out;
}
function seriesName(ser) {
  const tx = findChild(ser, "c:tx");
  if (!tx) return void 0;
  const literal = findChild(tx, "c:v");
  if (literal) return textOf(literal);
  const cached = cachePoints(tx);
  return cached[0] ?? void 0;
}
function chartTitle(chart) {
  const title = findChild(chart, "c:title");
  if (!title) return void 0;
  const joined = richText(title);
  if (joined) return joined;
  const del = findChild(chart, "c:autoTitleDeleted");
  const delVal = del ? attrsOf(del)["val"] : void 0;
  const deleted = del !== void 0 && (delVal === void 0 || delVal === "1" || delVal === "true");
  return deleted ? void 0 : "Chart Title";
}
var CHART_WORKBOOK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
var colLetter = (i) => {
  let n = i + 2;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
};
function strCacheXml(values, f) {
  return `<c:strRef><c:f>${escapeXmlText(f)}</c:f><c:strCache><c:ptCount val="${values.length}"/>` + values.map((v, i) => `<c:pt idx="${i}"><c:v>${escapeXmlText(v)}</c:v></c:pt>`).join("") + "</c:strCache></c:strRef>";
}
function numCacheXml(values, f) {
  return `<c:numRef><c:f>${escapeXmlText(f)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>` + values.map((v, i) => v === null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("") + "</c:numCache></c:numRef>";
}
function buildChartPartXml(chart, externalDataRId) {
  const rows = chart.categories.length;
  const sers = chart.series.map((ser, i) => {
    const col = colLetter(i);
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx>${strCacheXml([ser.name], `Sheet1!$${col}$1`)}</c:tx><c:cat>${strCacheXml(chart.categories, `Sheet1!$A$2:$A$${rows + 1}`)}</c:cat><c:val>${numCacheXml(ser.values.slice(0, rows), `Sheet1!$${col}$2:$${col}$${rows + 1}`)}</c:val></c:ser>`;
  }).join("");
  let plot;
  if (chart.kind === "pie") {
    plot = `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`;
  } else {
    const axes = '<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx><c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>';
    const inner = chart.kind === "bar" ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}<c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>` : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="111111111"/><c:axId val="222222222"/></c:lineChart>`;
    plot = inner + axes;
  }
  const title = chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXmlText(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` + (externalDataRId ? `<c:externalData r:id="${externalDataRId}"><c:autoUpdate val="0"/></c:externalData>` : "") + "</c:chartSpace>";
}
var XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
async function buildChartWorkbookXlsxBase64(categories, series) {
  const rows = categories.length;
  const serCount = series.length;
  const strings = [];
  const si = (s) => {
    const idx = strings.indexOf(s);
    if (idx !== -1) return idx;
    strings.push(s);
    return strings.length - 1;
  };
  const headerCells = [];
  headerCells.push(`<c r="A1" t="s"><v>${si("")}</v></c>`);
  for (let j = 0; j < serCount; j++) {
    headerCells.push(`<c r="${colLetter(j)}1" t="s"><v>${si(series[j].name)}</v></c>`);
  }
  const dataRows = [];
  for (let i = 0; i < rows; i++) {
    const rowNum = i + 2;
    const cells = [];
    cells.push(`<c r="A${rowNum}" t="s"><v>${si(categories[i])}</v></c>`);
    for (let j = 0; j < serCount; j++) {
      const val2 = series[j].values[i];
      if (val2 !== null && val2 !== void 0) {
        cells.push(`<c r="${colLetter(j)}${rowNum}"><v>${val2}</v></c>`);
      }
    }
    dataRows.push(`<row r="${rowNum}">${cells.join("")}</row>`);
  }
  const sheetXml = XML_DECL + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headerCells.join("")}</row>` + dataRows.join("") + "</sheetData></worksheet>";
  const sharedStringsXml = XML_DECL + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` + strings.map((s) => `<si><t>${escapeXmlText(s)}</t></si>`).join("") + "</sst>";
  const workbookXml = XML_DECL + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const workbookRels = XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  const topRels = XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const contentTypes = XML_DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", topRels);
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", workbookRels);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  zip.file("xl/sharedStrings.xml", sharedStringsXml);
  return zipToBase64(zip);
}
async function zipToBase64(zip) {
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// vendor/genoffice/docx/ink.ts
var INK_NAME_PREFIX = "aidocs-ink";
var INK_MEDIA_PREFIX = "aidocsink";
var INK_REL_RE = new RegExp(
  `<Relationship [^>]*Target="media/${INK_MEDIA_PREFIX}\\d+\\.png"[^>]*/>`,
  "g"
);
var INK_MEDIA_PATH_RE = new RegExp(`^word/media/${INK_MEDIA_PREFIX}\\d+\\.png$`);
var EMU_PER_PX = 9525;
var A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
var PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
var WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
var R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function anchoredInkRunXml(ink, rId, docPrId) {
  const safePx = (v, fallback) => Number.isFinite(v) ? Math.round(v * EMU_PER_PX) : fallback;
  const cx = Math.max(1, safePx(ink.widthPx, 1));
  const cy = Math.max(1, safePx(ink.heightPx, 1));
  const x = safePx(ink.offsetXPx, 0);
  const y = safePx(ink.offsetYPx, 0);
  const name = `${INK_NAME_PREFIX} ${docPrId}`;
  const descr = ink.payload ? ` descr="${escapeXmlAttr(ink.payload)}"` : "";
  return `<w:r><w:drawing><wp:anchor xmlns:wp="${WP_NS}" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + docPrId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${docPrId}" name="${name}"${descr}/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="${R_NS}" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}
var ANCHOR_RUN_RE = /<w:r><w:drawing><wp:anchor[\s\S]*?<\/wp:anchor><\/w:drawing><\/w:r>/g;
var isInkRun = (run2) => run2.includes(`name="${INK_NAME_PREFIX}`);
function stripInkRuns(xml) {
  if (!xml.includes(INK_NAME_PREFIX)) return xml;
  return xml.replace(ANCHOR_RUN_RE, (run2) => isInkRun(run2) ? "" : run2);
}
function findInkRuns(paragraphXml) {
  if (!paragraphXml.includes(INK_NAME_PREFIX)) return [];
  const out = [];
  for (const run2 of paragraphXml.match(ANCHOR_RUN_RE) ?? []) {
    if (!isInkRun(run2)) continue;
    const emu = (value) => parseInt(value ?? "0", 10) || 0;
    const descr = /<wp:docPr [^>]*descr="([^"]*)"/.exec(run2)?.[1];
    const extent = /<wp:extent[^>]*\/?>/.exec(run2)?.[0] ?? "";
    out.push({
      xml: run2,
      offsetXPx: emu(/<wp:positionH[^>]*><wp:posOffset>(-?\d+)/.exec(run2)?.[1]) / EMU_PER_PX,
      offsetYPx: emu(/<wp:positionV[^>]*><wp:posOffset>(-?\d+)/.exec(run2)?.[1]) / EMU_PER_PX,
      widthPx: emu(/\bcx="(\d+)"/.exec(extent)?.[1]) / EMU_PER_PX,
      heightPx: emu(/\bcy="(\d+)"/.exec(extent)?.[1]) / EMU_PER_PX,
      payload: descr ? decodeXmlEntities(descr) : null,
      embedRId: /r:embed="([^"]+)"/.exec(run2)?.[1] ?? null
    });
  }
  return out;
}
function injectInkRunsIntoParagraph(xml, runsXml2) {
  if (!/^<w:p[\s/>]/.test(xml)) return null;
  if (xml.endsWith("/>")) return `${xml.slice(0, -2)}>${runsXml2}</w:p>`;
  const close = xml.lastIndexOf("</w:p>");
  if (close === -1) return null;
  return xml.slice(0, close) + runsXml2 + xml.slice(close);
}
function decodeXmlEntities(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// vendor/genoffice/zip-gate/byte-stream.ts
function streamBytes(bytes) {
  const SLICE = 64 * 1024;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + SLICE, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    }
  });
}
function decompressionStream(format) {
  return new DecompressionStream(format);
}

// vendor/genoffice/zip-gate/index.ts
var DEFAULT_ZIP_LIMITS = {
  // DevMoter private-host upload policy: tighter bounds than the desktop engine.
  maxParts: 2e3,
  maxPartBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024
};
function assertDeclaredSizesWithinLimits(parts, limits = DEFAULT_ZIP_LIMITS) {
  if (parts.length > limits.maxParts) {
    throw new Error(`zip rejected: ${parts.length} parts exceeds the ${limits.maxParts} limit`);
  }
  let total = 0;
  for (const part of parts) {
    if (part.usize > limits.maxPartBytes) {
      throw new Error(
        `zip rejected: part ${part.name} declares ${part.usize} uncompressed bytes (limit ${limits.maxPartBytes})`
      );
    }
    if (part.usize > 0) total += part.usize;
  }
  if (total > limits.maxTotalBytes) {
    throw new Error(
      `zip rejected: total uncompressed size ${total} exceeds the ${limits.maxTotalBytes} limit`
    );
  }
}
var EOCD_SIG = 101010256;
var CENTRAL_SIG = 33639248;
var LOCAL_SIG = 67324752;
var ZIP64_LOCATOR_SIG = 117853008;
var FLAG_ENCRYPTED = 1;
async function assertZipInflatesWithinLimits(bytes, limits = DEFAULT_ZIP_LIMITS) {
  const parts = scanParts(bytes);
  if (parts.length > limits.maxParts) {
    throw new Error(`zip rejected: ${parts.length} parts exceeds the ${limits.maxParts} limit`);
  }
  let total = 0;
  for (const part of parts) {
    if (part.usize > limits.maxPartBytes) {
      throw new Error(
        `zip rejected: part ${part.name} declares ${part.usize} uncompressed bytes (limit ${limits.maxPartBytes})`
      );
    }
    total += await verifiedSize(bytes, part);
    if (total > limits.maxTotalBytes) {
      throw new Error(
        `zip rejected: total uncompressed size ${total} exceeds the ${limits.maxTotalBytes} limit`
      );
    }
  }
}
function scanParts(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i, width) => width === 4 ? view.getUint32(i, true) : view.getUint16(i, true);
  const end = bytes.byteLength - 22;
  if (end < 0) throw new Error("zip: end of central directory not found");
  let eocd = -1;
  for (let i = end; i >= Math.max(0, end - 65535); i--) {
    if (at(i, 4) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  if (eocd >= 20 && at(eocd - 20, 4) === ZIP64_LOCATOR_SIG) {
    throw new Error("zip: zip64 archives are not supported");
  }
  const count = at(eocd + 10, 2);
  const cdSize = at(eocd + 12, 4);
  const cdOffset = at(eocd + 16, 4);
  if (count === 65535 || cdSize === 4294967295 || cdOffset === 4294967295) {
    throw new Error("zip: zip64 archives are not supported");
  }
  if (cdOffset > bytes.byteLength || cdSize > bytes.byteLength - cdOffset) {
    throw new Error("zip: corrupt central directory");
  }
  const parts = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > cdOffset + cdSize || at(pos, 4) !== CENTRAL_SIG) {
      throw new Error("zip: corrupt central directory");
    }
    const flags = at(pos + 8, 2);
    if (flags & FLAG_ENCRYPTED) throw new Error("zip: encrypted entries are not supported");
    const nameLen = at(pos + 28, 2);
    const extraLen = at(pos + 30, 2);
    const commentLen = at(pos + 32, 2);
    const nameStart = pos + 46;
    if (nameStart + nameLen > cdOffset + cdSize) {
      throw new Error("zip: corrupt central directory");
    }
    const localOffset = at(pos + 42, 4);
    const rawName = bytes.subarray(nameStart, nameStart + nameLen);
    parts.push({
      // latin1 keeps byte-for-byte round-tripping of the non-UTF8 names Word and
      // JSZip accept; the string is only ever used to name a rejection.
      name: decodeLatin1(rawName),
      method: at(pos + 10, 2),
      csize: at(pos + 20, 4),
      usize: at(pos + 24, 4),
      dataStart: localOffset
    });
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  for (const part of parts) {
    if (part.dataStart + 30 > bytes.byteLength || at(part.dataStart, 4) !== LOCAL_SIG) {
      throw new Error(`zip: corrupt local header for ${part.name}`);
    }
    const start = part.dataStart + 30 + at(part.dataStart + 26, 2) + at(part.dataStart + 28, 2);
    if (start > bytes.byteLength || part.csize > bytes.byteLength - start) {
      throw new Error(
        `zip: entry ${part.name} declares ${part.csize} bytes at ${start}, outside the ${bytes.byteLength}-byte archive`
      );
    }
    part.dataStart = start;
  }
  return parts.filter((part) => !part.name.endsWith("/"));
}
async function verifiedSize(bytes, part) {
  const raw = bytes.subarray(part.dataStart, part.dataStart + part.csize);
  if (part.method === 0) {
    if (raw.length > part.usize) throw underDeclared(part);
    return raw.length;
  }
  if (part.method !== 8) {
    throw new Error(`zip: unsupported compression method ${part.method} for ${part.name}`);
  }
  return inflateRawBounded(raw, part);
}
async function inflateRawBounded(raw, part) {
  let seen = 0;
  try {
    const reader = streamBytes(raw).pipeThrough(decompressionStream("deflate-raw")).getReader();
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > part.usize) {
        await reader.cancel();
        throw underDeclared(part);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("zip rejected:")) throw err;
    const message = err instanceof Error ? err.message || err.name : String(err);
    throw new Error(`zip rejected: part ${part.name} cannot be inflated: ${message}`, {
      cause: err
    });
  }
  return seen;
}
function underDeclared(part, cause) {
  const error = new Error(
    `zip rejected: part ${part.name} declares ${part.usize} uncompressed bytes but inflates past that`
  );
  return cause === void 0 ? error : Object.assign(error, { cause });
}
function decodeLatin1(bytes) {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

// vendor/genoffice/docx/vendor/emf-converter/index.mjs
function colorRefToHex(r, g, b) {
  const toHex = (v) => v.toString(16).padStart(2, "0");
  return `#${toHex(r & 255)}${toHex(g & 255)}${toHex(b & 255)}`;
}
function readColorRef(view, offset) {
  const r = view.getUint8(offset);
  const g = view.getUint8(offset + 1);
  const b = view.getUint8(offset + 2);
  return colorRefToHex(r, g, b);
}
function argbToRgba(argb) {
  const a = (argb >>> 24 & 255) / 255;
  const r = argb >>> 16 & 255;
  const g = argb >>> 8 & 255;
  const b = argb & 255;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
function lerpArgbToRgba(argbA, argbB, t) {
  const tc = Math.min(1, Math.max(0, t));
  const mix = (a2, b2) => Math.round(a2 + (b2 - a2) * tc);
  const aA = argbA >>> 24 & 255;
  const aB = argbB >>> 24 & 255;
  const r = mix(argbA >>> 16 & 255, argbB >>> 16 & 255);
  const g = mix(argbA >>> 8 & 255, argbB >>> 8 & 255);
  const b = mix(argbA & 255, argbB & 255);
  const a = mix(aA, aB) / 255;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
function invertCssColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const v = parseInt(hex[1], 16);
    const inv = 16777215 ^ v;
    return `#${inv.toString(16).padStart(6, "0")}`;
  }
  const shortHex = /^#([0-9a-f]{3})$/i.exec(color);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("").map((c) => parseInt(c + c, 16));
    const toHex = (v) => (255 - v).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  if (rgba) {
    const r = 255 - Math.min(255, parseInt(rgba[1], 10));
    const g = 255 - Math.min(255, parseInt(rgba[2], 10));
    const b = 255 - Math.min(255, parseInt(rgba[3], 10));
    return rgba[4] !== void 0 ? `rgba(${r},${g},${b},${rgba[4]})` : `rgb(${r},${g},${b})`;
  }
  return color;
}
var EMR_HEADER = 1;
var EMR_POLYBEZIER = 2;
var EMR_POLYGON = 3;
var EMR_POLYLINE = 4;
var EMR_POLYBEZIERTO = 5;
var EMR_POLYLINETO = 6;
var EMR_POLYPOLYLINE = 7;
var EMR_POLYPOLYGON = 8;
var EMR_SETWINDOWEXTEX = 9;
var EMR_SETWINDOWORGEX = 10;
var EMR_SETVIEWPORTEXTEX = 11;
var EMR_SETVIEWPORTORGEX = 12;
var EMR_SETBRUSHORGEX = 13;
var EMR_EOF = 14;
var EMR_SETPIXELV = 15;
var EMR_SETMAPMODE = 17;
var EMR_SETBKMODE = 18;
var EMR_SETPOLYFILLMODE = 19;
var EMR_SETROP2 = 20;
var EMR_SETSTRETCHBLTMODE = 21;
var R2_BLACK = 1;
var R2_NOTMERGEPEN = 2;
var R2_MASKNOTPEN = 3;
var R2_NOTCOPYPEN = 4;
var R2_MASKPENNOT = 5;
var R2_NOT = 6;
var R2_XORPEN = 7;
var R2_NOTMASKPEN = 8;
var R2_MASKPEN = 9;
var R2_NOTXORPEN = 10;
var R2_NOP = 11;
var R2_MERGENOTPEN = 12;
var R2_MERGEPENNOT = 14;
var R2_MERGEPEN = 15;
var R2_WHITE = 16;
var MAX_CANVAS_DIMENSION = 8192;
var MAX_RECORDS_DEFAULT = 2e5;
var MAX_RECORDS_EMFPLUS_DEFAULT = 5e5;
var EMR_SETTEXTALIGN = 22;
var EMR_SETTEXTCOLOR = 24;
var EMR_SETBKCOLOR = 25;
var EMR_OFFSETCLIPRGN = 26;
var EMR_MOVETOEX = 27;
var EMR_SETMETARGN = 28;
var EMR_EXCLUDECLIPRECT = 29;
var EMR_INTERSECTCLIPRECT = 30;
var EMR_SCALEVIEWPORTEXTEX = 31;
var EMR_SCALEWINDOWEXTEX = 32;
var EMR_SAVEDC = 33;
var EMR_RESTOREDC = 34;
var EMR_SETWORLDTRANSFORM = 35;
var EMR_MODIFYWORLDTRANSFORM = 36;
var EMR_SELECTOBJECT = 37;
var EMR_CREATEPEN = 38;
var EMR_CREATEBRUSHINDIRECT = 39;
var EMR_DELETEOBJECT = 40;
var EMR_ELLIPSE = 42;
var EMR_RECTANGLE = 43;
var EMR_ROUNDRECT = 44;
var EMR_ARC = 45;
var EMR_CHORD = 46;
var EMR_PIE = 47;
var EMR_LINETO = 54;
var EMR_ARCTO = 55;
var EMR_SETMITERLIMIT = 58;
var EMR_BEGINPATH = 59;
var EMR_ENDPATH = 60;
var EMR_CLOSEFIGURE = 61;
var EMR_FILLPATH = 62;
var EMR_STROKEANDFILLPATH = 63;
var EMR_STROKEPATH = 64;
var EMR_SELECTCLIPPATH = 67;
var EMR_COMMENT = 70;
var EMR_EXTSELECTCLIPRGN = 75;
var EMR_BITBLT = 76;
var EMR_STRETCHDIBITS = 81;
var EMR_EXTCREATEFONTINDIRECTW = 82;
var EMR_EXTTEXTOUTW = 84;
var EMR_ALPHABLEND = 114;
var EMR_GRADIENTFILL = 118;
var EMR_POLYBEZIER16 = 85;
var EMR_POLYGON16 = 86;
var EMR_POLYLINE16 = 87;
var EMR_POLYBEZIERTO16 = 88;
var EMR_POLYLINETO16 = 89;
var EMR_POLYPOLYGON16 = 91;
var EMR_EXTCREATEPEN = 95;
var EMR_CREATEMONOBRUSH = 93;
var EMR_CREATEDIBPATTERNBRUSHPT = 94;
var EMR_SETICMMODE = 98;
var EMR_SETLAYOUT = 115;
var STOCK_OBJECT_BASE = 2147483648;
var EMFPLUS_SIGNATURE = 726027589;
var EMR_COMMENT_PUBLIC_SIGNATURE = 1128875079;
var EMFPLUS_HEADER = 16385;
var EMFPLUS_ENDOFFILE = 16386;
var EMFPLUS_GETDC = 16388;
var EMFPLUS_OBJECT = 16392;
var EMFPLUS_FILLRECTS = 16394;
var EMFPLUS_DRAWRECTS = 16395;
var EMFPLUS_FILLPOLYGON = 16396;
var EMFPLUS_DRAWLINES = 16397;
var EMFPLUS_FILLELLIPSE = 16398;
var EMFPLUS_DRAWELLIPSE = 16399;
var EMFPLUS_FILLPIE = 16400;
var EMFPLUS_DRAWPIE = 16401;
var EMFPLUS_DRAWARC = 16402;
var EMFPLUS_FILLPATH = 16404;
var EMFPLUS_DRAWPATH = 16405;
var EMFPLUS_DRAWIMAGE = 16410;
var EMFPLUS_DRAWIMAGEPOINTS = 16411;
var EMFPLUS_DRAWSTRING = 16412;
var EMFPLUS_SETANTIALIASMODE = 16414;
var EMFPLUS_SETTEXTRENDERINGHINT = 16415;
var EMFPLUS_SETINTERPOLATIONMODE = 16417;
var EMFPLUS_SETPIXELOFFSETMODE = 16418;
var EMFPLUS_SETCOMPOSITINGQUALITY = 16420;
var EMFPLUS_SAVE = 16421;
var EMFPLUS_RESTORE = 16422;
var EMFPLUS_BEGINCONTAINERNOPARAMS = 16424;
var EMFPLUS_ENDCONTAINER = 16425;
var EMFPLUS_SETWORLDTRANSFORM = 16426;
var EMFPLUS_RESETWORLDTRANSFORM = 16427;
var EMFPLUS_MULTIPLYWORLDTRANSFORM = 16428;
var EMFPLUS_TRANSLATEWORLDTRANSFORM = 16429;
var EMFPLUS_SCALEWORLDTRANSFORM = 16430;
var EMFPLUS_ROTATEWORLDTRANSFORM = 16431;
var EMFPLUS_SETPAGETRANSFORM = 16432;
var EMFPLUS_RESETCLIP = 16433;
var EMFPLUS_SETCLIPRECT = 16434;
var EMFPLUS_SETCLIPPATH = 16435;
var EMFPLUS_SETCLIPREGION = 16436;
var EMFPLUS_DRAWDRIVERSTRING = 16438;
var EMFPLUS_OFFSETCLIP = 16437;
var EMFPLUS_OBJECTTYPE_BRUSH = 1;
var EMFPLUS_OBJECTTYPE_PEN = 2;
var EMFPLUS_OBJECTTYPE_PATH = 3;
var EMFPLUS_OBJECTTYPE_IMAGEATTRIBUTES = 8;
var EMFPLUS_OBJECTTYPE_IMAGE = 5;
var EMFPLUS_OBJECTTYPE_FONT = 6;
var EMFPLUS_OBJECTTYPE_STRINGFORMAT = 7;
var EMFPLUS_OBJECTTYPE_REGION = 4;
var EMFPLUS_BRUSHTYPE_SOLID = 0;
var EMFPLUS_BRUSHTYPE_HATCHFILL = 1;
var EMFPLUS_BRUSHTYPE_PATHGRADIENT = 3;
var EMFPLUS_BRUSHTYPE_LINEARGRADIENT = 4;
var META_EOF = 0;
var META_SETBKCOLOR = 513;
var META_SETBKMODE = 258;
var META_SETROP2 = 260;
var META_SETPOLYFILLMODE = 262;
var META_SETTEXTCOLOR = 521;
var META_SETTEXTALIGN = 302;
var META_SETWINDOWORG = 523;
var META_SETWINDOWEXT = 524;
var META_MOVETO = 532;
var META_LINETO = 531;
var META_RECTANGLE = 1051;
var META_ROUNDRECT = 1564;
var META_ELLIPSE = 1048;
var META_ARC = 2071;
var META_PIE = 2074;
var META_CHORD = 2096;
var META_POLYGON = 804;
var META_POLYLINE = 805;
var META_SELECTOBJECT = 301;
var META_DELETEOBJECT = 496;
var META_CREATEPENINDIRECT = 762;
var META_CREATEBRUSHINDIRECT = 764;
var META_CREATEFONTINDIRECT = 763;
var META_TEXTOUT = 1313;
var META_EXTTEXTOUT = 2610;
var META_SAVEDC = 30;
var META_RESTOREDC = 295;
var META_POLYPOLYGON = 1336;
var META_PATBLT = 1565;
var META_DIBBITBLT = 2368;
var META_DIBSTRETCHBLT = 2881;
var META_STRETCHDIB = 3907;
var META_DIBCREATEPATTERNBRUSH = 322;
var META_CREATEPATTERNBRUSH = 505;
var META_CREATEPALETTE = 247;
var META_CREATEREGION = 1791;
var emfLog = (...args) => {
};
var emfWarn = (...args) => {
};
var DEFAULT_DPI_SCALE = 1;
function createCanvas(width, height, maxWidth, maxHeight, dpiScale = DEFAULT_DPI_SCALE, maxCanvasDimension = MAX_CANVAS_DIMENSION) {
  const effectiveScale = Math.max(1, Math.min(dpiScale, 4));
  let w = Math.round(width * effectiveScale);
  let h = Math.round(height * effectiveScale);
  let scaleX = effectiveScale;
  let scaleY = effectiveScale;
  if (maxWidth && w > maxWidth) {
    const factor = maxWidth / w;
    w = maxWidth;
    h = Math.round(h * factor);
    scaleX *= factor;
    scaleY *= factor;
  }
  if (maxHeight && h > maxHeight) {
    const factor = maxHeight / h;
    w = Math.round(w * factor);
    h = maxHeight;
    scaleX *= factor;
    scaleY *= factor;
  }
  const dimCap = Math.max(1, Math.floor(maxCanvasDimension));
  const clampedW = Math.max(1, Math.min(w, dimCap));
  const clampedH = Math.max(1, Math.min(h, dimCap));
  if (clampedW !== w || clampedH !== h) {
    console.warn(
      `[emf-converter] Canvas size clamped from ${w}\xD7${h} to ${clampedW}\xD7${clampedH}. Output may lose detail.`
    );
  }
  w = clampedW;
  h = clampedH;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      emfLog(
        `createCanvas: using OffscreenCanvas ${w}\xD7${h}, scale=(${scaleX.toFixed(3)},${scaleY.toFixed(3)})`
      );
      const canvas2 = new OffscreenCanvas(w, h);
      const ctx2 = canvas2.getContext("2d");
      if (!ctx2) {
        emfWarn('createCanvas: OffscreenCanvas.getContext("2d") returned null');
        return null;
      }
      return { canvas: canvas2, ctx: ctx2, scaleX, scaleY };
    }
    if (typeof document === "undefined") {
      emfWarn("createCanvas: no OffscreenCanvas and no document \u2014 cannot create canvas");
      return null;
    }
    emfLog(
      `createCanvas: using HTMLCanvasElement ${w}\xD7${h}, scale=(${scaleX.toFixed(3)},${scaleY.toFixed(3)})`
    );
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      emfWarn('createCanvas: HTMLCanvasElement.getContext("2d") returned null');
      return null;
    }
    return { canvas, ctx, scaleX, scaleY };
  } catch (err) {
    return null;
  }
}
function createTempCanvas(width, height) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  width = Math.max(1, Math.min(Math.floor(width), MAX_CANVAS_DIMENSION));
  height = Math.max(1, Math.min(Math.floor(height), MAX_CANVAS_DIMENSION));
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    return { canvas, ctx };
  }
  return null;
}
function rop2Paint(rop2) {
  switch (rop2) {
    case R2_BLACK:
      return { gco: "source-over", colorTransform: "black", exact: true };
    case R2_WHITE:
      return { gco: "source-over", colorTransform: "white", exact: true };
    case R2_NOP:
      return { gco: "source-over", colorTransform: "skip", exact: true };
    case R2_NOTCOPYPEN:
      return { gco: "source-over", colorTransform: "invert", exact: true };
    case R2_NOT:
      return { gco: "difference", colorTransform: "white", exact: true };
    case R2_XORPEN:
    case R2_MASKPENNOT:
      return { gco: "difference", colorTransform: "none", exact: false };
    case R2_NOTXORPEN:
      return { gco: "difference", colorTransform: "invert", exact: false };
    case R2_MASKPEN:
      return { gco: "darken", colorTransform: "none", exact: false };
    case R2_MASKNOTPEN:
    case R2_NOTMERGEPEN:
      return { gco: "darken", colorTransform: "invert", exact: false };
    case R2_MERGEPEN:
    case R2_MERGEPENNOT:
      return { gco: "lighten", colorTransform: "none", exact: false };
    case R2_MERGENOTPEN:
    case R2_NOTMASKPEN:
      return { gco: "lighten", colorTransform: "invert", exact: false };
    default:
      return { gco: "source-over", colorTransform: "none", exact: true };
  }
}
function rop2TransformColor(color, transform) {
  switch (transform) {
    case "invert":
      return invertCssColor(color);
    case "black":
      return "#000000";
    case "white":
      return "#ffffff";
    case "skip":
      return "rgba(0,0,0,0)";
    default:
      return color;
  }
}
function applyPen(ctx, state) {
  const paint = rop2Paint(state.rop2);
  ctx.globalCompositeOperation = paint.gco;
  if (state.penStyle === 5) {
    ctx.strokeStyle = "rgba(0,0,0,0)";
    ctx.lineWidth = 0;
    return;
  }
  ctx.strokeStyle = rop2TransformColor(state.penColor, paint.colorTransform);
  ctx.lineWidth = Math.max(state.penWidth * (state.devScale ?? 1), 1);
  switch (state.penStyle) {
    case 1:
      ctx.setLineDash([8, 4]);
      break;
    case 2:
      ctx.setLineDash([2, 2]);
      break;
    case 3:
      ctx.setLineDash([8, 4, 2, 4]);
      break;
    case 4:
      ctx.setLineDash([8, 4, 2, 4, 2, 4]);
      break;
    default:
      ctx.setLineDash([]);
      break;
  }
}
function applyBrush(ctx, state) {
  const paint = rop2Paint(state.rop2);
  ctx.globalCompositeOperation = paint.gco;
  if (state.brushStyle === 1) {
    ctx.fillStyle = "rgba(0,0,0,0)";
    return;
  }
  if (state.brushPattern) {
    ctx.fillStyle = state.brushPattern;
    return;
  }
  ctx.fillStyle = rop2TransformColor(state.brushColor, paint.colorTransform);
}
function cssFontWeight(weight) {
  if (!weight || weight === 400) {
    return "";
  }
  const rounded = Math.round(weight / 100) * 100;
  if (rounded === 700) {
    return "bold";
  }
  if (rounded >= 100 && rounded <= 900) {
    return String(rounded);
  }
  return weight >= 700 ? "bold" : "";
}
var GENERIC_CSS_FAMILIES = /* @__PURE__ */ new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui"
]);
function mapFontFamily(face, map) {
  const cleaned = (face || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const resolved = map?.[cleaned.toLowerCase()] ?? cleaned;
  if (!resolved) {
    return "sans-serif";
  }
  if (GENERIC_CSS_FAMILIES.has(resolved) || /^["']/.test(resolved)) {
    return resolved;
  }
  return `"${resolved.replace(/["\\]/g, "")}", sans-serif`;
}
var GDI_FONT_METRICS = /* @__PURE__ */ new Map([
  ["yu gothic", [1.292, 0.306]],
  ["yu gothic ui", [1.292, 0.306]],
  ["yu gothic medium", [1.306, 0.345]],
  ["yu gothic light", [1.292, 0.306]],
  ["\u6E38\u30B4\u30B7\u30C3\u30AF", [1.292, 0.306]],
  ["\u6E38\u30B4\u30B7\u30C3\u30AF medium", [1.306, 0.345]],
  ["\u6E38\u30B4\u30B7\u30C3\u30AF light", [1.292, 0.306]],
  ["yu mincho", [1.295, 0.367]],
  ["\u6E38\u660E\u671D", [1.295, 0.367]],
  ["meiryo", [1.07, 0.234]],
  ["meiryo ui", [1.07, 0.234]],
  ["\u30E1\u30A4\u30EA\u30AA", [1.07, 0.234]],
  ["ms pgothic", [0.859, 0.141]],
  ["ms gothic", [0.859, 0.141]],
  ["ms ui gothic", [0.859, 0.141]],
  ["ms pmincho", [0.859, 0.141]],
  ["ms mincho", [0.859, 0.141]],
  ["ms p\u30B4\u30B7\u30C3\u30AF", [0.859, 0.141]],
  ["ms \u30B4\u30B7\u30C3\u30AF", [0.859, 0.141]],
  ["ms p\u660E\u671D", [0.859, 0.141]],
  ["ms \u660E\u671D", [0.859, 0.141]],
  ["malgun gothic", [1.087, 0.274]],
  ["\uB9D1\uC740 \uACE0\uB515", [1.087, 0.274]],
  ["microsoft yahei", [1.058, 0.262]],
  ["microsoft yahei ui", [1.058, 0.262]],
  ["\u5FAE\u8F6F\u96C5\u9ED1", [1.058, 0.262]],
  ["microsoft jhenghei", [1.058, 0.262]],
  ["\u5FAE\u8EDF\u6B63\u9ED1\u9AD4", [1.058, 0.262]],
  ["simsun", [0.859, 0.141]],
  ["\u5B8B\u4F53", [0.859, 0.141]],
  ["simhei", [0.859, 0.141]],
  ["\u9ED1\u4F53", [0.859, 0.141]],
  ["segoe ui", [1.079, 0.251]]
]);
function gdiFontMetrics(face) {
  const key = (face || "").replace(/[\u0000-\u001F\u007F]/g, "").normalize("NFKC").trim().toLowerCase();
  return GDI_FONT_METRICS.get(key) ?? null;
}
function fontSizePx(state, scale = 1) {
  return Math.max(Math.abs(state.fontHeight) * Math.abs(scale || 1), 8);
}
function applyFont(ctx, state, scale = 1) {
  const italic = state.fontItalic ? "italic " : "";
  const weight = cssFontWeight(state.fontWeight);
  const weightPart = weight ? `${weight} ` : "";
  const size = fontSizePx(state, scale);
  const family = mapFontFamily(state.fontFamily, state.fontFamilyMap);
  ctx.font = `${italic}${weightPart}${size}px ${family}`;
}
var SYMBOL_FONT_RE = /^(wingdings|webdings|symbol$|monotype sorts|zapf ?dingbats|marlett)/i;
function mapSymbolText(family, text) {
  if (!SYMBOL_FONT_RE.test((family || "").trim())) {
    return text;
  }
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c >= 32 && c <= 255 ? String.fromCharCode(61440 + c) : text[i];
  }
  return out;
}
function dibAverageColor(view, off, end) {
  try {
    const hdrSize = view.getUint32(off, true);
    const bitCount = view.getUint16(off + 14, true);
    let r = 0, g = 0, b = 0, n = 0;
    if (bitCount <= 8) {
      const clrUsed = view.getUint32(off + 32, true) || 1 << bitCount;
      let p = off + hdrSize;
      for (let i = 0; i < clrUsed && p + 4 <= end; i++, p += 4) {
        b += view.getUint8(p);
        g += view.getUint8(p + 1);
        r += view.getUint8(p + 2);
        n++;
      }
    } else {
      for (let p = off + hdrSize; p + 3 <= end && n < 1024; p += 3) {
        b += view.getUint8(p);
        g += view.getUint8(p + 1);
        r += view.getUint8(p + 2);
        n++;
      }
    }
    if (!n) {
      return "#c0c0c0";
    }
    const h = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  } catch {
    return "#c0c0c0";
  }
}
function drawWmfText(ctx, state, text, x, y) {
  const mapped = mapSymbolText(state.fontFamily, text);
  const align = state.textAlign || 0;
  const prevAlign = ctx.textAlign;
  const prevBaseline = ctx.textBaseline;
  ctx.textAlign = (align & 6) === 6 ? "center" : align & 2 ? "right" : "left";
  ctx.textBaseline = (align & 24) === 24 ? "alphabetic" : align & 8 ? "bottom" : "top";
  const esc = state.fontEscapement || 0;
  if (esc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-esc / 10 * Math.PI / 180);
    ctx.fillText(mapped, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(mapped, x, y);
  }
  ctx.textAlign = prevAlign;
  ctx.textBaseline = prevBaseline;
}
function drawTextDecorations(ctx, state, x, y, width, scale = 1) {
  if (!state.fontUnderline && !state.fontStrikeOut) {
    return;
  }
  const size = fontSizePx(state, scale);
  const thickness = Math.max(1, Math.round(size / 14));
  const prevFill = ctx.fillStyle;
  ctx.fillStyle = state.textColor;
  if (state.fontUnderline) {
    ctx.fillRect(x, y + Math.round(size * 0.12), width, thickness);
  }
  if (state.fontStrikeOut) {
    ctx.fillRect(x, y - Math.round(size * 0.3), width, thickness);
  }
  ctx.fillStyle = prevFill;
}
function readUtf16LE(view, offset, charCount) {
  if (charCount <= 0) {
    return "";
  }
  const maxBytes = view.byteLength - offset;
  if (maxBytes <= 0) {
    return "";
  }
  const usableChars = Math.min(charCount, Math.floor(maxBytes / 2));
  if (usableChars <= 0) {
    return "";
  }
  let decoded;
  try {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, usableChars * 2);
    decoded = new TextDecoder("utf-16le").decode(bytes);
  } catch {
    const chars = [];
    for (let i = 0; i < usableChars; i++) {
      const code = view.getUint16(offset + i * 2, true);
      if (code === 0) {
        return chars.join("");
      }
      chars.push(String.fromCharCode(code));
    }
    return chars.join("");
  }
  const nul = decoded.indexOf(String.fromCharCode(0));
  return nul === -1 ? decoded : decoded.slice(0, nul);
}
function getStockObject(index) {
  switch (index) {
    case 0:
      return { kind: "brush", style: 0, color: "#ffffff" };
    case 1:
      return { kind: "brush", style: 0, color: "#c0c0c0" };
    case 2:
      return { kind: "brush", style: 0, color: "#808080" };
    case 3:
      return { kind: "brush", style: 0, color: "#404040" };
    case 4:
      return { kind: "brush", style: 0, color: "#000000" };
    case 5:
      return { kind: "brush", style: 1, color: "#000000" };
    case 6:
      return { kind: "pen", style: 0, widthX: 1, color: "#ffffff" };
    case 7:
      return { kind: "pen", style: 0, widthX: 1, color: "#000000" };
    case 8:
      return { kind: "pen", style: 5, widthX: 0, color: "#000000" };
    case 10:
    case 11:
      return {
        kind: "font",
        height: 12,
        weight: 400,
        italic: false,
        underline: false,
        strikeOut: false,
        family: "monospace"
      };
    case 12:
    case 13:
    case 14:
    case 17:
      return {
        kind: "font",
        height: 12,
        weight: 400,
        italic: false,
        underline: false,
        strikeOut: false,
        family: "sans-serif"
      };
    default:
      return null;
  }
}
async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function exportCanvasToPngDataUrl(canvas) {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    emfLog(
      `exportCanvasToPngDataUrl: using OffscreenCanvas.convertToBlob (${canvas.width}\xD7${canvas.height})`
    );
    const blob = await canvas.convertToBlob({ type: "image/png" });
    emfLog(`exportCanvasToPngDataUrl: blob size=${blob.size} bytes, type=${blob.type}`);
    return blobToDataUrl(blob);
  }
  if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
    emfLog(
      `exportCanvasToPngDataUrl: using HTMLCanvasElement.toDataURL (${canvas.width}\xD7${canvas.height})`
    );
    return canvas.toDataURL("image/png");
  }
  return null;
}
function parseEmfHeader(view) {
  emfLog("parseEmfHeader: byteLength =", view.byteLength);
  if (view.byteLength < 88) {
    return null;
  }
  const recordType = view.getUint32(0, true);
  if (recordType !== EMR_HEADER) {
    return null;
  }
  const boundsLeft = view.getInt32(8, true);
  const boundsTop = view.getInt32(12, true);
  const boundsRight = view.getInt32(16, true);
  const boundsBottom = view.getInt32(20, true);
  const frameLeft = view.getInt32(24, true);
  const frameTop = view.getInt32(28, true);
  const frameRight = view.getInt32(32, true);
  const frameBottom = view.getInt32(36, true);
  const frameW = frameRight - frameLeft;
  const frameH = frameBottom - frameTop;
  const deviceCx = view.getInt32(72, true);
  const deviceCy = view.getInt32(76, true);
  const mmCx = view.getInt32(80, true);
  const mmCy = view.getInt32(84, true);
  return {
    bounds: {
      left: boundsLeft,
      top: boundsTop,
      right: boundsRight,
      bottom: boundsBottom
    },
    frameLeft,
    frameTop,
    frameW,
    frameH,
    deviceCx,
    deviceCy,
    mmCx,
    mmCy
  };
}
function emfFrameDeviceBounds(header) {
  const { frameLeft, frameTop, frameW, frameH, deviceCx, deviceCy, mmCx, mmCy } = header;
  if (!(frameW > 0 && frameH > 0 && deviceCx > 0 && deviceCy > 0 && mmCx > 0 && mmCy > 0)) {
    return null;
  }
  const unitsPerDevX = mmCx * 100 / deviceCx;
  const unitsPerDevY = mmCy * 100 / deviceCy;
  return {
    deviceRect: {
      left: frameLeft / unitsPerDevX,
      top: frameTop / unitsPerDevY,
      right: (frameLeft + frameW) / unitsPerDevX,
      bottom: (frameTop + frameH) / unitsPerDevY
    },
    // canvas size at 96 dpi (createCanvas applies dpiScale on top)
    pxW: Math.max(1, Math.round(frameW / 2540 * 96)),
    pxH: Math.max(1, Math.round(frameH / 2540 * 96))
  };
}
function emfBoundsCoverFrame(bounds, frameRect) {
  const tolX = (frameRect.right - frameRect.left) * 0.01;
  const tolY = (frameRect.bottom - frameRect.top) * 0.01;
  return Math.abs(bounds.left - frameRect.left) <= tolX && Math.abs(bounds.right - frameRect.right) <= tolX && Math.abs(bounds.top - frameRect.top) <= tolY && Math.abs(bounds.bottom - frameRect.bottom) <= tolY;
}
function getRenderableEmfBounds(header) {
  const boundsW = header.bounds.right - header.bounds.left;
  const boundsH = header.bounds.bottom - header.bounds.top;
  if (boundsW > 0 && boundsH > 0) {
    return header.bounds;
  }
  if (header.frameW > 0 && header.frameH > 0) {
    emfLog(
      `getRenderableEmfBounds: bounds invalid (${boundsW}\xD7${boundsH}), falling back to frame ${header.frameW}\xD7${header.frameH}`
    );
    return { left: 0, top: 0, right: header.frameW, bottom: header.frameH };
  }
  return null;
}
function parseWmfHeader(view) {
  if (view.byteLength < 22) {
    return null;
  }
  const magic = view.getUint32(0, true);
  let headerOffset = 0;
  let boundsLeft = 0;
  let boundsTop = 0;
  let boundsRight = 800;
  let boundsBottom = 600;
  let unitsPerInch = 96;
  if (magic === 2596720087) {
    boundsLeft = view.getInt16(6, true);
    boundsTop = view.getInt16(8, true);
    boundsRight = view.getInt16(10, true);
    boundsBottom = view.getInt16(12, true);
    unitsPerInch = view.getUint16(14, true) || 96;
    headerOffset = 22;
  }
  if (headerOffset + 18 > view.byteLength) {
    return null;
  }
  const fileType = view.getUint16(headerOffset, true);
  if (fileType !== 1 && fileType !== 2) {
    return null;
  }
  const headerSize = view.getUint16(headerOffset + 2, true) * 2;
  const maxRecordSize = view.getUint32(headerOffset + 8, true) * 2;
  if (headerOffset === 0) {
    let off = headerSize;
    let org = null;
    let ext = null;
    for (let i = 0; i < 64 && off + 6 <= view.byteLength && (!org || !ext); i++) {
      const sizeWords = view.getUint32(off, true);
      const fn = view.getUint16(off + 4, true);
      if (fn === META_EOF || sizeWords < 3 || off + sizeWords * 2 > view.byteLength) {
        break;
      }
      if (fn === META_SETWINDOWORG && !org && sizeWords >= 5) {
        org = { y: view.getInt16(off + 6, true), x: view.getInt16(off + 8, true) };
      }
      if (fn === META_SETWINDOWEXT && !ext && sizeWords >= 5) {
        ext = { cy: view.getInt16(off + 6, true), cx: view.getInt16(off + 8, true) };
      }
      off += sizeWords * 2;
    }
    if (ext && ext.cx && ext.cy) {
      boundsLeft = org ? org.x : 0;
      boundsTop = org ? org.y : 0;
      boundsRight = boundsLeft + Math.abs(ext.cx);
      boundsBottom = boundsTop + Math.abs(ext.cy);
    }
  }
  return {
    headerSize: headerOffset + headerSize,
    maxRecordSize,
    boundsLeft,
    boundsTop,
    boundsRight,
    boundsBottom,
    unitsPerInch
  };
}
function gmx(r, x) {
  const wt = r.state.worldTransform;
  const px = wt[0] * x + wt[4];
  if (r.useMappingMode) {
    const dev = (px - r.windowOrg.x) / (r.windowExt.cx || 1) * (r.viewportExt.cx || 1) + r.viewportOrg.x;
    return (dev - r.bounds.left) * r.sx;
  }
  return (px - r.bounds.left) * r.sx;
}
function gmy(r, y) {
  const wt = r.state.worldTransform;
  const py = wt[3] * y + wt[5];
  if (r.useMappingMode) {
    const dev = (py - r.windowOrg.y) / (r.windowExt.cy || 1) * (r.viewportExt.cy || 1) + r.viewportOrg.y;
    return (dev - r.bounds.top) * r.sy;
  }
  return (py - r.bounds.top) * r.sy;
}
function gmw(r, w) {
  const pw = r.state.worldTransform[0] * w;
  if (r.useMappingMode) {
    return pw / (r.windowExt.cx || 1) * (r.viewportExt.cx || 1) * r.sx;
  }
  return pw * r.sx;
}
function gmh(r, h) {
  const ph = r.state.worldTransform[3] * h;
  if (r.useMappingMode) {
    return ph / (r.windowExt.cy || 1) * (r.viewportExt.cy || 1) * r.sy;
  }
  return ph * r.sy;
}
function activateGdiMappingMode(r) {
  r.useMappingMode = true;
}
function handleSetPixelV(rCtx, dataOff, recSize) {
  const { ctx, view } = rCtx;
  if (recSize >= 20) {
    const x = view.getInt32(dataOff, true);
    const y = view.getInt32(dataOff + 4, true);
    const color = readColorRef(view, dataOff + 8);
    ctx.fillStyle = color;
    ctx.fillRect(gmx(rCtx, x), gmy(rCtx, y), 1, 1);
  }
  return true;
}
function handleMoveToEx(rCtx, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize >= 16) {
    state.curX = view.getInt32(dataOff, true);
    state.curY = view.getInt32(dataOff + 4, true);
    if (inPath) {
      ctx.moveTo(gmx(rCtx, state.curX), gmy(rCtx, state.curY));
    }
  }
  return true;
}
function handleLineTo(rCtx, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize >= 16) {
    const lx = view.getInt32(dataOff, true);
    const ly = view.getInt32(dataOff + 4, true);
    if (inPath) {
      ctx.lineTo(gmx(rCtx, lx), gmy(rCtx, ly));
    } else {
      applyPen(ctx, state);
      ctx.beginPath();
      ctx.moveTo(gmx(rCtx, state.curX), gmy(rCtx, state.curY));
      ctx.lineTo(gmx(rCtx, lx), gmy(rCtx, ly));
      ctx.stroke();
    }
    state.curX = lx;
    state.curY = ly;
  }
  return true;
}
function handleRectangle(rCtx, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize >= 24) {
    const l = view.getInt32(dataOff, true);
    const t = view.getInt32(dataOff + 4, true);
    const r = view.getInt32(dataOff + 8, true);
    const b = view.getInt32(dataOff + 12, true);
    if (inPath) {
      ctx.rect(gmx(rCtx, l), gmy(rCtx, t), gmw(rCtx, r - l), gmh(rCtx, b - t));
    } else {
      applyBrush(ctx, state);
      ctx.fillRect(gmx(rCtx, l), gmy(rCtx, t), gmw(rCtx, r - l), gmh(rCtx, b - t));
      applyPen(ctx, state);
      ctx.strokeRect(gmx(rCtx, l), gmy(rCtx, t), gmw(rCtx, r - l), gmh(rCtx, b - t));
    }
  }
  return true;
}
function handleRoundRect(rCtx, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize >= 32) {
    const l = view.getInt32(dataOff, true);
    const t = view.getInt32(dataOff + 4, true);
    const r = view.getInt32(dataOff + 8, true);
    const b = view.getInt32(dataOff + 12, true);
    const rw = Math.abs(gmw(rCtx, view.getInt32(dataOff + 16, true))) / 2;
    const rh = Math.abs(gmh(rCtx, view.getInt32(dataOff + 20, true))) / 2;
    const x1 = gmx(rCtx, l);
    const y1 = gmy(rCtx, t);
    const w = gmw(rCtx, r - l);
    const h = gmh(rCtx, b - t);
    const drawRoundRect = () => {
      const radius = Math.min(rw, rh, w / 2, h / 2);
      ctx.moveTo(x1 + radius, y1);
      ctx.lineTo(x1 + w - radius, y1);
      ctx.arcTo(x1 + w, y1, x1 + w, y1 + radius, radius);
      ctx.lineTo(x1 + w, y1 + h - radius);
      ctx.arcTo(x1 + w, y1 + h, x1 + w - radius, y1 + h, radius);
      ctx.lineTo(x1 + radius, y1 + h);
      ctx.arcTo(x1, y1 + h, x1, y1 + h - radius, radius);
      ctx.lineTo(x1, y1 + radius);
      ctx.arcTo(x1, y1, x1 + radius, y1, radius);
      ctx.closePath();
    };
    if (inPath) {
      drawRoundRect();
    } else {
      ctx.beginPath();
      drawRoundRect();
      applyBrush(ctx, state);
      ctx.fill();
      applyPen(ctx, state);
      ctx.stroke();
    }
  }
  return true;
}
function handleEllipse(rCtx, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize >= 24) {
    const l = view.getInt32(dataOff, true);
    const t = view.getInt32(dataOff + 4, true);
    const r = view.getInt32(dataOff + 8, true);
    const b = view.getInt32(dataOff + 12, true);
    const cx = gmx(rCtx, (l + r) / 2);
    const cy = gmy(rCtx, (t + b) / 2);
    const rx = Math.abs(gmw(rCtx, r - l)) / 2;
    const ry = Math.abs(gmh(rCtx, b - t)) / 2;
    if (inPath) {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      applyBrush(ctx, state);
      ctx.fill();
      applyPen(ctx, state);
      ctx.stroke();
    }
  }
  return true;
}
function handleArcFamily(rCtx, recType, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize >= 40) {
    const l = view.getInt32(dataOff, true);
    const t = view.getInt32(dataOff + 4, true);
    const r = view.getInt32(dataOff + 8, true);
    const b = view.getInt32(dataOff + 12, true);
    const startX = view.getInt32(dataOff + 16, true);
    const startY = view.getInt32(dataOff + 20, true);
    const endX = view.getInt32(dataOff + 24, true);
    const endY = view.getInt32(dataOff + 28, true);
    const cxA = (l + r) / 2;
    const cyA = (t + b) / 2;
    const rx = Math.abs(r - l) / 2;
    const ry = Math.abs(b - t) / 2;
    const startAngle = Math.atan2((startY - cyA) / (ry || 1), (startX - cxA) / (rx || 1));
    const endAngle = Math.atan2((endY - cyA) / (ry || 1), (endX - cxA) / (rx || 1));
    const mcx = gmx(rCtx, cxA);
    const mcy = gmy(rCtx, cyA);
    const mrx = Math.abs(gmw(rCtx, rx));
    const mry = Math.abs(gmh(rCtx, ry));
    const isArcTo = recType === EMR_ARCTO;
    const needsFill = recType === EMR_PIE || recType === EMR_CHORD;
    if (!inPath) {
      ctx.beginPath();
    }
    if (recType === EMR_PIE) {
      ctx.moveTo(mcx, mcy);
    }
    if (isArcTo) {
      ctx.lineTo(mcx + mrx * Math.cos(startAngle), mcy + mry * Math.sin(startAngle));
    }
    ctx.ellipse(mcx, mcy, mrx, mry, 0, startAngle, endAngle, false);
    if (recType === EMR_PIE || recType === EMR_CHORD) {
      ctx.closePath();
    }
    if (!inPath) {
      if (needsFill) {
        applyBrush(ctx, state);
        ctx.fill();
      }
      applyPen(ctx, state);
      ctx.stroke();
    }
    if (isArcTo) {
      state.curX = endX;
      state.curY = endY;
    }
  }
  return true;
}
function handleEmfGdiShapeRecord(rCtx, recType, dataOff, recSize) {
  switch (recType) {
    case EMR_SETPIXELV:
      return handleSetPixelV(rCtx, dataOff, recSize);
    case EMR_MOVETOEX:
      return handleMoveToEx(rCtx, dataOff, recSize);
    case EMR_LINETO:
      return handleLineTo(rCtx, dataOff, recSize);
    case EMR_RECTANGLE:
      return handleRectangle(rCtx, dataOff, recSize);
    case EMR_ROUNDRECT:
      return handleRoundRect(rCtx, dataOff, recSize);
    case EMR_ELLIPSE:
      return handleEllipse(rCtx, dataOff, recSize);
    case EMR_ARC:
    case EMR_ARCTO:
    case EMR_CHORD:
    case EMR_PIE:
      return handleArcFamily(rCtx, recType, dataOff, recSize);
    default:
      return false;
  }
}
var CLIP_HUGE = 1 << 24;
function rectClipShape(x, y, w, h) {
  return { cmds: [{ op: "rect", x, y, w, h }], fillRule: "nonzero", simple: true };
}
function rectsClipShape(rects) {
  return {
    cmds: rects.map((r) => ({ op: "rect", x: r.x, y: r.y, w: r.w, h: r.h })),
    fillRule: "nonzero",
    simple: true
  };
}
function emptyClipShape() {
  return { cmds: [{ op: "rect", x: 0, y: 0, w: 0, h: 0 }], fillRule: "nonzero", simple: true };
}
function translateClipShape(shape, dx, dy) {
  return {
    ...shape,
    cmds: shape.cmds.map((c) => {
      switch (c.op) {
        case "rect":
          return { ...c, x: c.x + dx, y: c.y + dy };
        case "moveTo":
        case "lineTo":
          return { ...c, x: c.x + dx, y: c.y + dy };
        case "bezierCurveTo":
          return {
            ...c,
            cp1x: c.cp1x + dx,
            cp1y: c.cp1y + dy,
            cp2x: c.cp2x + dx,
            cp2y: c.cp2y + dy,
            x: c.x + dx,
            y: c.y + dy
          };
        case "closePath":
          return c;
      }
    })
  };
}
function translateClipRegion(region, dx, dy) {
  if (!region) {
    return null;
  }
  return region.map((s) => translateClipShape(s, dx, dy));
}
function isComposable(shape) {
  return shape.simple && shape.fillRule === "nonzero";
}
function invertClipShape(shape) {
  return {
    cmds: [
      { op: "rect", x: -CLIP_HUGE, y: -CLIP_HUGE, w: 2 * CLIP_HUGE, h: 2 * CLIP_HUGE },
      ...shape.cmds
    ],
    fillRule: "evenodd",
    simple: false
  };
}
function combineClip(current, shape, op) {
  switch (op) {
    case "replace":
      return { region: [shape], exact: true };
    case "intersect":
      return { region: current ? [...current, shape] : [shape], exact: true };
    case "exclude": {
      if (!isComposable(shape)) {
        return { region: current ? [...current, shape] : [shape], exact: false };
      }
      const inv = invertClipShape(shape);
      return { region: current ? [...current, inv] : [inv], exact: true };
    }
    case "union": {
      if (!current) {
        return { region: null, exact: true };
      }
      if (current.length === 1 && isComposable(current[0]) && isComposable(shape)) {
        return {
          region: [
            { cmds: [...current[0].cmds, ...shape.cmds], fillRule: "nonzero", simple: false }
          ],
          exact: false
        };
      }
      return { region: current, exact: false };
    }
    case "xor": {
      if (!current) {
        if (isComposable(shape)) {
          return { region: [invertClipShape(shape)], exact: true };
        }
        return { region: [shape], exact: false };
      }
      if (current.length === 1 && isComposable(current[0]) && isComposable(shape)) {
        return {
          region: [
            { cmds: [...current[0].cmds, ...shape.cmds], fillRule: "evenodd", simple: false }
          ],
          exact: true
        };
      }
      if (isComposable(shape)) {
        return { region: [...current, invertClipShape(shape)], exact: false };
      }
      return { region: [...current, shape], exact: false };
    }
    case "complement": {
      if (!current) {
        return { region: [emptyClipShape()], exact: true };
      }
      if (current.length === 1 && isComposable(current[0])) {
        return { region: [shape, invertClipShape(current[0])], exact: true };
      }
      return { region: [shape], exact: false };
    }
  }
}
function combineClipRegions(current, incoming, op) {
  if (op === "replace") {
    return { region: incoming, exact: true };
  }
  if (incoming && incoming.length === 1) {
    return combineClip(current, incoming[0], op);
  }
  if (!incoming) {
    switch (op) {
      case "intersect":
        return { region: current, exact: true };
      case "union":
        return { region: null, exact: true };
      case "exclude":
        return { region: [emptyClipShape()], exact: true };
      case "xor":
      case "complement": {
        if (!current) {
          return { region: [emptyClipShape()], exact: true };
        }
        if (current.length === 1) {
          return combineClip(null, current[0], "exclude");
        }
        return { region: current, exact: false };
      }
    }
  }
  switch (op) {
    case "intersect":
      return { region: current ? [...current, ...incoming] : incoming, exact: true };
    case "union":
      return { region: current, exact: false };
    case "xor":
      return { region: current ?? incoming, exact: false };
    case "exclude":
      return { region: current, exact: false };
    case "complement": {
      if (!current) {
        return { region: [emptyClipShape()], exact: true };
      }
      if (current.length === 1) {
        return combineClip(incoming, current[0], "exclude");
      }
      return { region: incoming, exact: false };
    }
  }
}
function replayClipCmds(ctx, cmds) {
  for (const c of cmds) {
    switch (c.op) {
      case "rect":
        ctx.rect(c.x, c.y, c.w, c.h);
        break;
      case "moveTo":
        ctx.moveTo(c.x, c.y);
        break;
      case "lineTo":
        ctx.lineTo(c.x, c.y);
        break;
      case "bezierCurveTo":
        ctx.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, c.x, c.y);
        break;
      case "closePath":
        ctx.closePath();
        break;
    }
  }
}
function applyClipShapes(ctx, shapes) {
  for (const s of shapes) {
    ctx.beginPath();
    replayClipCmds(ctx, s.cmds);
    try {
      ctx.clip(s.fillRule);
    } catch {
    }
  }
}
function reapplyClipRegion(holder, region, identityTransform = false) {
  const { ctx } = holder;
  while (holder.clipSaveDepth > 0) {
    ctx.restore();
    holder.clipSaveDepth--;
  }
  if (region) {
    ctx.save();
    holder.clipSaveDepth = 1;
    if (identityTransform) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    applyClipShapes(ctx, region);
  }
}
function decodeRleBitmap(view, bitsOffset, bitsSize, width, height, _topDown, isRle4, colorTable, out, setPixel) {
  let x = 0;
  let y = height - 1;
  let off = bitsOffset;
  const endOff = bitsOffset + bitsSize;
  while (off + 1 < endOff && y >= 0) {
    const first = view.getUint8(off);
    const second = view.getUint8(off + 1);
    off += 2;
    if (first === 0) {
      if (second === 0) {
        x = 0;
        y--;
      } else if (second === 1) {
        break;
      } else if (second === 2) {
        if (off + 1 >= endOff) {
          break;
        }
        x += view.getUint8(off);
        y -= view.getUint8(off + 1);
        off += 2;
      } else {
        const count = second;
        if (!isRle4) {
          for (let i = 0; i < count && off < endOff && x < width; i++) {
            const idx = view.getUint8(off++);
            if (idx < colorTable.length) {
              setPixel(
                x,
                height - 1 - y,
                colorTable[idx][0],
                colorTable[idx][1],
                colorTable[idx][2],
                255
              );
            }
            x++;
          }
          if (count & 1) {
            off++;
          }
        } else {
          const bytes = Math.ceil(count / 2);
          let pi = 0;
          for (let i = 0; i < bytes && off < endOff; i++) {
            const byte = view.getUint8(off++);
            for (let nibble = 0; nibble < 2 && pi < count; nibble++) {
              const idx = nibble === 0 ? byte >> 4 & 15 : byte & 15;
              if (idx < colorTable.length && x < width) {
                setPixel(
                  x,
                  height - 1 - y,
                  colorTable[idx][0],
                  colorTable[idx][1],
                  colorTable[idx][2],
                  255
                );
              }
              x++;
              pi++;
            }
          }
          if (bytes & 1) {
            off++;
          }
        }
      }
    } else if (!isRle4) {
      const idx = second;
      const c = idx < colorTable.length ? colorTable[idx] : [0, 0, 0];
      for (let i = 0; i < first && x < width; i++) {
        setPixel(x, height - 1 - y, c[0], c[1], c[2], 255);
        x++;
      }
    } else {
      const hi = second >> 4 & 15;
      const lo = second & 15;
      for (let i = 0; i < first && x < width; i++) {
        const idx = (i & 1) === 0 ? hi : lo;
        if (idx < colorTable.length) {
          setPixel(
            x,
            height - 1 - y,
            colorTable[idx][0],
            colorTable[idx][1],
            colorTable[idx][2],
            255
          );
        }
        x++;
      }
    }
  }
  return new ImageData(
    new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength),
    width,
    height
  );
}
function countTrailingZeros(v) {
  if (v === 0) {
    return 0;
  }
  let c = 0;
  let val2 = v;
  while ((val2 & 1) === 0) {
    val2 >>>= 1;
    c++;
  }
  return c;
}
var BI_BITFIELDS = 3;
function parseBitfieldMasks(view, bmiOffset, headerSize, compression, bitCount) {
  let rMask = 0, gMask = 0, bMask = 0;
  let rShift = 0, gShift = 0, bShift = 0;
  let rMax = 1, gMax = 1, bMax = 1;
  if (compression === BI_BITFIELDS) {
    const bfOff = bmiOffset + headerSize;
    if (bfOff + 12 > view.byteLength) {
      return null;
    }
    rMask = view.getUint32(bfOff, true);
    gMask = view.getUint32(bfOff + 4, true);
    bMask = view.getUint32(bfOff + 8, true);
    rShift = countTrailingZeros(rMask);
    gShift = countTrailingZeros(gMask);
    bShift = countTrailingZeros(bMask);
    rMax = rMask >>> rShift || 1;
    gMax = gMask >>> gShift || 1;
    bMax = bMask >>> bShift || 1;
  } else if (bitCount === 16) {
    rMask = 31744;
    gMask = 992;
    bMask = 31;
    rShift = 10;
    gShift = 5;
    bShift = 0;
    rMax = 31;
    gMax = 31;
    bMax = 31;
  }
  return { rMask, gMask, bMask, rShift, gShift, bShift, rMax, gMax, bMax };
}
function decodeUncompressedRows(view, bitsOffset, width, height, topDown, bitCount, colorTable, masks, out, preserveAlpha = false) {
  const rowStride = Math.floor((bitCount * width + 31) / 32) * 4;
  const { rMask, gMask, bMask, rShift, gShift, bShift, rMax, gMax, bMax } = masks;
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    const rowStart = bitsOffset + srcY * rowStride;
    if (rowStart + rowStride > view.byteLength) {
      continue;
    }
    for (let x = 0; x < width; x++) {
      const dstPx = (y * width + x) * 4;
      if (bitCount === 1) {
        const byteIdx = rowStart + (x >> 3);
        const bit = view.getUint8(byteIdx) >> 7 - (x & 7) & 1;
        if (bit < colorTable.length) {
          out[dstPx] = colorTable[bit][0];
          out[dstPx + 1] = colorTable[bit][1];
          out[dstPx + 2] = colorTable[bit][2];
        }
        out[dstPx + 3] = 255;
      } else if (bitCount === 4) {
        const byteIdx = rowStart + (x >> 1);
        const nibble = (x & 1) === 0 ? view.getUint8(byteIdx) >> 4 & 15 : view.getUint8(byteIdx) & 15;
        if (nibble < colorTable.length) {
          out[dstPx] = colorTable[nibble][0];
          out[dstPx + 1] = colorTable[nibble][1];
          out[dstPx + 2] = colorTable[nibble][2];
        }
        out[dstPx + 3] = 255;
      } else if (bitCount === 8) {
        const idx = view.getUint8(rowStart + x);
        if (idx < colorTable.length) {
          out[dstPx] = colorTable[idx][0];
          out[dstPx + 1] = colorTable[idx][1];
          out[dstPx + 2] = colorTable[idx][2];
        }
        out[dstPx + 3] = 255;
      } else if (bitCount === 16) {
        const val2 = view.getUint16(rowStart + x * 2, true);
        out[dstPx] = Math.round(((val2 & rMask) >>> rShift) * 255 / rMax);
        out[dstPx + 1] = Math.round(((val2 & gMask) >>> gShift) * 255 / gMax);
        out[dstPx + 2] = Math.round(((val2 & bMask) >>> bShift) * 255 / bMax);
        out[dstPx + 3] = 255;
      } else if (bitCount === 24) {
        const srcPx = rowStart + x * 3;
        out[dstPx] = view.getUint8(srcPx + 2);
        out[dstPx + 1] = view.getUint8(srcPx + 1);
        out[dstPx + 2] = view.getUint8(srcPx);
        out[dstPx + 3] = 255;
      } else {
        const srcPx = rowStart + x * 4;
        const bb = view.getUint8(srcPx);
        const gg = view.getUint8(srcPx + 1);
        const rr = view.getUint8(srcPx + 2);
        const aa = view.getUint8(srcPx + 3);
        out[dstPx] = rr;
        out[dstPx + 1] = gg;
        out[dstPx + 2] = bb;
        out[dstPx + 3] = preserveAlpha ? aa : aa === 0 ? 255 : aa;
      }
    }
  }
}
function decodeDibToImageData(view, bmiOffset, bitsOffset, bitsSize, preserveAlpha = false) {
  if (bmiOffset < 0 || bitsOffset < 0 || bmiOffset + 40 > view.byteLength || bitsOffset + bitsSize > view.byteLength) {
    return null;
  }
  const headerSize = view.getUint32(bmiOffset, true);
  if (headerSize < 40 || bmiOffset + headerSize > view.byteLength) {
    return null;
  }
  const width = view.getInt32(bmiOffset + 4, true);
  const heightRaw = view.getInt32(bmiOffset + 8, true);
  const planes = view.getUint16(bmiOffset + 12, true);
  const bitCount = view.getUint16(bmiOffset + 14, true);
  const compression = view.getUint32(bmiOffset + 16, true);
  if (planes !== 1 || width <= 0 || heightRaw === 0) {
    return null;
  }
  if (width > 8192 || Math.abs(heightRaw) > 8192) {
    return null;
  }
  const BI_RGB = 0;
  const BI_RLE8 = 1;
  const BI_RLE4 = 2;
  const BI_BITFIELDS2 = 3;
  if (bitCount !== 1 && bitCount !== 4 && bitCount !== 8 && bitCount !== 16 && bitCount !== 24 && bitCount !== 32) {
    return null;
  }
  if (compression === BI_RLE8 && bitCount !== 8) {
    return null;
  }
  if (compression === BI_RLE4 && bitCount !== 4) {
    return null;
  }
  if (compression === BI_BITFIELDS2 && bitCount !== 16 && bitCount !== 32) {
    return null;
  }
  if (compression !== BI_RGB && compression !== BI_RLE8 && compression !== BI_RLE4 && compression !== BI_BITFIELDS2) {
    return null;
  }
  const height = Math.abs(heightRaw);
  const topDown = heightRaw < 0;
  const colorTable = [];
  if (bitCount <= 8) {
    const maxColors = 1 << bitCount;
    const colorsUsed = view.getUint32(bmiOffset + 32, true) || maxColors;
    const numColors = Math.min(colorsUsed, maxColors);
    const ctOffset = bmiOffset + headerSize;
    if (ctOffset + numColors * 4 > view.byteLength) {
      return null;
    }
    for (let i = 0; i < numColors; i++) {
      const b = view.getUint8(ctOffset + i * 4);
      const g = view.getUint8(ctOffset + i * 4 + 1);
      const r = view.getUint8(ctOffset + i * 4 + 2);
      colorTable.push([r, g, b]);
    }
  }
  const masks = parseBitfieldMasks(view, bmiOffset, headerSize, compression, bitCount);
  if (!masks) {
    return null;
  }
  const out = new Uint8ClampedArray(width * height * 4);
  if (compression === BI_RLE8 || compression === BI_RLE4) {
    const setPixel = (x, y, r, g, b, a) => {
      const dstPx = (y * width + x) * 4;
      out[dstPx] = r;
      out[dstPx + 1] = g;
      out[dstPx + 2] = b;
      out[dstPx + 3] = a;
    };
    return decodeRleBitmap(
      view,
      bitsOffset,
      bitsSize,
      width,
      height,
      topDown,
      compression === BI_RLE4,
      colorTable,
      out,
      setPixel
    );
  }
  decodeUncompressedRows(
    view,
    bitsOffset,
    width,
    height,
    topDown,
    bitCount,
    colorTable,
    masks,
    out,
    preserveAlpha
  );
  return new ImageData(out, width, height);
}
function handleExtTextOutW(rCtx, offset, dataOff, recSize) {
  const { ctx, view, state } = rCtx;
  if (recSize >= 76) {
    const refX = view.getInt32(dataOff + 28, true);
    const refY = view.getInt32(dataOff + 32, true);
    const nChars = view.getUint32(dataOff + 36, true);
    const offString = view.getUint32(dataOff + 40, true);
    const options = view.getUint32(dataOff + 44, true);
    const rcL = view.getInt32(dataOff + 48, true);
    const rcT = view.getInt32(dataOff + 52, true);
    const rcR = view.getInt32(dataOff + 56, true);
    const rcB = view.getInt32(dataOff + 60, true);
    const offDx = view.getUint32(dataOff + 64, true);
    const maxOffset = view.byteLength;
    if (nChars > 0 && offString > 0 && offset + offString + nChars * 2 <= maxOffset) {
      const text = mapSymbolText(state.fontFamily, readUtf16LE(view, offset + offString, nChars));
      if (text.length > 0) {
        const fontScale = Math.abs(gmh(rCtx, 1));
        applyFont(ctx, state, fontScale);
        ctx.fillStyle = state.textColor;
        const vAlign = state.textAlign & 24;
        const alignBaseline = vAlign === 24 ? "alphabetic" : vAlign === 8 ? "bottom" : "top";
        const hAlign = state.textAlign & 6;
        const alignHoriz = hAlign === 6 ? "center" : hAlign === 2 ? "right" : "left";
        ctx.textBaseline = alignBaseline;
        const gdiMetrics = alignBaseline === "alphabetic" ? null : gdiFontMetrics(state.fontFamily);
        let baselineShift = 0;
        if (gdiMetrics) {
          const em = fontSizePx(state, fontScale);
          baselineShift = alignBaseline === "top" ? gdiMetrics[0] * em : -gdiMetrics[1] * em;
          ctx.textBaseline = "alphabetic";
        }
        const pdy = (options & 8192) !== 0;
        const dxCount = nChars * (pdy ? 2 : 1);
        let dx = null;
        let dy = null;
        if (offDx > 0 && offset + offDx + dxCount * 4 <= maxOffset) {
          dx = new Array(nChars);
          if (pdy) dy = new Array(nChars);
          for (let i = 0; i < nChars; i++) {
            dx[i] = view.getInt32(offset + offDx + i * (pdy ? 8 : 4), true);
            if (dy) dy[i] = view.getInt32(offset + offDx + i * 8 + 4, true);
          }
        }
        const updateCp = (state.textAlign & 1) !== 0;
        const logX = updateCp ? state.curX : refX;
        const logY = updateCp ? state.curY : refY;
        const baseX = gmx(rCtx, logX);
        const baseY = gmy(rCtx, logY) + baselineShift;
        const totalW = dx ? gmw(rCtx, dx.reduce((a, b) => a + b, 0)) : ctx.measureText(text).width;
        const startX = alignHoriz === "center" ? baseX - totalW / 2 : alignHoriz === "right" ? baseX - totalW : baseX;
        const bgH = fontSizePx(state, fontScale);
        const clipped = (options & 4) !== 0 && rcR > rcL && rcB > rcT;
        if (clipped) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(gmx(rCtx, rcL), gmy(rCtx, rcT), gmw(rCtx, rcR - rcL), gmh(rCtx, rcB - rcT));
          ctx.clip();
        }
        if ((options & 2) !== 0 && rcR > rcL && rcB > rcT) {
          ctx.fillStyle = state.bkColor;
          ctx.fillRect(gmx(rCtx, rcL), gmy(rCtx, rcT), gmw(rCtx, rcR - rcL), gmh(rCtx, rcB - rcT));
          ctx.fillStyle = state.textColor;
        } else if (state.bkMode === 2) {
          const top = gdiMetrics ? baseY - gdiMetrics[0] * bgH : alignBaseline === "top" ? baseY : alignBaseline === "bottom" ? baseY - bgH : baseY - bgH * 0.8;
          ctx.fillStyle = state.bkColor;
          ctx.fillRect(startX, top, totalW, bgH);
          ctx.fillStyle = state.textColor;
        }
        if (dx) {
          ctx.textAlign = "left";
          let x = startX;
          let y = baseY;
          for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            if (code >= 55296 && code <= 56319 && i + 1 < text.length) {
              ctx.fillText(text.slice(i, i + 2), x, y);
              x += gmw(rCtx, (dx[i] ?? 0) + (dx[i + 1] ?? 0));
              if (dy) y += gmh(rCtx, (dy[i] ?? 0) + (dy[i + 1] ?? 0));
              i++;
              continue;
            }
            ctx.fillText(text[i], x, y);
            x += gmw(rCtx, dx[i] ?? 0);
            if (dy) y += gmh(rCtx, dy[i] ?? 0);
          }
        } else {
          ctx.textAlign = alignHoriz;
          ctx.fillText(text, baseX, baseY);
        }
        if (clipped) ctx.restore();
        if (state.fontUnderline || state.fontStrikeOut) {
          drawTextDecorations(ctx, state, startX, baseY, totalW, fontScale);
        }
        if (updateCp) {
          const unitPx = gmw(rCtx, 1);
          state.curX += dx ? dx.reduce((a, b) => a + b, 0) : unitPx ? totalW / unitPx : 0;
          if (dy) state.curY += dy.reduce((a, b) => a + b, 0);
        }
      }
    }
  }
  return true;
}
var ROP_PATCOPY = 15728673;
var BS_NULL = 1;
function handleBitBlt(rCtx, offset, dataOff, recSize) {
  const { ctx, view, state } = rCtx;
  if (recSize >= 96) {
    const dstX = view.getInt32(dataOff + 16, true);
    const dstY = view.getInt32(dataOff + 20, true);
    const dstW = view.getInt32(dataOff + 24, true);
    const dstH = view.getInt32(dataOff + 28, true);
    const rop = view.getUint32(dataOff + 32, true);
    const offBmiSrc = view.getUint32(dataOff + 76, true);
    const cbBmiSrc = view.getUint32(dataOff + 80, true);
    const offBitsSrc = view.getUint32(dataOff + 84, true);
    const cbBitsSrc = view.getUint32(dataOff + 88, true);
    if (offBmiSrc === 0 && rop === ROP_PATCOPY) {
      const prevFill = ctx.fillStyle;
      if (state.brushStyle !== BS_NULL) {
        ctx.fillStyle = state.brushPattern ?? state.brushColor;
        ctx.fillRect(gmx(rCtx, dstX), gmy(rCtx, dstY), gmw(rCtx, dstW), gmh(rCtx, dstH));
      }
      ctx.fillStyle = prevFill;
      return true;
    }
    if (offBmiSrc > 0 && cbBmiSrc > 0 && offBitsSrc > 0 && cbBitsSrc > 0) {
      const imageData = decodeDibToImageData(
        view,
        offset + offBmiSrc,
        offset + offBitsSrc,
        cbBitsSrc
      );
      if (imageData) {
        const temp = createTempCanvas(imageData.width, imageData.height);
        if (temp) {
          temp.ctx.putImageData(imageData, 0, 0);
          ctx.drawImage(
            temp.canvas,
            gmx(rCtx, dstX),
            gmy(rCtx, dstY),
            gmw(rCtx, dstW),
            gmh(rCtx, dstH)
          );
        }
      }
    }
  }
  return true;
}
function handleStretchDibits(rCtx, offset, dataOff, recSize) {
  const { ctx, view } = rCtx;
  if (recSize >= 80) {
    const dstX = view.getInt32(dataOff + 16, true);
    const dstY = view.getInt32(dataOff + 20, true);
    const dstW = view.getInt32(dataOff + 64, true);
    const dstH = view.getInt32(dataOff + 68, true);
    const offBmiSrc = view.getUint32(dataOff + 40, true);
    const cbBmiSrc = view.getUint32(dataOff + 44, true);
    const offBitsSrc = view.getUint32(dataOff + 48, true);
    const cbBitsSrc = view.getUint32(dataOff + 52, true);
    if (offBmiSrc > 0 && cbBmiSrc > 0 && offBitsSrc > 0 && cbBitsSrc > 0) {
      const imageData = decodeDibToImageData(
        view,
        offset + offBmiSrc,
        offset + offBitsSrc,
        cbBitsSrc
      );
      if (imageData) {
        const temp = createTempCanvas(imageData.width, imageData.height);
        if (temp) {
          temp.ctx.putImageData(imageData, 0, 0);
          ctx.drawImage(
            temp.canvas,
            gmx(rCtx, dstX),
            gmy(rCtx, dstY),
            gmw(rCtx, dstW),
            gmh(rCtx, dstH)
          );
        }
      }
    }
  }
  return true;
}
var AC_SRC_ALPHA = 1;
function handleAlphaBlend(rCtx, offset, dataOff, recSize) {
  const { ctx, view } = rCtx;
  if (recSize < 108) {
    return true;
  }
  const dstX = view.getInt32(dataOff + 16, true);
  const dstY = view.getInt32(dataOff + 20, true);
  const dstW = view.getInt32(dataOff + 24, true);
  const dstH = view.getInt32(dataOff + 28, true);
  const srcConstantAlpha = view.getUint8(dataOff + 34);
  const alphaFormat = view.getUint8(dataOff + 35);
  const srcX = view.getInt32(dataOff + 36, true);
  const srcY = view.getInt32(dataOff + 40, true);
  const offBmiSrc = view.getUint32(dataOff + 76, true);
  const cbBmiSrc = view.getUint32(dataOff + 80, true);
  const offBitsSrc = view.getUint32(dataOff + 84, true);
  const cbBitsSrc = view.getUint32(dataOff + 88, true);
  const srcW = view.getInt32(dataOff + 92, true);
  const srcH = view.getInt32(dataOff + 96, true);
  if (offBmiSrc <= 0 || cbBmiSrc <= 0 || offBitsSrc <= 0 || cbBitsSrc <= 0 || srcW <= 0 || srcH <= 0) {
    return true;
  }
  const imageData = decodeDibToImageData(
    view,
    offset + offBmiSrc,
    offset + offBitsSrc,
    cbBitsSrc,
    (alphaFormat & AC_SRC_ALPHA) !== 0
  );
  if (!imageData) {
    return true;
  }
  if (alphaFormat & AC_SRC_ALPHA) {
    const px = imageData.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a === 255) {
        continue;
      }
      if (a === 0) {
        px[i] = px[i + 1] = px[i + 2] = 0;
        continue;
      }
      px[i] = Math.min(255, Math.round(px[i] * 255 / a));
      px[i + 1] = Math.min(255, Math.round(px[i + 1] * 255 / a));
      px[i + 2] = Math.min(255, Math.round(px[i + 2] * 255 / a));
    }
  }
  const temp = createTempCanvas(imageData.width, imageData.height);
  if (!temp) {
    return true;
  }
  temp.ctx.putImageData(imageData, 0, 0);
  const constAlpha = srcConstantAlpha / 255;
  const prevAlpha = constAlpha < 1 ? ctx.globalAlpha : 1;
  if (constAlpha < 1) {
    ctx.globalAlpha = prevAlpha * constAlpha;
  }
  ctx.drawImage(
    temp.canvas,
    srcX,
    srcY,
    srcW,
    srcH,
    gmx(rCtx, dstX),
    gmy(rCtx, dstY),
    gmw(rCtx, dstW),
    gmh(rCtx, dstH)
  );
  if (constAlpha < 1) {
    ctx.globalAlpha = prevAlpha;
  }
  return true;
}
function gdiCombineClip(rCtx, shape, op) {
  const { ctx } = rCtx;
  if (rCtx.clipUntracked && op !== "replace") {
    switch (op) {
      case "intersect":
      case "complement": {
        ctx.save();
        rCtx.clipSaveDepth++;
        applyClipShapes(ctx, [shape]);
        return;
      }
      case "exclude":
      case "xor": {
        const inv = combineClip(null, shape, "exclude");
        ctx.save();
        rCtx.clipSaveDepth++;
        applyClipShapes(ctx, inv.region ?? [shape]);
        return;
      }
      case "union":
        return;
    }
  }
  const res = combineClip(op === "replace" ? null : rCtx.clipRegion ?? null, shape, op);
  if (!res.exact) ;
  rCtx.clipRegion = res.region;
  rCtx.clipUntracked = false;
  reapplyClipRegion(rCtx, res.region);
}
function readClipRectShape(rCtx, dataOff) {
  const { view } = rCtx;
  const left = view.getInt32(dataOff, true);
  const top = view.getInt32(dataOff + 4, true);
  const right = view.getInt32(dataOff + 8, true);
  const bottom = view.getInt32(dataOff + 12, true);
  return rectClipShape(
    gmx(rCtx, left),
    gmy(rCtx, top),
    gmw(rCtx, right - left),
    gmh(rCtx, bottom - top)
  );
}
function handleIntersectClipRect(rCtx, dataOff, recSize) {
  if (recSize >= 24) {
    gdiCombineClip(rCtx, readClipRectShape(rCtx, dataOff), "intersect");
  }
  return true;
}
function handleExcludeClipRect(rCtx, dataOff, recSize) {
  if (recSize >= 24) {
    gdiCombineClip(rCtx, readClipRectShape(rCtx, dataOff), "exclude");
  }
  return true;
}
var RGN_MODE_OPS = {
  1: "intersect",
  // RGN_AND
  2: "union",
  // RGN_OR
  3: "xor",
  // RGN_XOR
  4: "exclude",
  // RGN_DIFF
  5: "replace"
  // RGN_COPY
};
function handleExtSelectClipRgn(rCtx, dataOff, recSize) {
  const { view } = rCtx;
  if (recSize < 16) {
    return true;
  }
  const cbRgnData = view.getUint32(dataOff, true);
  const iMode = view.getUint32(dataOff + 4, true);
  const op = RGN_MODE_OPS[iMode];
  if (!op) {
    return true;
  }
  if (cbRgnData === 0) {
    if (op === "replace") {
      rCtx.clipRegion = null;
      rCtx.clipUntracked = false;
      reapplyClipRegion(rCtx, null);
    }
    return true;
  }
  const rgnStart = dataOff + 8;
  if (cbRgnData < 32) {
    return true;
  }
  const nCount = view.getUint32(rgnStart + 8, true);
  if (nCount === 0) {
    return true;
  }
  const rects = [];
  const rectsStart = rgnStart + 32;
  for (let i = 0; i < nCount; i++) {
    const rOff = rectsStart + i * 16;
    if (rOff + 16 > dataOff + 8 + cbRgnData) {
      break;
    }
    const left = view.getInt32(rOff, true);
    const top = view.getInt32(rOff + 4, true);
    const right = view.getInt32(rOff + 8, true);
    const bottom = view.getInt32(rOff + 12, true);
    rects.push({
      x: gmx(rCtx, left),
      y: gmy(rCtx, top),
      w: gmw(rCtx, right - left),
      h: gmh(rCtx, bottom - top)
    });
  }
  if (rects.length === 0) {
    return true;
  }
  gdiCombineClip(rCtx, rectsClipShape(rects), op);
  return true;
}
function handleOffsetClipRgn(rCtx, dataOff, recSize) {
  if (recSize >= 16) {
    const dx = rCtx.view.getInt32(dataOff, true);
    const dy = rCtx.view.getInt32(dataOff + 4, true);
    if (rCtx.clipUntracked) {
      return true;
    }
    if (rCtx.clipRegion) {
      rCtx.clipRegion = translateClipRegion(rCtx.clipRegion, gmw(rCtx, dx), gmh(rCtx, dy));
      reapplyClipRegion(rCtx, rCtx.clipRegion);
    }
  }
  return true;
}
function handleEmfGdiTextBitmapRecord(rCtx, recType, offset, dataOff, recSize) {
  switch (recType) {
    case EMR_EXTTEXTOUTW:
      return handleExtTextOutW(rCtx, offset, dataOff, recSize);
    case EMR_BITBLT:
      return handleBitBlt(rCtx, offset, dataOff, recSize);
    case EMR_STRETCHDIBITS:
      return handleStretchDibits(rCtx, offset, dataOff, recSize);
    case EMR_ALPHABLEND:
      return handleAlphaBlend(rCtx, offset, dataOff, recSize);
    case EMR_INTERSECTCLIPRECT:
      return handleIntersectClipRect(rCtx, dataOff, recSize);
    case EMR_EXTSELECTCLIPRGN:
      return handleExtSelectClipRgn(rCtx, dataOff, recSize);
    case EMR_EXCLUDECLIPRECT:
      return handleExcludeClipRect(rCtx, dataOff, recSize);
    case EMR_OFFSETCLIPRGN:
      return handleOffsetClipRgn(rCtx, dataOff, recSize);
    case EMR_GRADIENTFILL:
      return handleGradientFill(rCtx, dataOff, recSize);
    default:
      return false;
  }
}
function handleGradientFill(rCtx, dataOff, recSize) {
  const { ctx, view } = rCtx;
  if (recSize < 36) return true;
  const nVer = view.getUint32(dataOff + 16, true);
  const nTri = view.getUint32(dataOff + 20, true);
  const ulMode = view.getUint32(dataOff + 24, true);
  if (nVer === 0 || nVer > MAX_GRADIENT_ELEMENTS || nTri > MAX_GRADIENT_ELEMENTS) return true;
  const vtxOff = dataOff + 28;
  const idxOff = vtxOff + nVer * 16;
  const vtx = (i) => {
    const o = vtxOff + i * 16;
    return {
      x: view.getInt32(o, true),
      y: view.getInt32(o + 4, true),
      // 16-bit color channels; GDI uses the high byte (the Alpha field is ignored by GDI)
      color: `rgb(${view.getUint16(o + 8, true) >> 8},${view.getUint16(o + 10, true) >> 8},${view.getUint16(o + 12, true) >> 8})`
    };
  };
  if (ulMode === 2) {
    for (let t = 0; t < nTri; t++) {
      const o = idxOff + t * 12;
      if (o + 12 > dataOff + recSize - 8) break;
      const a = vtx(view.getUint32(o, true) % nVer);
      const b = vtx(view.getUint32(o + 4, true) % nVer);
      const c = vtx(view.getUint32(o + 8, true) % nVer);
      ctx.beginPath();
      ctx.moveTo(gmx(rCtx, a.x), gmy(rCtx, a.y));
      ctx.lineTo(gmx(rCtx, b.x), gmy(rCtx, b.y));
      ctx.lineTo(gmx(rCtx, c.x), gmy(rCtx, c.y));
      ctx.closePath();
      const prev = ctx.fillStyle;
      ctx.fillStyle = a.color;
      ctx.fill();
      ctx.fillStyle = prev;
    }
    return true;
  }
  for (let t = 0; t < nTri; t++) {
    const o = idxOff + t * 8;
    if (o + 8 > dataOff + recSize - 8) break;
    const ul = vtx(view.getUint32(o, true) % nVer);
    const lr = vtx(view.getUint32(o + 4, true) % nVer);
    const ux = gmx(rCtx, ul.x);
    const uy = gmy(rCtx, ul.y);
    const lx = gmx(rCtx, lr.x);
    const ly = gmy(rCtx, lr.y);
    const x0 = Math.min(ux, lx);
    const y0 = Math.min(uy, ly);
    const x1 = Math.max(ux, lx);
    const y1 = Math.max(uy, ly);
    if (!(x1 > x0) || !(y1 > y0)) continue;
    const grad = ulMode === 1 ? ctx.createLinearGradient(x0, uy, x0, ly) : ctx.createLinearGradient(ux, y0, lx, y0);
    grad.addColorStop(0, ul.color);
    grad.addColorStop(1, lr.color);
    const prev = ctx.fillStyle;
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = prev;
  }
  return true;
}
function handleEmfGdiDrawRecord(rCtx, recType, offset, dataOff, recSize) {
  return handleEmfGdiShapeRecord(rCtx, recType, dataOff, recSize) || handleEmfGdiTextBitmapRecord(rCtx, recType, offset, dataOff, recSize);
}
function handlePolyPolygon32(rCtx, offset, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  const numPolys = view.getUint32(dataOff + 16, true);
  const totalPoints = view.getUint32(dataOff + 20, true);
  if (numPolys === 0 || numPolys >= 1e4 || totalPoints >= 1e5) {
    return;
  }
  const countsOff = dataOff + 24;
  const ptOff = countsOff + numPolys * 4;
  if (ptOff + totalPoints * 8 > offset + recSize) {
    return;
  }
  if (!inPath) {
    ctx.beginPath();
  }
  let pIdx = 0;
  for (let p = 0; p < numPolys; p++) {
    const count = view.getUint32(countsOff + p * 4, true);
    for (let i = 0; i < count && pIdx < totalPoints; i++) {
      const px = view.getInt32(ptOff + pIdx * 8, true);
      const py = view.getInt32(ptOff + pIdx * 8 + 4, true);
      if (i === 0) {
        ctx.moveTo(gmx(rCtx, px), gmy(rCtx, py));
      } else {
        ctx.lineTo(gmx(rCtx, px), gmy(rCtx, py));
      }
      pIdx++;
    }
    ctx.closePath();
  }
  if (!inPath) {
    applyBrush(ctx, state);
    ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
    applyPen(ctx, state);
    ctx.stroke();
  }
}
function handlePolyPolyline32(rCtx, offset, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  const numPolys = view.getUint32(dataOff + 16, true);
  const totalPoints = view.getUint32(dataOff + 20, true);
  if (numPolys === 0 || numPolys >= 1e4 || totalPoints >= 1e5) {
    return;
  }
  const countsOff = dataOff + 24;
  const ptOff = countsOff + numPolys * 4;
  if (ptOff + totalPoints * 8 > offset + recSize) {
    return;
  }
  if (!inPath) {
    ctx.beginPath();
  }
  let pIdx = 0;
  for (let p = 0; p < numPolys; p++) {
    const count = view.getUint32(countsOff + p * 4, true);
    for (let i = 0; i < count && pIdx < totalPoints; i++) {
      const px = view.getInt32(ptOff + pIdx * 8, true);
      const py = view.getInt32(ptOff + pIdx * 8 + 4, true);
      if (i === 0) {
        ctx.moveTo(gmx(rCtx, px), gmy(rCtx, py));
      } else {
        ctx.lineTo(gmx(rCtx, px), gmy(rCtx, py));
      }
      pIdx++;
    }
  }
  if (!inPath) {
    applyPen(ctx, state);
    ctx.stroke();
  }
}
function handlePolyPolygon16(rCtx, offset, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  const numPolys = view.getUint32(dataOff + 16, true);
  const totalPoints = view.getUint32(dataOff + 20, true);
  if (numPolys === 0 || numPolys >= 1e4 || totalPoints >= 1e5) {
    return;
  }
  const countsOff = dataOff + 24;
  const ptOff = countsOff + numPolys * 4;
  if (ptOff + totalPoints * 4 > offset + recSize) {
    return;
  }
  if (!inPath) {
    ctx.beginPath();
  }
  let pIdx = 0;
  for (let p = 0; p < numPolys; p++) {
    const count = view.getUint32(countsOff + p * 4, true);
    for (let i = 0; i < count && pIdx < totalPoints; i++) {
      const px = view.getInt16(ptOff + pIdx * 4, true);
      const py = view.getInt16(ptOff + pIdx * 4 + 2, true);
      if (i === 0) {
        ctx.moveTo(gmx(rCtx, px), gmy(rCtx, py));
      } else {
        ctx.lineTo(gmx(rCtx, px), gmy(rCtx, py));
      }
      pIdx++;
    }
    ctx.closePath();
  }
  if (!inPath) {
    applyBrush(ctx, state);
    ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
    applyPen(ctx, state);
    ctx.stroke();
  }
}
function handlePoly32(rCtx, recType, offset, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize < 28) {
    return true;
  }
  const count = view.getUint32(dataOff + 16, true);
  const ptOff = dataOff + 20;
  if (count === 0 || ptOff + count * 8 > offset + recSize) {
    return true;
  }
  const isPolygon = recType === EMR_POLYGON;
  const isBezier = recType === EMR_POLYBEZIER || recType === EMR_POLYBEZIERTO;
  const isTo = recType === EMR_POLYBEZIERTO || recType === EMR_POLYLINETO;
  if (!inPath) {
    ctx.beginPath();
  }
  if (!isTo) {
    ctx.moveTo(gmx(rCtx, view.getInt32(ptOff, true)), gmy(rCtx, view.getInt32(ptOff + 4, true)));
  }
  let i = isTo ? 0 : 1;
  if (isBezier) {
    while (i + 2 < count) {
      ctx.bezierCurveTo(
        gmx(rCtx, view.getInt32(ptOff + i * 8, true)),
        gmy(rCtx, view.getInt32(ptOff + i * 8 + 4, true)),
        gmx(rCtx, view.getInt32(ptOff + (i + 1) * 8, true)),
        gmy(rCtx, view.getInt32(ptOff + (i + 1) * 8 + 4, true)),
        gmx(rCtx, view.getInt32(ptOff + (i + 2) * 8, true)),
        gmy(rCtx, view.getInt32(ptOff + (i + 2) * 8 + 4, true))
      );
      i += 3;
    }
  } else {
    for (; i < count; i++) {
      ctx.lineTo(
        gmx(rCtx, view.getInt32(ptOff + i * 8, true)),
        gmy(rCtx, view.getInt32(ptOff + i * 8 + 4, true))
      );
    }
  }
  if (isPolygon) {
    ctx.closePath();
  }
  if (!inPath) {
    if (isPolygon) {
      applyBrush(ctx, state);
      ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
    }
    applyPen(ctx, state);
    ctx.stroke();
  }
  if (count > 0) {
    const last = count - 1;
    state.curX = view.getInt32(ptOff + last * 8, true);
    state.curY = view.getInt32(ptOff + last * 8 + 4, true);
  }
  return true;
}
function handlePoly16(rCtx, recType, offset, dataOff, recSize) {
  const { ctx, view, state, inPath } = rCtx;
  if (recSize < 28) {
    return true;
  }
  const count = view.getUint32(dataOff + 16, true);
  const ptOff = dataOff + 20;
  if (count === 0 || ptOff + count * 4 > offset + recSize) {
    return true;
  }
  const isPolygon = recType === EMR_POLYGON16;
  const isBezier = recType === EMR_POLYBEZIER16 || recType === EMR_POLYBEZIERTO16;
  const isTo = recType === EMR_POLYBEZIERTO16 || recType === EMR_POLYLINETO16;
  if (!inPath) {
    ctx.beginPath();
  }
  if (!isTo) {
    ctx.moveTo(gmx(rCtx, view.getInt16(ptOff, true)), gmy(rCtx, view.getInt16(ptOff + 2, true)));
  }
  let i = isTo ? 0 : 1;
  if (isBezier) {
    while (i + 2 < count) {
      ctx.bezierCurveTo(
        gmx(rCtx, view.getInt16(ptOff + i * 4, true)),
        gmy(rCtx, view.getInt16(ptOff + i * 4 + 2, true)),
        gmx(rCtx, view.getInt16(ptOff + (i + 1) * 4, true)),
        gmy(rCtx, view.getInt16(ptOff + (i + 1) * 4 + 2, true)),
        gmx(rCtx, view.getInt16(ptOff + (i + 2) * 4, true)),
        gmy(rCtx, view.getInt16(ptOff + (i + 2) * 4 + 2, true))
      );
      i += 3;
    }
  } else {
    for (; i < count; i++) {
      ctx.lineTo(
        gmx(rCtx, view.getInt16(ptOff + i * 4, true)),
        gmy(rCtx, view.getInt16(ptOff + i * 4 + 2, true))
      );
    }
  }
  if (isPolygon) {
    ctx.closePath();
  }
  if (!inPath) {
    if (isPolygon) {
      applyBrush(ctx, state);
      ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
    }
    applyPen(ctx, state);
    ctx.stroke();
  }
  if (count > 0) {
    const last = count - 1;
    state.curX = view.getInt16(ptOff + last * 4, true);
    state.curY = view.getInt16(ptOff + last * 4 + 2, true);
  }
  return true;
}
function handleEmfGdiPolyPathRecord(rCtx, recType, offset, dataOff, recSize) {
  const { ctx, state } = rCtx;
  switch (recType) {
    // ---- 32-bit polys ----
    case EMR_POLYLINE:
    case EMR_POLYGON:
    case EMR_POLYBEZIER:
    case EMR_POLYBEZIERTO:
    case EMR_POLYLINETO:
      return handlePoly32(rCtx, recType, offset, dataOff, recSize);
    // ---- 16-bit polys ----
    case EMR_POLYLINE16:
    case EMR_POLYGON16:
    case EMR_POLYBEZIER16:
    case EMR_POLYBEZIERTO16:
    case EMR_POLYLINETO16:
      return handlePoly16(rCtx, recType, offset, dataOff, recSize);
    // ---- polypolyline / polypolygon ----
    case EMR_POLYPOLYLINE:
      if (recSize >= 28) {
        handlePolyPolyline32(rCtx, offset, dataOff, recSize);
      }
      return true;
    case EMR_POLYPOLYGON:
      if (recSize >= 28) {
        handlePolyPolygon32(rCtx, offset, dataOff, recSize);
      }
      return true;
    case EMR_POLYPOLYGON16:
      if (recSize >= 28) {
        handlePolyPolygon16(rCtx, offset, dataOff, recSize);
      }
      return true;
    // ---- path operations ----
    case EMR_BEGINPATH:
      rCtx.inPath = true;
      ctx.beginPath();
      return true;
    case EMR_ENDPATH:
      rCtx.inPath = false;
      return true;
    case EMR_CLOSEFIGURE:
      ctx.closePath();
      return true;
    case EMR_FILLPATH:
      applyBrush(ctx, state);
      ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
      return true;
    case EMR_STROKEANDFILLPATH:
      applyBrush(ctx, state);
      ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
      applyPen(ctx, state);
      ctx.stroke();
      return true;
    case EMR_STROKEPATH:
      applyPen(ctx, state);
      ctx.stroke();
      return true;
    case EMR_SELECTCLIPPATH: {
      const clipMode = recSize >= 12 ? rCtx.view.getUint32(dataOff, true) : 5;
      try {
        if (clipMode === 5) {
          while (rCtx.clipSaveDepth > 0) {
            ctx.restore();
            rCtx.clipSaveDepth--;
          }
        }
        ctx.save();
        rCtx.clipSaveDepth++;
        ctx.clip(state.polyFillMode === 2 ? "nonzero" : "evenodd");
        rCtx.clipRegion = null;
        rCtx.clipUntracked = true;
      } catch {
      }
      return true;
    }
    default:
      return false;
  }
}
function handleEmfObjectRecord(rCtx, recType, dataOff, recSize) {
  const { view, state } = rCtx;
  switch (recType) {
    case EMR_CREATEPEN: {
      if (recSize >= 28) {
        const ihPen = view.getUint32(dataOff, true);
        const penStyle = view.getUint32(dataOff + 4, true);
        const widthX = view.getInt32(dataOff + 8, true);
        const color = readColorRef(view, dataOff + 16);
        rCtx.objectTable.set(ihPen, {
          kind: "pen",
          style: penStyle & 255,
          widthX,
          color
        });
      }
      return true;
    }
    case EMR_EXTCREATEPEN: {
      if (recSize >= 52) {
        const ihPen = view.getUint32(dataOff, true);
        const penStyle = view.getUint32(dataOff + 12, true);
        const widthX = view.getInt32(dataOff + 16, true);
        const color = readColorRef(view, dataOff + 24);
        rCtx.objectTable.set(ihPen, {
          kind: "pen",
          style: penStyle & 255,
          widthX,
          color
        });
      }
      return true;
    }
    case EMR_CREATEMONOBRUSH:
    case EMR_CREATEDIBPATTERNBRUSHPT: {
      if (recSize >= 32) {
        const recStart = dataOff - 8;
        const ihBrush = view.getUint32(dataOff, true);
        const offBmi = view.getUint32(dataOff + 8, true);
        const offBits = view.getUint32(dataOff + 16, true);
        const cbBits = view.getUint32(dataOff + 20, true);
        let pattern = null;
        let color = "#000000";
        if (offBmi > 0 && offBits > 0 && cbBits > 0 && recStart + offBits + cbBits <= view.byteLength) {
          const imageData = decodeDibToImageData(view, recStart + offBmi, recStart + offBits, cbBits);
          if (imageData) {
            const temp = createTempCanvas(imageData.width, imageData.height);
            if (temp) {
              temp.ctx.putImageData(imageData, 0, 0);
              const k = Math.max(1, Math.round(Math.min(rCtx.sx, rCtx.sy)));
              let tile = temp.canvas;
              if (k > 1) {
                const big = createTempCanvas(imageData.width * k, imageData.height * k);
                if (big) {
                  big.ctx.imageSmoothingEnabled = false;
                  big.ctx.drawImage(temp.canvas, 0, 0, imageData.width * k, imageData.height * k);
                  tile = big.canvas;
                }
              }
              pattern = rCtx.ctx.createPattern(tile, "repeat") ?? null;
            }
          }
          color = dibAverageColor(view, recStart + offBmi, recStart + offBits + cbBits);
        }
        rCtx.objectTable.set(ihBrush, { kind: "brush", style: 0, color, pattern });
      }
      return true;
    }
    case EMR_CREATEBRUSHINDIRECT: {
      if (recSize >= 24) {
        const ihBrush = view.getUint32(dataOff, true);
        const brushStyle = view.getUint32(dataOff + 4, true);
        const color = readColorRef(view, dataOff + 8);
        rCtx.objectTable.set(ihBrush, {
          kind: "brush",
          style: brushStyle,
          color
        });
      }
      return true;
    }
    case EMR_EXTCREATEFONTINDIRECTW: {
      if (recSize >= 332) {
        const ihFont = view.getUint32(dataOff, true);
        const height = view.getInt32(dataOff + 4, true);
        const weight = view.getInt32(dataOff + 20, true);
        const italic = view.getUint8(dataOff + 24);
        const underline = view.getUint8(dataOff + 25);
        const strikeOut = view.getUint8(dataOff + 26);
        const family = readUtf16LE(view, dataOff + 32, 32) || "sans-serif";
        rCtx.objectTable.set(ihFont, {
          kind: "font",
          height: Math.abs(height),
          weight,
          italic: italic !== 0,
          underline: underline !== 0,
          strikeOut: strikeOut !== 0,
          family
        });
      }
      return true;
    }
    case EMR_SELECTOBJECT: {
      if (recSize >= 12) {
        const ihObject = view.getUint32(dataOff, true);
        const obj = ihObject >= STOCK_OBJECT_BASE ? getStockObject(ihObject - STOCK_OBJECT_BASE) : rCtx.objectTable.get(ihObject) ?? null;
        if (obj) {
          switch (obj.kind) {
            case "pen":
              state.penStyle = obj.style;
              state.penWidth = obj.widthX;
              state.penColor = obj.color;
              break;
            case "brush":
              state.brushStyle = obj.style;
              state.brushColor = obj.color;
              state.brushPattern = obj.pattern ?? null;
              break;
            case "font":
              state.fontHeight = obj.height;
              state.fontWeight = obj.weight;
              state.fontItalic = obj.italic;
              state.fontUnderline = obj.underline;
              state.fontStrikeOut = obj.strikeOut;
              state.fontFamily = obj.family;
              break;
          }
        }
      }
      return true;
    }
    case EMR_DELETEOBJECT: {
      if (recSize >= 12) {
        rCtx.objectTable.delete(view.getUint32(dataOff, true));
      }
      return true;
    }
    default:
      return false;
  }
}
function handleCoordinateRecord(rCtx, recType, dataOff, recSize) {
  const { view } = rCtx;
  switch (recType) {
    case EMR_SETWINDOWEXTEX: {
      if (recSize >= 16) {
        rCtx.windowExt.cx = view.getInt32(dataOff, true);
        rCtx.windowExt.cy = view.getInt32(dataOff + 4, true);
        activateGdiMappingMode(rCtx);
      }
      return true;
    }
    case EMR_SETWINDOWORGEX: {
      if (recSize >= 16) {
        rCtx.windowOrg.x = view.getInt32(dataOff, true);
        rCtx.windowOrg.y = view.getInt32(dataOff + 4, true);
        activateGdiMappingMode(rCtx);
      }
      return true;
    }
    case EMR_SETVIEWPORTEXTEX: {
      if (recSize >= 16) {
        rCtx.viewportExt.cx = view.getInt32(dataOff, true);
        rCtx.viewportExt.cy = view.getInt32(dataOff + 4, true);
        activateGdiMappingMode(rCtx);
      }
      return true;
    }
    case EMR_SETVIEWPORTORGEX: {
      if (recSize >= 16) {
        rCtx.viewportOrg.x = view.getInt32(dataOff, true);
        rCtx.viewportOrg.y = view.getInt32(dataOff + 4, true);
        activateGdiMappingMode(rCtx);
      }
      return true;
    }
    case EMR_SETMAPMODE: {
      if (recSize >= 12) {
        const mode = view.getUint32(dataOff, true);
        if (mode === 8 || mode === 7) {
          activateGdiMappingMode(rCtx);
        }
      }
      return true;
    }
    case EMR_SCALEVIEWPORTEXTEX: {
      if (recSize >= 24) {
        const xNum = view.getInt32(dataOff, true);
        const xDenom = view.getInt32(dataOff + 4, true);
        const yNum = view.getInt32(dataOff + 8, true);
        const yDenom = view.getInt32(dataOff + 12, true);
        if (xDenom !== 0) {
          rCtx.viewportExt.cx = Math.round(rCtx.viewportExt.cx * xNum / xDenom);
        }
        if (yDenom !== 0) {
          rCtx.viewportExt.cy = Math.round(rCtx.viewportExt.cy * yNum / yDenom);
        }
        activateGdiMappingMode(rCtx);
      }
      return true;
    }
    case EMR_SCALEWINDOWEXTEX: {
      if (recSize >= 24) {
        const xNum = view.getInt32(dataOff, true);
        const xDenom = view.getInt32(dataOff + 4, true);
        const yNum = view.getInt32(dataOff + 8, true);
        const yDenom = view.getInt32(dataOff + 12, true);
        if (xDenom !== 0) {
          rCtx.windowExt.cx = Math.round(rCtx.windowExt.cx * xNum / xDenom);
        }
        if (yDenom !== 0) {
          rCtx.windowExt.cy = Math.round(rCtx.windowExt.cy * yNum / yDenom);
        }
        activateGdiMappingMode(rCtx);
      }
      return true;
    }
    default:
      return false;
  }
}
function handleWorldTransformRecord(rCtx, recType, dataOff, recSize) {
  const { view, state } = rCtx;
  switch (recType) {
    case EMR_SETWORLDTRANSFORM: {
      if (recSize >= 32) {
        state.worldTransform = [
          view.getFloat32(dataOff, true),
          view.getFloat32(dataOff + 4, true),
          view.getFloat32(dataOff + 8, true),
          view.getFloat32(dataOff + 12, true),
          view.getFloat32(dataOff + 16, true),
          view.getFloat32(dataOff + 20, true)
        ];
      }
      return true;
    }
    case EMR_MODIFYWORLDTRANSFORM: {
      if (recSize >= 36) {
        const mode = view.getUint32(dataOff + 24, true);
        if (mode === 1) {
          state.worldTransform = [1, 0, 0, 1, 0, 0];
        } else if (mode === 2 || mode === 3) {
          const xf = [
            view.getFloat32(dataOff, true),
            view.getFloat32(dataOff + 4, true),
            view.getFloat32(dataOff + 8, true),
            view.getFloat32(dataOff + 12, true),
            view.getFloat32(dataOff + 16, true),
            view.getFloat32(dataOff + 20, true)
          ];
          const [a1, b1, c1, d1, e1, f1] = state.worldTransform;
          if (mode === 2) {
            state.worldTransform = [
              xf[0] * a1 + xf[1] * c1,
              xf[0] * b1 + xf[1] * d1,
              xf[2] * a1 + xf[3] * c1,
              xf[2] * b1 + xf[3] * d1,
              xf[4] * a1 + xf[5] * c1 + e1,
              xf[4] * b1 + xf[5] * d1 + f1
            ];
          } else {
            state.worldTransform = [
              a1 * xf[0] + b1 * xf[2],
              a1 * xf[1] + b1 * xf[3],
              c1 * xf[0] + d1 * xf[2],
              c1 * xf[1] + d1 * xf[3],
              e1 * xf[0] + f1 * xf[2] + xf[4],
              e1 * xf[1] + f1 * xf[3] + xf[5]
            ];
          }
        }
      }
      return true;
    }
    default:
      return false;
  }
}
function handleEmfTransformRecord(rCtx, recType, dataOff, recSize) {
  return handleCoordinateRecord(rCtx, recType, dataOff, recSize) || handleWorldTransformRecord(rCtx, recType, dataOff, recSize);
}
function defaultState() {
  return {
    penColor: "#000000",
    penWidth: 1,
    penStyle: 0,
    brushColor: "#ffffff",
    brushStyle: 0,
    brushPattern: null,
    textColor: "#000000",
    bkColor: "#ffffff",
    bkMode: 1,
    fontHeight: 12,
    fontWeight: 400,
    fontItalic: false,
    fontFamily: "sans-serif",
    fontUnderline: false,
    fontStrikeOut: false,
    fontEscapement: 0,
    rop2: 13,
    curX: 0,
    curY: 0,
    polyFillMode: 1,
    textAlign: 0,
    worldTransform: [1, 0, 0, 1, 0, 0]
  };
}
function cloneState(s) {
  return {
    ...s,
    worldTransform: [...s.worldTransform]
  };
}
function createEmfPlusState() {
  return {
    objectTable: /* @__PURE__ */ new Map(),
    worldTransform: [1, 0, 0, 1, 0, 0],
    saveStack: [],
    saveIdMap: /* @__PURE__ */ new Map(),
    clipRegion: null,
    clipSaveDepth: 0,
    // EMF+ dual-mode files carry a full GDI fallback too; GDI drawing records are only
    // meant to run right after an EmfPlusGetDC, until the next EMF+ record (MS-EMFPLUS 2.3.1.3)
    dualMode: false,
    gdiEnabled: true,
    // DrawImage ordinal across all EMF+ comments: keys the pre-decoded bitmaps of pass 2
    drawImageOrdinal: 0,
    // Continued objects (64 KiB chunks) span EMR_COMMENT records, so the assembly buffer
    // lives with the shared state, not the per-comment replay context
    continuation: {
      buffer: null,
      objectId: -1,
      objectType: 0,
      totalSize: 0,
      offset: 0
    }
  };
}
function handleEmfGdiStateRecord(rCtx, recType, _offset, dataOff, recSize) {
  if (handleEmfTransformRecord(rCtx, recType, dataOff, recSize)) {
    return true;
  }
  if (handleEmfObjectRecord(rCtx, recType, dataOff, recSize)) {
    return true;
  }
  const { ctx, view, state } = rCtx;
  switch (recType) {
    // ---- save / restore ----
    case EMR_SAVEDC: {
      while (rCtx.clipSaveDepth > 0) {
        ctx.restore();
        rCtx.clipSaveDepth--;
      }
      rCtx.clipStack ?? (rCtx.clipStack = []);
      rCtx.clipStack.push({
        region: rCtx.clipRegion ?? null,
        untracked: rCtx.clipUntracked ?? false
      });
      rCtx.stateStack.push(cloneState(state));
      ctx.save();
      if (rCtx.clipUntracked) {
        rCtx.clipUntracked = false;
        rCtx.clipRegion = null;
      } else if (rCtx.clipRegion) {
        reapplyClipRegion(rCtx, rCtx.clipRegion);
      }
      return true;
    }
    case EMR_RESTOREDC: {
      if (recSize >= 12) {
        while (rCtx.clipSaveDepth > 0) {
          ctx.restore();
          rCtx.clipSaveDepth--;
        }
        let rel = view.getInt32(dataOff, true);
        if (rel < 0) {
          rel = rCtx.stateStack.length + rel + 1;
        }
        while (rCtx.stateStack.length > rel && rCtx.stateStack.length > 0) {
          rCtx.stateStack.pop();
          rCtx.clipStack?.pop();
          ctx.restore();
        }
        const restored = rCtx.stateStack.pop();
        if (restored) {
          const clipSnapshot = rCtx.clipStack?.pop();
          Object.assign(state, restored);
          ctx.restore();
          rCtx.clipRegion = clipSnapshot?.region ?? null;
          rCtx.clipUntracked = false;
          if (rCtx.clipRegion) {
            reapplyClipRegion(rCtx, rCtx.clipRegion);
          }
        }
      }
      return true;
    }
    // ---- drawing mode / color settings ----
    case EMR_SETTEXTCOLOR: {
      if (recSize >= 12) {
        state.textColor = readColorRef(view, dataOff);
      }
      return true;
    }
    case EMR_SETBKCOLOR: {
      if (recSize >= 12) {
        state.bkColor = readColorRef(view, dataOff);
      }
      return true;
    }
    case EMR_SETBKMODE: {
      if (recSize >= 12) {
        state.bkMode = view.getUint32(dataOff, true);
      }
      return true;
    }
    case EMR_SETPOLYFILLMODE: {
      if (recSize >= 12) {
        state.polyFillMode = view.getUint32(dataOff, true);
      }
      return true;
    }
    case EMR_SETROP2: {
      if (recSize >= 12) {
        state.rop2 = view.getUint32(dataOff, true);
      }
      return true;
    }
    case EMR_SETSTRETCHBLTMODE:
    case EMR_SETMITERLIMIT:
    case EMR_SETTEXTALIGN: {
      if (recType === EMR_SETTEXTALIGN && recSize >= 12) {
        state.textAlign = view.getUint32(dataOff, true);
      }
      return true;
    }
    default:
      return false;
  }
}
function readRectFromView(view, offset, compressed) {
  if (compressed) {
    return {
      x: view.getInt16(offset, true),
      y: view.getInt16(offset + 2, true),
      w: view.getInt16(offset + 4, true),
      h: view.getInt16(offset + 6, true)
    };
  }
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    w: view.getFloat32(offset + 8, true),
    h: view.getFloat32(offset + 12, true)
  };
}
function readPointFromView(view, offset, compressed) {
  if (compressed) {
    return {
      x: view.getInt16(offset, true),
      y: view.getInt16(offset + 2, true)
    };
  }
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true)
  };
}
function parseEmfPlusPath(data, off, maxLen) {
  if (maxLen < 12) {
    return null;
  }
  data.getUint32(off, true);
  const pointCount = data.getUint32(off + 4, true);
  const pathFlags = data.getUint32(off + 8, true);
  if (pointCount === 0 || pointCount > 1e5) {
    return null;
  }
  const compressed = (pathFlags & 16384) !== 0;
  const pointSize = compressed ? 4 : 8;
  const pointsBytes = pointCount * pointSize;
  const typesBytes = pointCount;
  const neededAfterHeader = pointsBytes + typesBytes;
  if (12 + neededAfterHeader > maxLen) {
    return null;
  }
  const points = [];
  let pOff = off + 12;
  for (let i = 0; i < pointCount; i++) {
    if (compressed) {
      points.push({
        x: data.getInt16(pOff, true),
        y: data.getInt16(pOff + 2, true)
      });
      pOff += 4;
    } else {
      points.push({
        x: data.getFloat32(pOff, true),
        y: data.getFloat32(pOff + 4, true)
      });
      pOff += 8;
    }
  }
  const alignedPOff = pOff + 3 & -4;
  const types = new Uint8Array(data.buffer, data.byteOffset + alignedPOff, pointCount);
  return { kind: "plus-path", points, types: new Uint8Array(types) };
}
function emfPlusPathToClipCmds(path, m) {
  const tx = (x, y) => m[0] * x + m[2] * y + m[4];
  const ty = (x, y) => m[1] * x + m[3] * y + m[5];
  const cmds = [];
  const pts = path.points;
  const types = path.types;
  let i = 0;
  while (i < pts.length) {
    const t = types[i] & 15;
    const close = (types[i] & 128) !== 0;
    if (t === 0) {
      cmds.push({ op: "moveTo", x: tx(pts[i].x, pts[i].y), y: ty(pts[i].x, pts[i].y) });
      i++;
    } else if (t === 3) {
      if (i + 2 < pts.length) {
        cmds.push({
          op: "bezierCurveTo",
          cp1x: tx(pts[i].x, pts[i].y),
          cp1y: ty(pts[i].x, pts[i].y),
          cp2x: tx(pts[i + 1].x, pts[i + 1].y),
          cp2y: ty(pts[i + 1].x, pts[i + 1].y),
          x: tx(pts[i + 2].x, pts[i + 2].y),
          y: ty(pts[i + 2].x, pts[i + 2].y)
        });
        if ((types[i + 2] & 128) !== 0) {
          cmds.push({ op: "closePath" });
        }
        i += 3;
        continue;
      }
      break;
    } else {
      cmds.push({ op: "lineTo", x: tx(pts[i].x, pts[i].y), y: ty(pts[i].x, pts[i].y) });
      i++;
    }
    if (close) {
      cmds.push({ op: "closePath" });
    }
  }
  return cmds;
}
function replayEmfPlusPath(ctx, path) {
  ctx.beginPath();
  const pts = path.points;
  const types = path.types;
  let i = 0;
  while (i < pts.length) {
    const t = types[i] & 15;
    const close = (types[i] & 128) !== 0;
    if (t === 0) {
      ctx.moveTo(pts[i].x, pts[i].y);
      i++;
    } else if (t === 1) {
      ctx.lineTo(pts[i].x, pts[i].y);
      i++;
    } else if (t === 3) {
      if (i + 2 < pts.length) {
        ctx.bezierCurveTo(
          pts[i].x,
          pts[i].y,
          pts[i + 1].x,
          pts[i + 1].y,
          pts[i + 2].x,
          pts[i + 2].y
        );
        if ((types[i + 2] & 128) !== 0) {
          ctx.closePath();
        }
        i += 3;
        continue;
      } else {
        break;
      }
    } else {
      ctx.lineTo(pts[i].x, pts[i].y);
      i++;
    }
    if (close) {
      ctx.closePath();
    }
  }
}
function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}
function createBrushGradient(rCtx, grad) {
  const ctx = rCtx.ctx;
  try {
    let g = null;
    if (grad.type === "linear" && typeof ctx.createLinearGradient === "function") {
      if (grad.x1 === grad.x2 && grad.y1 === grad.y2) {
        return null;
      }
      g = ctx.createLinearGradient(grad.x1, grad.y1, grad.x2, grad.y2);
    } else if (grad.type === "radial" && typeof ctx.createRadialGradient === "function") {
      if (!(grad.r > 0)) {
        return null;
      }
      g = ctx.createRadialGradient(grad.cx, grad.cy, 0, grad.cx, grad.cy, grad.r);
    }
    if (!g) {
      return null;
    }
    for (const stop of grad.stops) {
      g.addColorStop(stop.offset, stop.color);
    }
    return g;
  } catch {
    return null;
  }
}
function resolveBrushPaint(rCtx, flags, brushIdOrColor) {
  if (flags & 32768) {
    return argbToRgba(brushIdOrColor);
  }
  const obj = rCtx.objectTable.get(brushIdOrColor & 255);
  if (obj && obj.kind === "plus-brush") {
    if (obj.gradient) {
      const g = createBrushGradient(rCtx, obj.gradient);
      if (g) {
        return g;
      }
    }
    return obj.color;
  }
  return "rgba(0,0,0,1)";
}
function getPageUnitMultiplier(pageUnit, pageScale) {
  const DPI = 96;
  let unitToPixel;
  switch (pageUnit) {
    case 3:
      unitToPixel = DPI / 72;
      break;
    // Point
    case 4:
      unitToPixel = DPI;
      break;
    // Inch
    case 5:
      unitToPixel = DPI / 300;
      break;
    // Document
    case 6:
      unitToPixel = DPI / 25.4;
      break;
    // Millimeter
    default:
      unitToPixel = 1;
      break;
  }
  return unitToPixel * pageScale;
}
function plusDeviceMatrix(rCtx) {
  const wt = rCtx.worldTransform;
  const m = getPageUnitMultiplier(rCtx.pageUnit, rCtx.pageScale);
  const dm = rCtx.deviceMap;
  if (!dm) {
    const d = rCtx.dpiScale;
    return [wt[0] * m * d, wt[1] * m * d, wt[2] * m * d, wt[3] * m * d, wt[4] * m * d, wt[5] * m * d];
  }
  return [
    wt[0] * m * dm.sx,
    wt[1] * m * dm.sy,
    wt[2] * m * dm.sx,
    wt[3] * m * dm.sy,
    (wt[4] * m - dm.left) * dm.sx,
    (wt[5] * m - dm.top) * dm.sy
  ];
}
function drawPreDecodedImage(rCtx, dx, dy, dw, dh) {
  if (!rCtx.preDecoded || !rCtx.shared) return false;
  const bitmap = rCtx.preDecoded[rCtx.shared.drawImageOrdinal++];
  if (bitmap === void 0) return false;
  if (bitmap) {
    applyPlusWorldTransform(rCtx);
    rCtx.ctx.drawImage(bitmap, dx, dy, dw, dh);
  }
  return true;
}
function applyPlusWorldTransform(rCtx) {
  const t = plusDeviceMatrix(rCtx);
  rCtx.ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
}
function pushState(rCtx, stackId) {
  rCtx.saveStack.push({
    transform: [...rCtx.worldTransform]
  });
  rCtx.saveIdMap.set(stackId, rCtx.saveStack.length - 1);
}
function popState(rCtx, stackId) {
  const idx = rCtx.saveIdMap.get(stackId);
  if (idx !== void 0 && idx < rCtx.saveStack.length) {
    rCtx.worldTransform = [...rCtx.saveStack[idx].transform];
    rCtx.saveStack.length = idx;
    const newMap = /* @__PURE__ */ new Map();
    for (const [k, v] of rCtx.saveIdMap) {
      if (v < idx) {
        newMap.set(k, v);
      }
    }
    rCtx.saveIdMap = newMap;
  }
}
function transformedRectShape(x, y, w, h, m) {
  const tx = (px, py) => m[0] * px + m[2] * py + m[4];
  const ty = (px, py) => m[1] * px + m[3] * py + m[5];
  const cmds = [
    { op: "moveTo", x: tx(x, y), y: ty(x, y) },
    { op: "lineTo", x: tx(x + w, y), y: ty(x + w, y) },
    { op: "lineTo", x: tx(x + w, y + h), y: ty(x + w, y + h) },
    { op: "lineTo", x: tx(x, y + h), y: ty(x, y + h) },
    { op: "closePath" }
  ];
  return { cmds, fillRule: "nonzero", simple: true };
}
function pathClipShape(path, m) {
  return { cmds: emfPlusPathToClipCmds(path.path, m), fillRule: "nonzero", simple: true };
}
var REGION_NODE_OPS = {
  0: "intersect",
  // legacy/lenient: treat 0 as And
  1: "intersect",
  // RegionNodeDataTypeAnd
  2: "union",
  // RegionNodeDataTypeOr
  3: "xor",
  // RegionNodeDataTypeXor
  4: "exclude",
  // RegionNodeDataTypeExclude
  5: "complement"
  // RegionNodeDataTypeComplement
};
var MAX_REGION_FLATTEN_DEPTH = 64;
function flattenRegionNode(node, m, depth = 0) {
  if (depth > MAX_REGION_FLATTEN_DEPTH) {
    return { region: [emptyClipShape()], exact: false };
  }
  switch (node.type) {
    case "rect":
      return { region: [transformedRectShape(node.x, node.y, node.width, node.height, m)], exact: true };
    case "path":
      return { region: [pathClipShape(node, m)], exact: true };
    case "infinite":
      return { region: null, exact: true };
    case "empty":
      return { region: [emptyClipShape()], exact: true };
    case "combine": {
      const left = flattenRegionNode(node.left, m, depth + 1);
      const right = flattenRegionNode(node.right, m, depth + 1);
      const op = REGION_NODE_OPS[node.combineMode] ?? "intersect";
      const combined = combineClipRegions(left.region, right.region, op);
      return { region: combined.region, exact: combined.exact && left.exact && right.exact };
    }
  }
}
var PLUS_COMBINE_OPS = {
  0: "replace",
  1: "intersect",
  2: "union",
  3: "xor",
  4: "exclude",
  5: "complement"
};
function reapplyPlusClip(rCtx) {
  reapplyClipRegion(rCtx, rCtx.clipRegion ?? null, true);
}
function applyPlusClipRegion(rCtx, incoming, combineMode, opName) {
  const op = PLUS_COMBINE_OPS[combineMode];
  const res = combineClipRegions(rCtx.clipRegion ?? null, incoming, op ?? "intersect");
  if (!res.exact) ;
  rCtx.clipRegion = res.region;
  reapplyPlusClip(rCtx);
}
function applyPlusClipShape(rCtx, shape, combineMode, opName) {
  applyPlusClipRegion(rCtx, [shape], combineMode);
}
function handleEmfPlusStateRecord(rCtx, recType, recFlags, dataOff, recDataSize) {
  const { view } = rCtx;
  switch (recType) {
    // ---- transforms ----
    case EMFPLUS_SETWORLDTRANSFORM: {
      if (recDataSize >= 24) {
        rCtx.worldTransform = [
          view.getFloat32(dataOff, true),
          view.getFloat32(dataOff + 4, true),
          view.getFloat32(dataOff + 8, true),
          view.getFloat32(dataOff + 12, true),
          view.getFloat32(dataOff + 16, true),
          view.getFloat32(dataOff + 20, true)
        ];
      }
      return true;
    }
    case EMFPLUS_RESETWORLDTRANSFORM: {
      rCtx.worldTransform = [1, 0, 0, 1, 0, 0];
      return true;
    }
    case EMFPLUS_MULTIPLYWORLDTRANSFORM: {
      if (recDataSize >= 24) {
        const xf = [
          view.getFloat32(dataOff, true),
          view.getFloat32(dataOff + 4, true),
          view.getFloat32(dataOff + 8, true),
          view.getFloat32(dataOff + 12, true),
          view.getFloat32(dataOff + 16, true),
          view.getFloat32(dataOff + 20, true)
        ];
        if (recFlags & 8192) {
          rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
        } else {
          rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
        }
      }
      return true;
    }
    case EMFPLUS_TRANSLATEWORLDTRANSFORM: {
      if (recDataSize >= 8) {
        const dx = view.getFloat32(dataOff, true);
        const dy = view.getFloat32(dataOff + 4, true);
        const xf = [1, 0, 0, 1, dx, dy];
        if (recFlags & 8192) {
          rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
        } else {
          rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
        }
      }
      return true;
    }
    case EMFPLUS_SCALEWORLDTRANSFORM: {
      if (recDataSize >= 8) {
        const sx = view.getFloat32(dataOff, true);
        const sy = view.getFloat32(dataOff + 4, true);
        const xf = [sx, 0, 0, sy, 0, 0];
        if (recFlags & 8192) {
          rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
        } else {
          rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
        }
      }
      return true;
    }
    case EMFPLUS_ROTATEWORLDTRANSFORM: {
      if (recDataSize >= 4) {
        const angle = view.getFloat32(dataOff, true) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const xf = [cos, sin, -sin, cos, 0, 0];
        if (recFlags & 8192) {
          rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
        } else {
          rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
        }
      }
      return true;
    }
    // ---- save / restore ----
    case EMFPLUS_SAVE: {
      if (recDataSize >= 4) {
        pushState(rCtx, view.getUint32(dataOff, true));
      }
      return true;
    }
    case EMFPLUS_RESTORE: {
      if (recDataSize >= 4) {
        popState(rCtx, view.getUint32(dataOff, true));
      }
      return true;
    }
    // ---- clipping ----
    case EMFPLUS_SETCLIPRECT: {
      if (recDataSize >= 16) {
        const combineMode = recFlags >> 8 & 15;
        const cx = view.getFloat32(dataOff, true);
        const cy = view.getFloat32(dataOff + 4, true);
        const cw = view.getFloat32(dataOff + 8, true);
        const ch = view.getFloat32(dataOff + 12, true);
        const shape = transformedRectShape(cx, cy, cw, ch, plusDeviceMatrix(rCtx));
        applyPlusClipShape(rCtx, shape, combineMode);
      }
      return true;
    }
    case EMFPLUS_RESETCLIP: {
      rCtx.clipRegion = null;
      reapplyPlusClip(rCtx);
      return true;
    }
    case EMFPLUS_SETCLIPREGION: {
      const regionId = recFlags & 255;
      const combineMode = recFlags >> 8 & 15;
      const regionObj = rCtx.objectTable.get(regionId);
      if (regionObj && regionObj.kind === "plus-region" && regionObj.nodes.length > 0) {
        const flattened = flattenRegionNode(regionObj.nodes[0], plusDeviceMatrix(rCtx));
        if (!flattened.exact) ;
        applyPlusClipRegion(rCtx, flattened.region, combineMode);
      }
      return true;
    }
    case EMFPLUS_SETCLIPPATH: {
      const pathId = recFlags & 255;
      const combineMode = recFlags >> 8 & 15;
      const pathObj = rCtx.objectTable.get(pathId);
      if (pathObj && pathObj.kind === "plus-path") {
        const shape = {
          cmds: emfPlusPathToClipCmds(pathObj, plusDeviceMatrix(rCtx)),
          fillRule: "nonzero",
          simple: true
        };
        applyPlusClipShape(rCtx, shape, combineMode);
      }
      return true;
    }
    case EMFPLUS_OFFSETCLIP: {
      if (recDataSize >= 8) {
        const dx = view.getFloat32(dataOff, true);
        const dy = view.getFloat32(dataOff + 4, true);
        if (rCtx.clipRegion) {
          const m = plusDeviceMatrix(rCtx);
          const ddx = m[0] * dx + m[2] * dy;
          const ddy = m[1] * dx + m[3] * dy;
          rCtx.clipRegion = translateClipRegion(rCtx.clipRegion, ddx, ddy);
          reapplyPlusClip(rCtx);
        }
      }
      return true;
    }
    // ---- containers ----
    case EMFPLUS_BEGINCONTAINERNOPARAMS: {
      if (recDataSize >= 4) {
        pushState(rCtx, view.getUint32(dataOff, true));
      }
      return true;
    }
    case EMFPLUS_ENDCONTAINER: {
      if (recDataSize >= 4) {
        popState(rCtx, view.getUint32(dataOff, true));
      }
      return true;
    }
    // ---- page transform ----
    case EMFPLUS_SETPAGETRANSFORM: {
      const pageUnit = recFlags & 255;
      const pageScale = recDataSize >= 4 ? view.getFloat32(dataOff, true) : 1;
      rCtx.pageUnit = pageUnit;
      rCtx.pageScale = pageScale;
      return true;
    }
    // ---- rendering hints (accepted, ignored) ----
    case EMFPLUS_SETANTIALIASMODE:
    case EMFPLUS_SETTEXTRENDERINGHINT:
    case EMFPLUS_SETINTERPOLATIONMODE:
    case EMFPLUS_SETPIXELOFFSETMODE:
    case EMFPLUS_SETCOMPOSITINGQUALITY:
      return true;
    default:
      return false;
  }
}
function applyEmfPlusPen(ctx, pen) {
  ctx.strokeStyle = pen.color;
  ctx.lineWidth = pen.width;
  const w = pen.width || 1;
  switch (pen.dashStyle) {
    case 1:
      ctx.setLineDash([w * 3, Number(w)]);
      break;
    // Dash
    case 2:
      ctx.setLineDash([Number(w), Number(w)]);
      break;
    // Dot
    case 3:
      ctx.setLineDash([w * 3, Number(w), Number(w), Number(w)]);
      break;
    // DashDot
    case 4:
      ctx.setLineDash([w * 3, Number(w), Number(w), Number(w), Number(w), Number(w)]);
      break;
    // DashDotDot
    default:
      ctx.setLineDash([]);
      break;
  }
}
function handleEmfPlusDrawRecord(rCtx, recType, recFlags, dataOff, recDataSize) {
  const { ctx, view, objectTable } = rCtx;
  switch (recType) {
    case EMFPLUS_FILLRECTS: {
      if (recDataSize >= 8) {
        const brushVal = view.getUint32(dataOff, true);
        const count = view.getUint32(dataOff + 4, true);
        const compressed = (recFlags & 16384) !== 0;
        const rectSize = compressed ? 8 : 16;
        ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
        applyPlusWorldTransform(rCtx);
        let rOff = dataOff + 8;
        for (let i = 0; i < count && rOff + rectSize <= dataOff + recDataSize; i++) {
          const { x, y, w, h } = readRectFromView(view, rOff, compressed);
          ctx.fillRect(x, y, w, h);
          rOff += rectSize;
        }
      }
      return true;
    }
    case EMFPLUS_DRAWRECTS: {
      if (recDataSize >= 4) {
        const penId = recFlags & 255;
        const pen = objectTable.get(penId);
        const count = view.getUint32(dataOff, true);
        const compressed = (recFlags & 16384) !== 0;
        const rectSize = compressed ? 8 : 16;
        if (pen && pen.kind === "plus-pen") {
          applyEmfPlusPen(ctx, pen);
        }
        applyPlusWorldTransform(rCtx);
        let rOff = dataOff + 4;
        for (let i = 0; i < count && rOff + rectSize <= dataOff + recDataSize; i++) {
          const { x, y, w, h } = readRectFromView(view, rOff, compressed);
          ctx.strokeRect(x, y, w, h);
          rOff += rectSize;
        }
      }
      return true;
    }
    case EMFPLUS_FILLELLIPSE: {
      if (recDataSize >= 12) {
        const brushVal = view.getUint32(dataOff, true);
        const compressed = (recFlags & 16384) !== 0;
        let x, y, w, h;
        if (compressed) {
          x = view.getInt16(dataOff + 4, true);
          y = view.getInt16(dataOff + 6, true);
          w = view.getInt16(dataOff + 8, true);
          h = view.getInt16(dataOff + 10, true);
        } else {
          if (recDataSize < 20) {
            return true;
          }
          x = view.getFloat32(dataOff + 4, true);
          y = view.getFloat32(dataOff + 8, true);
          w = view.getFloat32(dataOff + 12, true);
          h = view.getFloat32(dataOff + 16, true);
        }
        ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
        applyPlusWorldTransform(rCtx);
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    }
    case EMFPLUS_DRAWELLIPSE: {
      const penId = recFlags & 255;
      const pen = objectTable.get(penId);
      const compressed = (recFlags & 16384) !== 0;
      let x, y, w, h;
      if (compressed && recDataSize >= 8) {
        x = view.getInt16(dataOff, true);
        y = view.getInt16(dataOff + 2, true);
        w = view.getInt16(dataOff + 4, true);
        h = view.getInt16(dataOff + 6, true);
      } else if (!compressed && recDataSize >= 16) {
        x = view.getFloat32(dataOff, true);
        y = view.getFloat32(dataOff + 4, true);
        w = view.getFloat32(dataOff + 8, true);
        h = view.getFloat32(dataOff + 12, true);
      } else {
        return true;
      }
      if (pen && pen.kind === "plus-pen") {
        applyEmfPlusPen(ctx, pen);
      }
      applyPlusWorldTransform(rCtx);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      return true;
    }
    case EMFPLUS_FILLPIE:
    case EMFPLUS_DRAWPIE:
    case EMFPLUS_DRAWARC: {
      const isFill = recType === EMFPLUS_FILLPIE;
      const minSize = isFill ? 12 : 8;
      if (recDataSize < minSize) {
        return true;
      }
      let aOff = dataOff;
      if (isFill) {
        const brushVal = view.getUint32(aOff, true);
        ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
        aOff += 4;
      }
      const startAngle = view.getFloat32(aOff, true) * Math.PI / 180;
      const sweepAngle = view.getFloat32(aOff + 4, true) * Math.PI / 180;
      aOff += 8;
      const compressed = (recFlags & 16384) !== 0;
      let x, y, w, h;
      if (compressed && aOff + 8 <= dataOff + recDataSize) {
        x = view.getInt16(aOff, true);
        y = view.getInt16(aOff + 2, true);
        w = view.getInt16(aOff + 4, true);
        h = view.getInt16(aOff + 6, true);
      } else if (!compressed && aOff + 16 <= dataOff + recDataSize) {
        x = view.getFloat32(aOff, true);
        y = view.getFloat32(aOff + 4, true);
        w = view.getFloat32(aOff + 8, true);
        h = view.getFloat32(aOff + 12, true);
      } else {
        return true;
      }
      if (recType !== EMFPLUS_FILLPIE) {
        const penId = recFlags & 255;
        const pen = objectTable.get(penId);
        if (pen && pen.kind === "plus-pen") {
          applyEmfPlusPen(ctx, pen);
        }
      }
      applyPlusWorldTransform(rCtx);
      ctx.beginPath();
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      if (isFill) {
        ctx.moveTo(cx, cy);
      }
      ctx.ellipse(cx, cy, rx, ry, 0, startAngle, startAngle + sweepAngle, sweepAngle < 0);
      if (isFill) {
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.stroke();
      }
      return true;
    }
    case EMFPLUS_DRAWLINES: {
      if (recDataSize >= 4) {
        const penId = recFlags & 255;
        const pen = objectTable.get(penId);
        const count = view.getUint32(dataOff, true);
        const compressed = (recFlags & 16384) !== 0;
        const ptSize = compressed ? 4 : 8;
        if (pen && pen.kind === "plus-pen") {
          applyEmfPlusPen(ctx, pen);
        }
        applyPlusWorldTransform(rCtx);
        ctx.beginPath();
        let pOff = dataOff + 4;
        for (let i = 0; i < count && pOff + ptSize <= dataOff + recDataSize; i++) {
          const pt = readPointFromView(view, pOff, compressed);
          if (i === 0) {
            ctx.moveTo(pt.x, pt.y);
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
          pOff += ptSize;
        }
        if (recFlags & 8192) {
          ctx.closePath();
        }
        ctx.stroke();
      }
      return true;
    }
    case EMFPLUS_FILLPOLYGON: {
      if (recDataSize >= 8) {
        const brushVal = view.getUint32(dataOff, true);
        const count = view.getUint32(dataOff + 4, true);
        const compressed = (recFlags & 16384) !== 0;
        const ptSize = compressed ? 4 : 8;
        ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
        applyPlusWorldTransform(rCtx);
        ctx.beginPath();
        let pOff = dataOff + 8;
        for (let i = 0; i < count && pOff + ptSize <= dataOff + recDataSize; i++) {
          const pt = readPointFromView(view, pOff, compressed);
          if (i === 0) {
            ctx.moveTo(pt.x, pt.y);
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
          pOff += ptSize;
        }
        ctx.closePath();
        ctx.fill();
      }
      return true;
    }
    default:
      return false;
  }
}
var BRUSH_DATA_PATH = 1;
var BRUSH_DATA_TRANSFORM = 2;
var BRUSH_DATA_PRESET_COLORS = 4;
var BRUSH_DATA_BLEND_FACTORS_H = 8;
var MAX_GRADIENT_ELEMENTS = 4096;
function looksLikeGraphicsVersion(v) {
  return v >>> 12 === 900097;
}
function readTransform(view, off) {
  return [
    view.getFloat32(off, true),
    view.getFloat32(off + 4, true),
    view.getFloat32(off + 8, true),
    view.getFloat32(off + 12, true),
    view.getFloat32(off + 16, true),
    view.getFloat32(off + 20, true)
  ];
}
function applyMatrix(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
function normaliseStops(stops) {
  return stops.map((s) => ({ offset: clamp01(s.offset), color: s.color })).sort((a, b) => a.offset - b.offset);
}
function readPresetColors(view, off, end) {
  if (off + 4 > end) {
    return null;
  }
  const count = view.getUint32(off, true);
  if (count === 0 || count > MAX_GRADIENT_ELEMENTS) {
    return null;
  }
  const posOff = off + 4;
  const colOff = posOff + count * 4;
  const next = colOff + count * 4;
  if (next > end) {
    return null;
  }
  const stops = [];
  for (let i = 0; i < count; i++) {
    stops.push({
      offset: view.getFloat32(posOff + i * 4, true),
      color: argbToRgba(view.getUint32(colOff + i * 4, true))
    });
  }
  return { stops, next };
}
function readBlendFactors(view, off, end) {
  if (off + 4 > end) {
    return null;
  }
  const count = view.getUint32(off, true);
  if (count === 0 || count > MAX_GRADIENT_ELEMENTS) {
    return null;
  }
  const posOff = off + 4;
  const facOff = posOff + count * 4;
  const next = facOff + count * 4;
  if (next > end) {
    return null;
  }
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      pos: view.getFloat32(posOff + i * 4, true),
      factor: view.getFloat32(facOff + i * 4, true)
    });
  }
  return { entries, next };
}
function parseLinearGradient(view, b, end) {
  if (b + 40 > end) {
    return null;
  }
  const flags = view.getUint32(b, true);
  const rx = view.getFloat32(b + 8, true);
  const ry = view.getFloat32(b + 12, true);
  const rw = view.getFloat32(b + 16, true);
  const rh = view.getFloat32(b + 20, true);
  const startArgb = view.getUint32(b + 24, true);
  const endArgb = view.getUint32(b + 28, true);
  let o = b + 40;
  let transform = null;
  if (flags & BRUSH_DATA_TRANSFORM && o + 24 <= end) {
    transform = readTransform(view, o);
    o += 24;
  }
  let stops = [
    { offset: 0, color: argbToRgba(startArgb) },
    { offset: 1, color: argbToRgba(endArgb) }
  ];
  if (flags & BRUSH_DATA_PRESET_COLORS) {
    const preset = readPresetColors(view, o, end);
    if (preset) {
      stops = preset.stops;
    }
  } else if (flags & BRUSH_DATA_BLEND_FACTORS_H) {
    const blend = readBlendFactors(view, o, end);
    if (blend) {
      stops = blend.entries.map((e) => ({
        offset: e.pos,
        color: lerpArgbToRgba(startArgb, endArgb, e.factor)
      }));
    }
  }
  let p1 = { x: rx, y: ry + rh / 2 };
  let p2 = { x: rx + rw, y: ry + rh / 2 };
  if (transform) {
    p1 = applyMatrix(transform, p1.x, p1.y);
    p2 = applyMatrix(transform, p2.x, p2.y);
  }
  emfLog(
    `parseEmfPlusBrushObject: linear gradient (${p1.x.toFixed(1)},${p1.y.toFixed(1)})\u2192(${p2.x.toFixed(1)},${p2.y.toFixed(1)}), ${stops.length} stop(s)`
  );
  return {
    kind: "plus-brush",
    color: argbToRgba(startArgb),
    gradient: {
      type: "linear",
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      stops: normaliseStops(stops)
    }
  };
}
function parsePathGradient(view, b, end) {
  if (b + 24 > end) {
    return null;
  }
  const flags = view.getUint32(b, true);
  const centerArgb = view.getUint32(b + 8, true);
  let cx = view.getFloat32(b + 12, true);
  let cy = view.getFloat32(b + 16, true);
  const surroundCount = view.getUint32(b + 20, true);
  if (surroundCount > MAX_GRADIENT_ELEMENTS) {
    return { kind: "plus-brush", color: argbToRgba(centerArgb) };
  }
  const surround = [];
  let o = b + 24;
  for (let i = 0; i < surroundCount && o + 4 <= end; i++) {
    surround.push(view.getUint32(o, true));
    o += 4;
  }
  let boundaryPts = [];
  if (flags & BRUSH_DATA_PATH) {
    if (o + 4 <= end) {
      const pathSize = view.getInt32(o, true);
      o += 4;
      if (pathSize > 0 && o + pathSize <= end) {
        const path = parseEmfPlusPath(view, o, pathSize);
        if (path) {
          boundaryPts = path.points;
        }
        o += pathSize;
      }
    }
  } else if (o + 4 <= end) {
    const ptCount = view.getUint32(o, true);
    o += 4;
    if (ptCount > 0 && ptCount <= MAX_GRADIENT_ELEMENTS && o + ptCount * 8 <= end) {
      for (let i = 0; i < ptCount; i++) {
        boundaryPts.push({
          x: view.getFloat32(o + i * 8, true),
          y: view.getFloat32(o + i * 8 + 4, true)
        });
      }
      o += ptCount * 8;
    }
  }
  let transform = null;
  if (flags & BRUSH_DATA_TRANSFORM && o + 24 <= end) {
    transform = readTransform(view, o);
    o += 24;
  }
  if (transform) {
    ({ x: cx, y: cy } = applyMatrix(transform, cx, cy));
    boundaryPts = boundaryPts.map((p) => applyMatrix(transform, p.x, p.y));
  }
  const surroundArgb = surround.length > 0 ? surround[0] : centerArgb;
  let stops = [
    { offset: 0, color: argbToRgba(centerArgb) },
    { offset: 1, color: argbToRgba(surroundArgb) }
  ];
  if (flags & BRUSH_DATA_PRESET_COLORS) {
    const preset = readPresetColors(view, o, end);
    if (preset) {
      stops = preset.stops.map((s) => ({ offset: 1 - s.offset, color: s.color }));
    }
  } else if (flags & BRUSH_DATA_BLEND_FACTORS_H) {
    const blend = readBlendFactors(view, o, end);
    if (blend) {
      stops = blend.entries.map((e) => ({
        offset: 1 - e.pos,
        color: lerpArgbToRgba(surroundArgb, centerArgb, e.factor)
      }));
    }
  }
  let r = 0;
  for (const p of boundaryPts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > r) {
      r = d;
    }
  }
  if (!(r > 0)) {
    return { kind: "plus-brush", color: argbToRgba(centerArgb) };
  }
  emfLog(
    `parseEmfPlusBrushObject: path gradient centre=(${cx.toFixed(1)},${cy.toFixed(1)}), r=${r.toFixed(1)}, ${stops.length} stop(s)`
  );
  return {
    kind: "plus-brush",
    color: argbToRgba(centerArgb),
    gradient: { type: "radial", cx, cy, r, stops: normaliseStops(stops) }
  };
}
function parseEmfPlusBrushObject(view, dataOff, recDataSize) {
  if (recDataSize < 8) {
    return null;
  }
  const end = dataOff + recDataSize;
  const hasVersion = looksLikeGraphicsVersion(view.getUint32(dataOff, true));
  const typeOff = dataOff + (hasVersion ? 4 : 0);
  if (typeOff + 8 > end) {
    return null;
  }
  const brushType = view.getUint32(typeOff, true);
  const b = typeOff + 4;
  switch (brushType) {
    case EMFPLUS_BRUSHTYPE_SOLID:
      return { kind: "plus-brush", color: argbToRgba(view.getUint32(b, true)) };
    case EMFPLUS_BRUSHTYPE_HATCHFILL:
      if (b + 8 <= end) {
        return { kind: "plus-brush", color: argbToRgba(view.getUint32(b + 4, true)) };
      }
      return { kind: "plus-brush", color: "rgba(0,0,0,1)" };
    case EMFPLUS_BRUSHTYPE_LINEARGRADIENT: {
      const brush = parseLinearGradient(view, b, end);
      return brush ?? { kind: "plus-brush", color: "rgba(0,0,0,1)" };
    }
    case EMFPLUS_BRUSHTYPE_PATHGRADIENT: {
      const brush = parsePathGradient(view, b, end);
      return brush ?? { kind: "plus-brush", color: "rgba(0,0,0,1)" };
    }
    default:
      return { kind: "plus-brush", color: "rgba(0,0,0,1)" };
  }
}
var PIXELFORMAT_24BPP_RGB = 137224;
var PIXELFORMAT_32BPP_RGB = 139273;
var PIXELFORMAT_32BPP_ARGB = 2498570;
var PIXELFORMAT_32BPP_PARGB = 925707;
function decodeEmfPlusBitmapPixels(view, pixelStart, width, height, stride, pixelFormat) {
  const absStride = Math.abs(stride);
  const topDown = stride > 0;
  const rowBytes = width * 4;
  const bmpRowStride = rowBytes + 3 & -4;
  const pixelDataSize = bmpRowStride * height;
  const bmpData = new Uint8Array(pixelDataSize);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const rowOff = pixelStart + srcRow * absStride;
    const dstRow = (height - 1 - y) * bmpRowStride;
    switch (pixelFormat) {
      case PIXELFORMAT_32BPP_ARGB:
      case PIXELFORMAT_32BPP_PARGB: {
        for (let x = 0; x < width; x++) {
          const off = rowOff + x * 4;
          if (off + 3 >= view.byteLength) {
            break;
          }
          let b = view.getUint8(off);
          let g = view.getUint8(off + 1);
          let r = view.getUint8(off + 2);
          const a = view.getUint8(off + 3);
          if (pixelFormat === PIXELFORMAT_32BPP_PARGB && a > 0 && a < 255) {
            r = Math.min(255, Math.round(r * 255 / a));
            g = Math.min(255, Math.round(g * 255 / a));
            b = Math.min(255, Math.round(b * 255 / a));
          }
          const di = dstRow + x * 4;
          bmpData[di] = b;
          bmpData[di + 1] = g;
          bmpData[di + 2] = r;
          bmpData[di + 3] = a;
        }
        break;
      }
      case PIXELFORMAT_32BPP_RGB: {
        for (let x = 0; x < width; x++) {
          const off = rowOff + x * 4;
          if (off + 3 >= view.byteLength) {
            break;
          }
          const di = dstRow + x * 4;
          bmpData[di] = view.getUint8(off);
          bmpData[di + 1] = view.getUint8(off + 1);
          bmpData[di + 2] = view.getUint8(off + 2);
          bmpData[di + 3] = 255;
        }
        break;
      }
      case PIXELFORMAT_24BPP_RGB: {
        for (let x = 0; x < width; x++) {
          const off = rowOff + x * 3;
          if (off + 2 >= view.byteLength) {
            break;
          }
          const di = dstRow + x * 4;
          bmpData[di] = view.getUint8(off);
          bmpData[di + 1] = view.getUint8(off + 1);
          bmpData[di + 2] = view.getUint8(off + 2);
          bmpData[di + 3] = 255;
        }
        break;
      }
      default:
        return null;
    }
  }
  const fileHeaderSize = 14;
  const dibHeaderSize = 108;
  const fileSize = fileHeaderSize + dibHeaderSize + pixelDataSize;
  const bmpFile = new ArrayBuffer(fileSize);
  const bmpView = new DataView(bmpFile);
  const bmpBytes = new Uint8Array(bmpFile);
  bmpView.setUint8(0, 66);
  bmpView.setUint8(1, 77);
  bmpView.setUint32(2, fileSize, true);
  bmpView.setUint32(6, 0, true);
  bmpView.setUint32(10, fileHeaderSize + dibHeaderSize, true);
  bmpView.setUint32(14, dibHeaderSize, true);
  bmpView.setInt32(18, width, true);
  bmpView.setInt32(22, height, true);
  bmpView.setUint16(26, 1, true);
  bmpView.setUint16(28, 32, true);
  bmpView.setUint32(30, 3, true);
  bmpView.setUint32(34, pixelDataSize, true);
  bmpView.setInt32(38, 2835, true);
  bmpView.setInt32(42, 2835, true);
  bmpView.setUint32(46, 0, true);
  bmpView.setUint32(50, 0, true);
  bmpView.setUint32(54, 16711680, true);
  bmpView.setUint32(58, 65280, true);
  bmpView.setUint32(62, 255, true);
  bmpView.setUint32(66, 4278190080, true);
  bmpView.setUint32(70, 1934772034, true);
  bmpBytes.set(bmpData, fileHeaderSize + dibHeaderSize);
  return bmpFile;
}
function parseEmfPlusPenObject(view, dataOff, recDataSize) {
  if (recDataSize < 20) {
    return null;
  }
  const hasVersion = looksLikeGraphicsVersion(view.getUint32(dataOff, true));
  const penFlags = view.getUint32(dataOff + (hasVersion ? 8 : 4), true);
  const penWidth = view.getFloat32(dataOff + 16, true);
  let brushOff = dataOff + 20;
  const flagSizes = [
    [1, 4],
    // Transform (actually 24 bytes)
    [2, 4],
    // StartCap
    [4, 4],
    // EndCap
    [8, 4],
    // Join
    [16, 4],
    // MiterLimit
    [32, 4],
    // LineStyle (DashStyle)
    [64, 4],
    // DashCap
    [128, 4]
    // DashOffset
  ];
  let dashStyle = 0;
  for (const [flag, size] of flagSizes) {
    if (penFlags & flag) {
      if (flag === 1) {
        brushOff += 24;
      } else {
        if (flag === 32 && brushOff + 4 <= dataOff + recDataSize) {
          dashStyle = view.getUint32(brushOff, true);
        }
        brushOff += size;
      }
    }
  }
  if (penFlags & 256) {
    if (brushOff + 4 <= dataOff + recDataSize) {
      const dashCount = view.getUint32(brushOff, true);
      brushOff += 4 + dashCount * 4;
    }
  }
  if (penFlags & 512) {
    if (brushOff + 4 <= dataOff + recDataSize) {
      const compCount = view.getUint32(brushOff, true);
      brushOff += 4 + compCount * 4;
    }
  }
  if (penFlags & 1024) {
    if (brushOff + 4 <= dataOff + recDataSize) {
      const capSize = view.getUint32(brushOff, true);
      brushOff += 4 + capSize;
    }
  }
  if (penFlags & 2048) {
    if (brushOff + 4 <= dataOff + recDataSize) {
      const capSize = view.getUint32(brushOff, true);
      brushOff += 4 + capSize;
    }
  }
  let penColor = "rgba(0,0,0,1)";
  if (brushOff + 8 <= dataOff + recDataSize) {
    const brush = parseEmfPlusBrushObject(view, brushOff, dataOff + recDataSize - brushOff);
    if (brush) {
      penColor = brush.color;
    }
  }
  return { kind: "plus-pen", color: penColor, width: penWidth || 1, dashStyle };
}
function parseEmfPlusImageObject(view, dataOff, recDataSize, objectId) {
  let imgData = null;
  const imgType = view.getUint32(dataOff + 4, true);
  if (imgType === 1 && recDataSize >= 28) {
    const bmpType = view.getUint32(dataOff + 24, true);
    if (bmpType === 0) {
      const bmpW = view.getInt32(dataOff + 8, true);
      const bmpH = view.getInt32(dataOff + 12, true);
      const bmpStride = view.getInt32(dataOff + 16, true);
      const pixelFormat = view.getUint32(dataOff + 20, true);
      emfLog(
        `  Bitmap(Pixel): ${bmpW}\xD7${bmpH}, stride=${bmpStride}, pixelFormat=0x${pixelFormat.toString(16).padStart(8, "0")}`
      );
      const pixelStart = dataOff + 28;
      const absStride = Math.abs(bmpStride);
      if (bmpW > 0 && bmpH > 0 && bmpW <= 8192 && bmpH <= 8192 && pixelStart + absStride * bmpH <= view.byteLength) {
        const decoded = decodeEmfPlusBitmapPixels(
          view,
          pixelStart,
          bmpW,
          bmpH,
          bmpStride,
          pixelFormat
        );
        if (decoded) {
          emfLog(`  Bitmap(Pixel): decoded successfully, size=${decoded.byteLength} bytes`);
          imgData = decoded;
        }
      }
    } else if (bmpType === 1) {
      const imgStart = dataOff + 28;
      const imgLen = recDataSize - 28;
      emfLog(`  Bitmap(Compressed): imgLen=${imgLen}, imgStart=0x${imgStart.toString(16)}`);
      if (imgLen > 0 && imgStart + imgLen <= view.byteLength) {
        imgData = view.buffer.slice(
          view.byteOffset + imgStart,
          view.byteOffset + imgStart + imgLen
        );
        if (imgData.byteLength >= 4) {
          const hdr = new Uint8Array(imgData, 0, 4);
          emfLog(
            `  Bitmap(Compressed): first 4 bytes = [${Array.from(hdr).map((b) => b.toString(16).padStart(2, "0")).join(" ")}]`
          );
        }
      }
    }
  } else if (imgType === 2 && recDataSize >= 12) {
    view.getUint32(dataOff + 8, true);
    const mfDataSize = view.getUint32(dataOff + 12, true);
    const mfStart = dataOff + 16;
    if (mfDataSize > 0 && mfStart + mfDataSize <= view.byteLength) {
      imgData = view.buffer.slice(
        view.byteOffset + mfStart,
        view.byteOffset + mfStart + mfDataSize
      );
      if (imgData.byteLength >= 4) {
        const hdr = new DataView(imgData);
        hdr.getUint32(0, true);
      }
    } else {
      emfWarn(
        `  Metafile: out of bounds or empty (mfStart=0x${mfStart.toString(16)}, mfDataSize=${mfDataSize}, viewLen=${view.byteLength})`
      );
    }
  }
  return { data: imgData, type: imgType };
}
function parseEmfPlusFontObject(view, dataOff, recDataSize) {
  if (recDataSize < 28) {
    return null;
  }
  const emSize = view.getFloat32(dataOff + 4, true);
  const styleFlags = view.getInt32(dataOff + 12, true);
  const nameLen = view.getUint32(dataOff + 20, true);
  let family = "sans-serif";
  if (nameLen > 0 && dataOff + 24 + nameLen * 2 <= dataOff + recDataSize) {
    family = readUtf16LE(view, dataOff + 24, nameLen) || "sans-serif";
  }
  return { kind: "plus-font", emSize: emSize || 12, flags: styleFlags, family };
}
function handleEmfPlusObjectRecord(rCtx, recFlags, dataOff, recDataSize) {
  const { view, objectTable } = rCtx;
  const objectId = recFlags & 255;
  const objectType = recFlags >> 8 & 127;
  switch (objectType) {
    // ---------------------------------------------------------------
    // Brush
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_BRUSH: {
      const brush = parseEmfPlusBrushObject(view, dataOff, recDataSize);
      if (brush) {
        objectTable.set(objectId, brush);
      }
      break;
    }
    // ---------------------------------------------------------------
    // Pen
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_PEN: {
      const pen = parseEmfPlusPenObject(view, dataOff, recDataSize);
      if (pen) {
        objectTable.set(objectId, pen);
      }
      break;
    }
    // ---------------------------------------------------------------
    // Path
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_PATH: {
      const path = parseEmfPlusPath(view, dataOff, recDataSize);
      if (path) {
        objectTable.set(objectId, path);
      }
      break;
    }
    // ---------------------------------------------------------------
    // Font
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_FONT: {
      const font = parseEmfPlusFontObject(view, dataOff, recDataSize);
      if (font) {
        objectTable.set(objectId, font);
      }
      break;
    }
    // ---------------------------------------------------------------
    // StringFormat
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_STRINGFORMAT: {
      if (recDataSize >= 16) {
        const sfFlags = view.getUint32(dataOff + 4, true);
        const alignment = view.getUint32(dataOff + 12, true);
        const lineAlignment = view.getUint32(dataOff + 16, true);
        objectTable.set(objectId, {
          kind: "plus-stringformat",
          flags: sfFlags,
          alignment: alignment ?? 0,
          lineAlignment: lineAlignment ?? 0
        });
      }
      break;
    }
    // ---------------------------------------------------------------
    // Image
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_IMAGE: {
      if (recDataSize < 8) {
        break;
      }
      const parsed = parseEmfPlusImageObject(view, dataOff, recDataSize);
      objectTable.set(objectId, {
        kind: "plus-image",
        data: parsed.data,
        type: parsed.type
      });
      rCtx.totalImageObjects++;
      break;
    }
    // ---------------------------------------------------------------
    // ImageAttributes
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_IMAGEATTRIBUTES: {
      objectTable.set(objectId, { kind: "plus-imageattributes" });
      break;
    }
    // ---------------------------------------------------------------
    // Region
    // ---------------------------------------------------------------
    case EMFPLUS_OBJECTTYPE_REGION: {
      const region = parseEmfPlusRegionObject(view, dataOff, recDataSize);
      if (region) {
        objectTable.set(objectId, region);
      }
      break;
    }
  }
}
var MAX_REGION_NODE_DEPTH = 64;
function parseRegionNode(view, off, endOff, depth = 0) {
  if (off + 4 > endOff) {
    return null;
  }
  if (depth > MAX_REGION_NODE_DEPTH) {
    return null;
  }
  const nodeType = view.getUint32(off, true);
  let cursor = off + 4;
  if (nodeType <= 5) {
    const leftResult = parseRegionNode(view, cursor, endOff, depth + 1);
    if (!leftResult) {
      return null;
    }
    cursor += leftResult.bytesRead;
    const rightResult = parseRegionNode(view, cursor, endOff, depth + 1);
    if (!rightResult) {
      return null;
    }
    cursor += rightResult.bytesRead;
    return {
      node: {
        type: "combine",
        combineMode: nodeType,
        left: leftResult.node,
        right: rightResult.node
      },
      bytesRead: cursor - off
    };
  }
  if (nodeType === 268435456) {
    if (cursor + 16 > endOff) {
      return null;
    }
    const x = view.getFloat32(cursor, true);
    const y = view.getFloat32(cursor + 4, true);
    const w = view.getFloat32(cursor + 8, true);
    const h = view.getFloat32(cursor + 12, true);
    return {
      node: { type: "rect", x, y, width: w, height: h },
      bytesRead: cursor + 16 - off
    };
  }
  if (nodeType === 268435457) {
    if (cursor + 4 > endOff) {
      return null;
    }
    const pathDataSize = view.getInt32(cursor, true);
    cursor += 4;
    if (pathDataSize <= 0 || cursor + pathDataSize > endOff) {
      return null;
    }
    const path = parseEmfPlusPath(view, cursor, pathDataSize);
    return {
      node: path ? { type: "path", path } : { type: "empty" },
      bytesRead: cursor + pathDataSize - off
    };
  }
  if (nodeType === 268435458) {
    return { node: { type: "empty" }, bytesRead: 4 };
  }
  if (nodeType === 268435459) {
    return { node: { type: "infinite" }, bytesRead: 4 };
  }
  emfWarn(`parseRegionNode: unknown node type 0x${nodeType.toString(16)}`);
  return { node: { type: "empty" }, bytesRead: 4 };
}
function parseEmfPlusRegionObject(view, off, maxLen) {
  if (maxLen < 8) {
    return null;
  }
  view.getUint32(off, true);
  const regionNodeCount = view.getUint32(off + 4, true);
  if (regionNodeCount > 1e5) {
    return null;
  }
  const endOff = off + maxLen;
  const result = parseRegionNode(view, off + 8, endOff);
  if (!result) {
    return null;
  }
  return {
    kind: "plus-region",
    nodes: [result.node]
  };
}
function handleEmfPlusTextImageRecord(rCtx, recType, recFlags, dataOff, recDataSize) {
  const { ctx, view, objectTable } = rCtx;
  switch (recType) {
    // ---- path-based drawing ----
    case EMFPLUS_FILLPATH: {
      if (recDataSize >= 4) {
        const brushVal = view.getUint32(dataOff, true);
        const pathId = recFlags & 255;
        const pathObj = objectTable.get(pathId);
        if (pathObj && pathObj.kind === "plus-path") {
          ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
          applyPlusWorldTransform(rCtx);
          replayEmfPlusPath(ctx, pathObj);
          ctx.fill();
        }
      }
      return true;
    }
    case EMFPLUS_DRAWPATH: {
      if (recDataSize >= 4) {
        const penIndex = view.getUint32(dataOff, true);
        const pathId = recFlags & 255;
        const pathObj = objectTable.get(pathId);
        const pen = objectTable.get(penIndex & 255);
        if (pathObj && pathObj.kind === "plus-path") {
          if (pen && pen.kind === "plus-pen") {
            ctx.strokeStyle = pen.color;
            ctx.lineWidth = pen.width;
          }
          applyPlusWorldTransform(rCtx);
          replayEmfPlusPath(ctx, pathObj);
          ctx.stroke();
        }
      }
      return true;
    }
    // ---- text ----
    case EMFPLUS_DRAWSTRING: {
      if (recDataSize >= 28) {
        const brushVal = view.getUint32(dataOff, true);
        const formatId = view.getUint32(dataOff + 4, true);
        const strLen = view.getUint32(dataOff + 8, true);
        const layoutX = view.getFloat32(dataOff + 12, true);
        const layoutY = view.getFloat32(dataOff + 16, true);
        view.getFloat32(dataOff + 20, true);
        view.getFloat32(dataOff + 24, true);
        const fontId = recFlags & 255;
        const font = objectTable.get(fontId);
        if (strLen > 0 && dataOff + 28 + strLen * 2 <= dataOff + recDataSize) {
          const text = readUtf16LE(view, dataOff + 28, strLen);
          if (text.length > 0 && font && font.kind === "plus-font") {
            const bold = font.flags & 1 ? "bold " : "";
            const italic = font.flags & 2 ? "italic " : "";
            const family = mapFontFamily(font.family, rCtx.fontFamilyMap);
            ctx.font = `${italic}${bold}${font.emSize}px ${family}`;
            ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
            ctx.textBaseline = "top";
            const sf = objectTable.get(formatId);
            if (sf && sf.kind === "plus-stringformat") {
              switch (sf.alignment) {
                case 1:
                  ctx.textAlign = "center";
                  break;
                case 2:
                  ctx.textAlign = "right";
                  break;
                default:
                  ctx.textAlign = "left";
              }
            } else {
              ctx.textAlign = "left";
            }
            applyPlusWorldTransform(rCtx);
            ctx.fillText(text, layoutX, layoutY);
          }
        }
      }
      return true;
    }
    case EMFPLUS_DRAWDRIVERSTRING: {
      if (recDataSize >= 16) {
        const brushVal = view.getUint32(dataOff, true);
        const optionsFlags = view.getUint32(dataOff + 4, true);
        const matrixPresent = view.getUint32(dataOff + 8, true) !== 0;
        const glyphCount = view.getUint32(dataOff + 12, true);
        const fontId = recFlags & 255;
        const font = objectTable.get(fontId);
        const glyphsOff = dataOff + 16;
        const alignedPosOff = glyphsOff + glyphCount * 2;
        const matrixOff = alignedPosOff + glyphCount * 8;
        if (glyphCount > 0 && glyphCount < 1e5 && alignedPosOff + glyphCount * 8 <= dataOff + recDataSize && font && font.kind === "plus-font") {
          const cmapLookup = (optionsFlags & 1) !== 0;
          const text = cmapLookup ? readUtf16LE(view, glyphsOff, glyphCount) : "";
          if (text.length > 0) {
            const bold = font.flags & 1 ? "bold " : "";
            const italic = font.flags & 2 ? "italic " : "";
            const family = mapFontFamily(font.family, rCtx.fontFamilyMap);
            ctx.font = `${italic}${bold}${font.emSize}px ${family}`;
            ctx.fillStyle = resolveBrushPaint(rCtx, recFlags, brushVal);
            ctx.textBaseline = "alphabetic";
            ctx.textAlign = "left";
            applyPlusWorldTransform(rCtx);
            let hasMatrix = false;
            if (matrixPresent && matrixOff + 24 <= dataOff + recDataSize) {
              const m = [];
              for (let k = 0; k < 6; k++) m.push(view.getFloat32(matrixOff + k * 4, true));
              if (m.every((v) => Number.isFinite(v))) {
                ctx.save();
                ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
                hasMatrix = true;
              }
            }
            const realizedAdvance = (optionsFlags & 4) !== 0;
            if (realizedAdvance) {
              ctx.fillText(text, view.getFloat32(alignedPosOff, true), view.getFloat32(alignedPosOff + 4, true));
            } else {
              for (let i = 0; i < text.length; i++) {
                const gx = view.getFloat32(alignedPosOff + i * 8, true);
                const gy = view.getFloat32(alignedPosOff + i * 8 + 4, true);
                ctx.fillText(text[i], gx, gy);
              }
            }
            if (hasMatrix) ctx.restore();
          }
        }
      }
      return true;
    }
    // ---- images ----
    case EMFPLUS_DRAWIMAGE: {
      if (recDataSize >= 24) {
        const imgId = recFlags & 255;
        const imgObj = objectTable.get(imgId);
        const compressed = (recFlags & 16384) !== 0;
        const rectOff = dataOff + 24;
        let dx, dy, dw, dh;
        if (compressed && rectOff + 8 <= dataOff + recDataSize) {
          dx = view.getInt16(rectOff, true);
          dy = view.getInt16(rectOff + 2, true);
          dw = view.getInt16(rectOff + 4, true);
          dh = view.getInt16(rectOff + 6, true);
        } else if (!compressed && rectOff + 16 <= dataOff + recDataSize) {
          dx = view.getFloat32(rectOff, true);
          dy = view.getFloat32(rectOff + 4, true);
          dw = view.getFloat32(rectOff + 8, true);
          dh = view.getFloat32(rectOff + 12, true);
        } else {
          return true;
        }
        rCtx.totalDrawImageCalls++;
        const hasData = imgObj && imgObj.kind === "plus-image" && imgObj.data;
        emfLog(
          `DrawImage: imgId=${imgId}, dest=(${dx},${dy},${dw},${dh}), compressed=${compressed}, hasObj=${Boolean(imgObj)}, objKind=${imgObj?.kind}, hasData=${Boolean(hasData)}, dataLen=${hasData ? imgObj.data.byteLength : 0}, isMetafile=${imgObj?.kind === "plus-image" ? imgObj.type === 2 : "N/A"}`
        );
        emfLog(
          `DrawImage: worldTransform=[${rCtx.worldTransform.map((v) => v.toFixed(3)).join(", ")}]`
        );
        if (imgObj && imgObj.kind === "plus-image" && imgObj.data) {
          if (drawPreDecodedImage(rCtx, dx, dy, dw, dh)) return true;
          rCtx.deferredImages.push({
            imageData: imgObj.data,
            dx,
            dy,
            dw,
            dh,
            transform: plusDeviceMatrix(rCtx),
            isMetafile: imgObj.type === 2
          });
          emfLog(`DrawImage: queued deferred image (total=${rCtx.deferredImages.length})`);
        }
      }
      return true;
    }
    case EMFPLUS_DRAWIMAGEPOINTS: {
      if (recDataSize >= 28) {
        const imgId = recFlags & 255;
        const imgObj = objectTable.get(imgId);
        const count = view.getUint32(dataOff + 24, true);
        const compressed = (recFlags & 16384) !== 0;
        const ptOff = dataOff + 28;
        if (count >= 3 && imgObj && imgObj.kind === "plus-image" && imgObj.data) {
          let p1x, p1y, p2x, p2y, p3x, p3y;
          if (compressed && ptOff + 12 <= dataOff + recDataSize) {
            p1x = view.getInt16(ptOff, true);
            p1y = view.getInt16(ptOff + 2, true);
            p2x = view.getInt16(ptOff + 4, true);
            p2y = view.getInt16(ptOff + 6, true);
            p3x = view.getInt16(ptOff + 8, true);
            p3y = view.getInt16(ptOff + 10, true);
          } else if (!compressed && ptOff + 24 <= dataOff + recDataSize) {
            p1x = view.getFloat32(ptOff, true);
            p1y = view.getFloat32(ptOff + 4, true);
            p2x = view.getFloat32(ptOff + 8, true);
            p2y = view.getFloat32(ptOff + 12, true);
            p3x = view.getFloat32(ptOff + 16, true);
            p3y = view.getFloat32(ptOff + 20, true);
          } else {
            return true;
          }
          const dx = p1x;
          const dy = p1y;
          const dw = Math.sqrt((p2x - p1x) ** 2 + (p2y - p1y) ** 2);
          const dh = Math.sqrt((p3x - p1x) ** 2 + (p3y - p1y) ** 2);
          rCtx.totalDrawImageCalls++;
          emfLog(
            `DrawImagePoints: imgId=${imgId}, points=[(${p1x},${p1y}),(${p2x},${p2y}),(${p3x},${p3y})], dest=(${dx.toFixed(1)},${dy.toFixed(1)},${dw.toFixed(1)},${dh.toFixed(1)})`
          );
          emfLog(
            `DrawImagePoints: worldTransform=[${rCtx.worldTransform.map((v) => v.toFixed(3)).join(", ")}]`
          );
          if (drawPreDecodedImage(rCtx, dx, dy, dw, dh)) return true;
          rCtx.deferredImages.push({
            imageData: imgObj.data,
            dx,
            dy,
            dw,
            dh,
            transform: plusDeviceMatrix(rCtx),
            isMetafile: imgObj.type === 2
          });
          emfLog(`DrawImagePoints: queued deferred image (total=${rCtx.deferredImages.length})`);
        } else {
          imgObj && imgObj.kind === "plus-image" && imgObj.data;
        }
      }
      return true;
    }
    default:
      return false;
  }
}
var EMFPLUS_REC_NAMES = {
  16385: "Header",
  16386: "EndOfFile",
  16388: "GetDC",
  16392: "Object",
  16394: "FillRects",
  16395: "DrawRects",
  16396: "FillPolygon",
  16397: "DrawLines",
  16398: "FillEllipse",
  16399: "DrawEllipse",
  16404: "FillPath",
  16405: "DrawPath",
  16410: "DrawImage",
  16411: "DrawImagePoints",
  16412: "DrawString",
  16438: "DrawDriverString",
  16414: "SetAntiAliasMode",
  16426: "SetWorldTransform",
  16427: "ResetWorldTransform",
  16428: "MultiplyWorldTransform",
  16432: "SetPageTransform",
  16433: "ResetClip",
  16434: "SetClipRect",
  16435: "SetClipPath",
  16436: "SetClipRegion",
  16437: "OffsetClip",
  16421: "Save",
  16422: "Restore",
  16424: "BeginContainerNoParams",
  16425: "EndContainer"
};
function finalizeContinuation(rCtx, objectId) {
  const completeView = new DataView(
    rCtx.continuationBuffer.buffer,
    rCtx.continuationBuffer.byteOffset,
    rCtx.continuationBuffer.byteLength
  );
  const assembledFlags = rCtx.continuationObjectType << 8 | objectId;
  handleEmfPlusObjectRecord({ ...rCtx, view: completeView }, assembledFlags, 0, rCtx.continuationTotalSize);
  rCtx.continuationBuffer = null;
  rCtx.continuationObjectId = -1;
  rCtx.continuationObjectType = 0;
  rCtx.continuationTotalSize = 0;
  rCtx.continuationOffset = 0;
}
function replayEmfPlusRecords(view, offset, length, ctx, _canvasW, _canvasH, state, dpiScale = 1, maxRecords = MAX_RECORDS_EMFPLUS_DEFAULT, fontFamilyMap, deviceMap, preDecoded) {
  const s = state ?? createEmfPlusState();
  const rCtx = {
    ctx,
    view,
    objectTable: s.objectTable,
    worldTransform: s.worldTransform,
    deferredImages: [],
    saveStack: s.saveStack,
    saveIdMap: s.saveIdMap,
    totalImageObjects: 0,
    totalDrawImageCalls: 0,
    clipSaveDepth: s.clipSaveDepth,
    clipRegion: s.clipRegion,
    pageUnit: 2,
    pageScale: 1,
    continuationBuffer: s.continuation.buffer,
    continuationObjectId: s.continuation.objectId,
    continuationObjectType: s.continuation.objectType,
    continuationTotalSize: s.continuation.totalSize,
    continuationOffset: s.continuation.offset,
    dpiScale,
    fontFamilyMap,
    deviceMap,
    shared: s,
    preDecoded
  };
  const end = offset + length;
  let recordCount = 0;
  const emfPlusRecordTypes = /* @__PURE__ */ new Map();
  emfLog(`replayEmfPlusRecords: offset=0x${offset.toString(16)}, length=${length}`);
  while (offset + 12 <= end && recordCount < maxRecords) {
    const recType = view.getUint16(offset, true);
    const recFlags = view.getUint16(offset + 2, true);
    const recSize = view.getUint32(offset + 4, true);
    const recDataSize = view.getUint32(offset + 8, true);
    if (recSize < 12 || offset + recSize > end) {
      break;
    }
    recordCount++;
    emfPlusRecordTypes.set(recType, (emfPlusRecordTypes.get(recType) ?? 0) + 1);
    const dataOff = offset + 12;
    if (recType === EMFPLUS_HEADER) {
      s.dualMode = (recFlags & 1) !== 0;
      s.gdiEnabled = !s.dualMode;
    } else if (recType === EMFPLUS_GETDC) {
      s.gdiEnabled = true;
    } else if (recType !== EMFPLUS_ENDOFFILE) {
      s.gdiEnabled = false;
    }
    switch (recType) {
      case EMFPLUS_HEADER: {
        if (recDataSize >= 16) {
          view.getFloat32(dataOff + 8, true);
          view.getFloat32(dataOff + 12, true);
        }
        break;
      }
      case EMFPLUS_ENDOFFILE:
        offset = end;
        continue;
      case EMFPLUS_GETDC:
        break;
      case EMFPLUS_OBJECT: {
        const isContinuation = (recFlags & 32768) !== 0;
        const objectId = recFlags & 255;
        if (isContinuation) {
          if (rCtx.continuationBuffer === null) {
            if (recDataSize >= 4) {
              const totalSize = view.getUint32(dataOff, true);
              const objectType = recFlags >> 8 & 127;
              const MAX_CONTINUATION_BYTES = 64 * 1024 * 1024;
              const remainingEmfPlusBytes = view.byteLength - dataOff;
              if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > MAX_CONTINUATION_BYTES || totalSize > remainingEmfPlusBytes || recDataSize - 4 < 0) ;
              else {
                rCtx.continuationTotalSize = totalSize;
                rCtx.continuationObjectId = objectId;
                rCtx.continuationObjectType = objectType;
                rCtx.continuationBuffer = new Uint8Array(totalSize);
                const chunkSize = recDataSize - 4;
                const chunk = new Uint8Array(
                  view.buffer,
                  view.byteOffset + dataOff + 4,
                  Math.min(chunkSize, totalSize)
                );
                rCtx.continuationBuffer.set(chunk, 0);
                rCtx.continuationOffset = chunk.length;
              }
            }
          } else if (recDataSize > 4) {
            const remaining = rCtx.continuationTotalSize - rCtx.continuationOffset;
            const chunk = new Uint8Array(
              view.buffer,
              view.byteOffset + dataOff + 4,
              Math.max(0, Math.min(recDataSize - 4, remaining))
            );
            rCtx.continuationBuffer.set(chunk, rCtx.continuationOffset);
            rCtx.continuationOffset += chunk.length;
          }
          if (rCtx.continuationBuffer !== null && rCtx.continuationOffset >= rCtx.continuationTotalSize) {
            finalizeContinuation(rCtx, objectId);
          }
        } else if (rCtx.continuationBuffer !== null && objectId === rCtx.continuationObjectId) {
          const remaining = rCtx.continuationTotalSize - rCtx.continuationOffset;
          const skip = recDataSize > remaining ? 4 : 0;
          const chunk = new Uint8Array(
            view.buffer,
            view.byteOffset + dataOff + skip,
            Math.max(0, Math.min(recDataSize - skip, remaining))
          );
          rCtx.continuationBuffer.set(chunk, rCtx.continuationOffset);
          finalizeContinuation(rCtx, objectId);
        } else {
          handleEmfPlusObjectRecord(rCtx, recFlags, dataOff, recDataSize);
        }
        break;
      }
      default: {
        const handled = handleEmfPlusDrawRecord(rCtx, recType, recFlags, dataOff, recDataSize) || handleEmfPlusTextImageRecord(rCtx, recType, recFlags, dataOff, recDataSize) || handleEmfPlusStateRecord(rCtx, recType, recFlags, dataOff, recDataSize);
        if (!handled) {
          console.warn(`[emf-converter] Unhandled EMF+ record type: 0x${recType.toString(16)}`);
        }
        break;
      }
    }
    offset += recSize;
  }
  s.continuation = {
    buffer: rCtx.continuationBuffer,
    objectId: rCtx.continuationObjectId,
    objectType: rCtx.continuationObjectType,
    totalSize: rCtx.continuationTotalSize,
    offset: rCtx.continuationOffset
  };
  if (recordCount >= maxRecords) {
    console.warn(
      `[emf-converter] EMF+ record limit reached (${maxRecords}). Output may be incomplete.`
    );
  }
  const summary = [];
  for (const [type, cnt] of emfPlusRecordTypes) {
    summary.push(`${EMFPLUS_REC_NAMES[type] ?? `0x${type.toString(16)}`}:${cnt}`);
  }
  emfLog(
    `replayEmfPlusRecords: totalImageObjects=${rCtx.totalImageObjects}, totalDrawImageCalls=${rCtx.totalDrawImageCalls}, deferredImages=${rCtx.deferredImages.length}`
  );
  emfLog(
    `replayEmfPlusRecords: object table has ${rCtx.objectTable.size} entries: [${Array.from(
      rCtx.objectTable.entries()
    ).map(([id, obj]) => `${id}:${obj.kind}`).join(", ")}]`
  );
  if (state) {
    state.worldTransform = rCtx.worldTransform;
    state.saveIdMap = rCtx.saveIdMap;
    state.clipRegion = rCtx.clipRegion ?? null;
    state.clipSaveDepth = rCtx.clipSaveDepth;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return rCtx.deferredImages;
}
var GDI_NAMES = {
  1: "EMR_HEADER",
  2: "EMR_POLYBEZIER",
  3: "EMR_POLYGON",
  4: "EMR_POLYLINE",
  5: "EMR_POLYBEZIERTO",
  6: "EMR_POLYLINETO",
  14: "EMR_EOF",
  27: "EMR_MOVETOEX",
  37: "EMR_SELECTOBJECT",
  38: "EMR_CREATEPEN",
  39: "EMR_CREATEBRUSHINDIRECT",
  40: "EMR_DELETEOBJECT",
  42: "EMR_ELLIPSE",
  43: "EMR_RECTANGLE",
  54: "EMR_LINETO",
  59: "EMR_BEGINPATH",
  60: "EMR_ENDPATH",
  62: "EMR_FILLPATH",
  63: "EMR_STROKEANDFILLPATH",
  64: "EMR_STROKEPATH",
  70: "EMR_COMMENT",
  76: "EMR_BITBLT",
  81: "EMR_STRETCHDIBITS",
  84: "EMR_EXTTEXTOUTW",
  85: "EMR_POLYBEZIER16",
  86: "EMR_POLYGON16",
  87: "EMR_POLYLINE16",
  88: "EMR_POLYBEZIERTO16",
  91: "EMR_POLYPOLYGON16",
  114: "EMR_ALPHABLEND"
};
function replayEmfRecords(view, ctx, bounds, canvasW, canvasH, dpiScale = 1, replayOptions = {}) {
  emfLog(
    `replayEmfRecords: bounds=(${bounds.left},${bounds.top})\u2192(${bounds.right},${bounds.bottom}), canvas=${canvasW}\xD7${canvasH}`
  );
  const allDeferredImages = [];
  const emfPlusState = createEmfPlusState();
  const maxRecords = replayOptions.maxRecords ?? MAX_RECORDS_DEFAULT;
  const maxRecordsEmfPlus = replayOptions.maxRecordsEmfPlus ?? MAX_RECORDS_EMFPLUS_DEFAULT;
  const logicalW = bounds.right - bounds.left || 1;
  const logicalH = bounds.bottom - bounds.top || 1;
  const sx = canvasW / logicalW;
  const sy = canvasH / logicalH;
  emfLog(
    `replayEmfRecords: logical=${logicalW}\xD7${logicalH}, scale=(${sx.toFixed(4)},${sy.toFixed(4)})`
  );
  const rCtx = {
    ctx,
    view,
    objectTable: /* @__PURE__ */ new Map(),
    state: { ...defaultState(), fontFamilyMap: replayOptions.fontFamilyMap, devScale: Math.min(sx, sy) },
    stateStack: [],
    inPath: false,
    // Defaults form an identity window->viewport mapping in device space, so
    // a file that only sets some of the four keeps the non-mapping behavior.
    windowOrg: { x: bounds.left, y: bounds.top },
    windowExt: { cx: logicalW, cy: logicalH },
    viewportOrg: { x: bounds.left, y: bounds.top },
    viewportExt: { cx: logicalW, cy: logicalH },
    useMappingMode: false,
    clipSaveDepth: 0,
    bounds,
    canvasW,
    canvasH,
    sx,
    sy
  };
  let offset = 0;
  const maxOffset = view.byteLength;
  let recordCount = 0;
  let emfPlusCommentCount = 0;
  const gdiRecordTypes = /* @__PURE__ */ new Map();
  while (offset + 8 <= maxOffset && recordCount < maxRecords) {
    const recType = view.getUint32(offset, true);
    const recSize = view.getUint32(offset + 4, true);
    if (recSize < 8 || offset + recSize > maxOffset) {
      break;
    }
    recordCount++;
    const dataOff = offset + 8;
    gdiRecordTypes.set(recType, (gdiRecordTypes.get(recType) ?? 0) + 1);
    if (recType === EMR_COMMENT) {
      if (recSize >= 16) {
        const commentDataSize = view.getUint32(dataOff, true);
        const sig = view.getUint32(dataOff + 4, true);
        if (sig === EMFPLUS_SIGNATURE && commentDataSize > 4) {
          emfPlusCommentCount++;
          emfLog(
            `replayEmfRecords: EMF+ comment #${emfPlusCommentCount} at offset 0x${offset.toString(16)}, dataSize=${commentDataSize}`
          );
          const deferred = replayEmfPlusRecords(
            view,
            dataOff + 8,
            commentDataSize - 4,
            ctx,
            canvasW,
            canvasH,
            emfPlusState,
            dpiScale,
            maxRecordsEmfPlus,
            replayOptions.fontFamilyMap,
            { left: bounds.left, top: bounds.top, sx, sy },
            replayOptions.preDecoded
          );
          emfLog(
            `replayEmfRecords: EMF+ comment #${emfPlusCommentCount} returned ${deferred.length} deferred images`
          );
          allDeferredImages.push(...deferred);
        } else if (sig === EMR_COMMENT_PUBLIC_SIGNATURE) {
          emfLog(
            `replayEmfRecords: EMR_COMMENT_PUBLIC at offset 0x${offset.toString(16)}, size=${commentDataSize}`
          );
        } else {
          emfLog(
            `replayEmfRecords: EMR_COMMENT (sig=0x${sig.toString(16).padStart(8, "0")}) at offset 0x${offset.toString(16)}, size=${commentDataSize}`
          );
        }
      }
      offset += recSize;
      continue;
    }
    if (recType === EMR_EOF) {
      const summary = [];
      for (const [type, count] of gdiRecordTypes) {
        summary.push(`${GDI_NAMES[type] ?? `0x${type.toString(16)}`}:${count}`);
      }
      emfLog(
        `replayEmfRecords: total deferred images = ${allDeferredImages.length}, EMF+ object table size = ${emfPlusState.objectTable.size}`
      );
      break;
    }
    if (recType === EMR_SETBRUSHORGEX || recType === EMR_SETMETARGN || recType === EMR_SETICMMODE || recType === EMR_SETLAYOUT || recType === EMR_HEADER) {
      offset += recSize;
      continue;
    }
    if (emfPlusState.dualMode && !emfPlusState.gdiEnabled) {
      handleEmfGdiStateRecord(rCtx, recType, offset, dataOff, recSize);
      offset += recSize;
      continue;
    }
    const handled = handleEmfGdiStateRecord(rCtx, recType, offset, dataOff, recSize) || handleEmfGdiDrawRecord(rCtx, recType, offset, dataOff, recSize) || handleEmfGdiPolyPathRecord(rCtx, recType, offset, dataOff, recSize);
    if (!handled) {
      console.warn(`[emf-converter] Unhandled EMR record type: ${recType}`);
    }
    offset += recSize;
  }
  if (recordCount >= maxRecords) {
    console.warn(
      `[emf-converter] EMF record limit reached (${maxRecords}). Output may be incomplete.`
    );
  }
  return allDeferredImages;
}
function wmfRopComposite(rop) {
  switch (rop) {
    case 8913094:
      return "multiply";
    case 15597702:
      return "lighter";
    case 6684742:
      return "difference";
    default:
      return "source-over";
  }
}
function drawWmfDib(wCtx, rop, dibOff, dibEnd, xSrc, ySrc, srcW, srcH, xDst, yDst, dstW, dstH) {
  const { view, ctx, coord } = wCtx;
  if (dibOff + 40 > dibEnd || dibEnd > view.byteLength) {
    return;
  }
  const hdrSize = view.getUint32(dibOff, true);
  const bitCount = view.getUint16(dibOff + 14, true);
  const compression = view.getUint32(dibOff + 16, true);
  let paletteBytes = 0;
  if (bitCount <= 8) {
    const maxColors = 1 << bitCount;
    paletteBytes = Math.min(view.getUint32(dibOff + 32, true) || maxColors, maxColors) * 4;
  } else if (compression === 3 && hdrSize === 40) {
    paletteBytes = 12;
  }
  const bitsOff = dibOff + hdrSize + paletteBytes;
  if (bitsOff >= dibEnd) {
    return;
  }
  const imageData = decodeDibToImageData(view, dibOff, bitsOff, dibEnd - bitsOff);
  if (!imageData) {
    return;
  }
  const temp = createTempCanvas(imageData.width, imageData.height);
  if (!temp) {
    return;
  }
  temp.ctx.putImageData(imageData, 0, 0);
  const sw = srcW > 0 ? srcW : imageData.width;
  const sh = srcH > 0 ? srcH : imageData.height;
  const prevGco = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = wmfRopComposite(rop);
  ctx.drawImage(
    temp.canvas,
    xSrc,
    ySrc,
    sw,
    sh,
    coord.mx(xDst),
    coord.my(yDst),
    coord.mw(dstW || sw),
    coord.mh(dstH || sh)
  );
  ctx.globalCompositeOperation = prevGco;
}
function handleWmfDrawRecord(wCtx, recType, offset, dataOff, recSize) {
  const { ctx, view, state, coord } = wCtx;
  const { mx, my, mw, mh } = coord;
  switch (recType) {
    case META_DIBBITBLT:
    case META_DIBSTRETCHBLT:
    case META_STRETCHDIB: {
      if (recSize === ((recType >> 8) + 3) * 2) {
        return true;
      }
      const rop = view.getUint32(dataOff, true);
      if (recType === META_DIBBITBLT) {
        if (recSize >= 22) {
          const ySrc = view.getInt16(dataOff + 4, true);
          const xSrc = view.getInt16(dataOff + 6, true);
          const h = view.getInt16(dataOff + 8, true);
          const w = view.getInt16(dataOff + 10, true);
          const yDst = view.getInt16(dataOff + 12, true);
          const xDst = view.getInt16(dataOff + 14, true);
          drawWmfDib(wCtx, rop, dataOff + 16, offset + recSize, xSrc, ySrc, w, h, xDst, yDst, w, h);
        }
        return true;
      }
      const base = recType === META_STRETCHDIB ? dataOff + 6 : dataOff + 4;
      if (base + 16 <= offset + recSize) {
        const srcH = view.getInt16(base, true);
        const srcW = view.getInt16(base + 2, true);
        const ySrc = view.getInt16(base + 4, true);
        const xSrc = view.getInt16(base + 6, true);
        const dstH = view.getInt16(base + 8, true);
        const dstW = view.getInt16(base + 10, true);
        const yDst = view.getInt16(base + 12, true);
        const xDst = view.getInt16(base + 14, true);
        drawWmfDib(
          wCtx,
          rop,
          base + 16,
          offset + recSize,
          xSrc,
          ySrc,
          srcW,
          srcH,
          xDst,
          yDst,
          dstW,
          dstH
        );
      }
      return true;
    }
    case META_MOVETO:
      if (recSize >= 10) {
        state.curY = view.getInt16(dataOff, true);
        state.curX = view.getInt16(dataOff + 2, true);
      }
      return true;
    case META_LINETO:
      if (recSize >= 10) {
        const ly = view.getInt16(dataOff, true);
        const lx = view.getInt16(dataOff + 2, true);
        applyPen(ctx, state);
        ctx.beginPath();
        ctx.moveTo(mx(state.curX), my(state.curY));
        ctx.lineTo(mx(lx), my(ly));
        ctx.stroke();
        state.curX = lx;
        state.curY = ly;
      }
      return true;
    case META_RECTANGLE:
      if (recSize >= 14) {
        const b = view.getInt16(dataOff, true);
        const r = view.getInt16(dataOff + 2, true);
        const t = view.getInt16(dataOff + 4, true);
        const l = view.getInt16(dataOff + 6, true);
        applyBrush(ctx, state);
        ctx.fillRect(mx(l), my(t), mw(r - l), mh(b - t));
        applyPen(ctx, state);
        ctx.strokeRect(mx(l), my(t), mw(r - l), mh(b - t));
      }
      return true;
    case META_ROUNDRECT:
      if (recSize >= 18) {
        const rh = Math.abs(mh(view.getInt16(dataOff, true))) / 2;
        const rw = Math.abs(mw(view.getInt16(dataOff + 2, true))) / 2;
        const b = view.getInt16(dataOff + 4, true);
        const r = view.getInt16(dataOff + 6, true);
        const t = view.getInt16(dataOff + 8, true);
        const l = view.getInt16(dataOff + 10, true);
        const x1 = mx(l), y1 = my(t);
        const w = mw(r - l), h = mh(b - t);
        const radius = Math.min(rw, rh, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x1 + radius, y1);
        ctx.lineTo(x1 + w - radius, y1);
        ctx.arcTo(x1 + w, y1, x1 + w, y1 + radius, radius);
        ctx.lineTo(x1 + w, y1 + h - radius);
        ctx.arcTo(x1 + w, y1 + h, x1 + w - radius, y1 + h, radius);
        ctx.lineTo(x1 + radius, y1 + h);
        ctx.arcTo(x1, y1 + h, x1, y1 + h - radius, radius);
        ctx.lineTo(x1, y1 + radius);
        ctx.arcTo(x1, y1, x1 + radius, y1, radius);
        ctx.closePath();
        applyBrush(ctx, state);
        ctx.fill();
        applyPen(ctx, state);
        ctx.stroke();
      }
      return true;
    case META_ELLIPSE:
      if (recSize >= 14) {
        const b = view.getInt16(dataOff, true);
        const r = view.getInt16(dataOff + 2, true);
        const t = view.getInt16(dataOff + 4, true);
        const l = view.getInt16(dataOff + 6, true);
        ctx.beginPath();
        ctx.ellipse(
          mx((l + r) / 2),
          my((t + b) / 2),
          Math.abs(mw(r - l)) / 2,
          Math.abs(mh(b - t)) / 2,
          0,
          0,
          Math.PI * 2
        );
        applyBrush(ctx, state);
        ctx.fill();
        applyPen(ctx, state);
        ctx.stroke();
      }
      return true;
    case META_ARC:
    case META_PIE:
    case META_CHORD:
      if (recSize >= 22) {
        const endY = view.getInt16(dataOff, true);
        const endX = view.getInt16(dataOff + 2, true);
        const startY = view.getInt16(dataOff + 4, true);
        const startX = view.getInt16(dataOff + 6, true);
        const b = view.getInt16(dataOff + 8, true);
        const r = view.getInt16(dataOff + 10, true);
        const t = view.getInt16(dataOff + 12, true);
        const l = view.getInt16(dataOff + 14, true);
        const cxA = (l + r) / 2;
        const cyA = (t + b) / 2;
        const rxA = Math.abs(r - l) / 2;
        const ryA = Math.abs(b - t) / 2;
        const startAngle = Math.atan2((startY - cyA) / (ryA || 1), (startX - cxA) / (rxA || 1));
        const endAngle = Math.atan2((endY - cyA) / (ryA || 1), (endX - cxA) / (rxA || 1));
        ctx.beginPath();
        if (recType === META_PIE) {
          ctx.moveTo(mx(cxA), my(cyA));
        }
        ctx.ellipse(
          mx(cxA),
          my(cyA),
          Math.abs(mw(rxA)),
          Math.abs(mh(ryA)),
          0,
          startAngle,
          endAngle,
          false
        );
        if (recType === META_PIE || recType === META_CHORD) {
          ctx.closePath();
        }
        if (recType === META_PIE || recType === META_CHORD) {
          applyBrush(ctx, state);
          ctx.fill();
        }
        applyPen(ctx, state);
        ctx.stroke();
      }
      return true;
    // ---- poly ----
    case META_POLYGON:
      if (recSize >= 10) {
        const count = view.getInt16(dataOff, true);
        if (count > 0 && dataOff + 2 + count * 4 <= offset + recSize) {
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const px = view.getInt16(dataOff + 2 + i * 4, true);
            const py = view.getInt16(dataOff + 4 + i * 4, true);
            if (i === 0) {
              ctx.moveTo(mx(px), my(py));
            } else {
              ctx.lineTo(mx(px), my(py));
            }
          }
          ctx.closePath();
          applyBrush(ctx, state);
          ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
          applyPen(ctx, state);
          ctx.stroke();
        }
      }
      return true;
    case META_POLYLINE:
      if (recSize >= 10) {
        const count = view.getInt16(dataOff, true);
        if (count > 0 && dataOff + 2 + count * 4 <= offset + recSize) {
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const px = view.getInt16(dataOff + 2 + i * 4, true);
            const py = view.getInt16(dataOff + 4 + i * 4, true);
            if (i === 0) {
              ctx.moveTo(mx(px), my(py));
            } else {
              ctx.lineTo(mx(px), my(py));
            }
          }
          applyPen(ctx, state);
          ctx.stroke();
        }
      }
      return true;
    case META_POLYPOLYGON:
      if (recSize >= 10) {
        const numPolys = view.getUint16(dataOff, true);
        let polyOff = dataOff + 2;
        const counts = [];
        for (let p = 0; p < numPolys && polyOff + 2 <= offset + recSize; p++) {
          counts.push(view.getInt16(polyOff, true));
          polyOff += 2;
        }
        ctx.beginPath();
        for (const count of counts) {
          if (count > 0 && polyOff + count * 4 <= offset + recSize) {
            for (let i = 0; i < count; i++) {
              const px = view.getInt16(polyOff + i * 4, true);
              const py = view.getInt16(polyOff + i * 4 + 2, true);
              if (i === 0) {
                ctx.moveTo(mx(px), my(py));
              } else {
                ctx.lineTo(mx(px), my(py));
              }
            }
            ctx.closePath();
            polyOff += count * 4;
          }
        }
        applyBrush(ctx, state);
        ctx.fill(state.polyFillMode === 2 ? "nonzero" : "evenodd");
        applyPen(ctx, state);
        ctx.stroke();
      }
      return true;
    // ---- text ----
    case META_TEXTOUT:
      if (recSize >= 12) {
        const nChars = view.getInt16(dataOff, true);
        if (nChars > 0 && dataOff + 2 + nChars <= offset + recSize) {
          let text = "";
          for (let i = 0; i < nChars; i++) {
            const ch = view.getUint8(dataOff + 2 + i);
            if (ch === 0) {
              break;
            }
            text += String.fromCharCode(ch);
          }
          const strBytes = nChars + nChars % 2;
          const txOff = dataOff + 2 + strBytes;
          if (txOff + 4 <= offset + recSize) {
            const ty2 = view.getInt16(txOff, true);
            const txCoord = view.getInt16(txOff + 2, true);
            applyFont(ctx, state, Math.abs(mh(1)));
            ctx.fillStyle = state.textColor;
            drawWmfText(ctx, state, text, mx(txCoord), my(ty2));
          }
        }
      }
      return true;
    case META_EXTTEXTOUT:
      if (recSize >= 14) {
        const ty2 = view.getInt16(dataOff, true);
        const txCoord = view.getInt16(dataOff + 2, true);
        const nChars = view.getInt16(dataOff + 4, true);
        const hasClipRect = (view.getUint16(dataOff + 6, true) & 4) !== 0;
        const stringOff = dataOff + 8 + (hasClipRect ? 8 : 0);
        if (nChars > 0 && stringOff + nChars <= offset + recSize) {
          let text = "";
          for (let i = 0; i < nChars; i++) {
            const ch = view.getUint8(stringOff + i);
            if (ch === 0) {
              break;
            }
            text += String.fromCharCode(ch);
          }
          applyFont(ctx, state, Math.abs(mh(1)));
          ctx.fillStyle = state.textColor;
          drawWmfText(ctx, state, text, mx(txCoord), my(ty2));
        }
      }
      return true;
    case META_PATBLT:
      if (recSize >= 18) {
        const rop = view.getUint32(dataOff, true);
        const rh2 = view.getInt16(dataOff + 4, true);
        const rw2 = view.getInt16(dataOff + 6, true);
        const ry = view.getInt16(dataOff + 8, true);
        const rx = view.getInt16(dataOff + 10, true);
        if (rop === 66) {
          ctx.fillStyle = "#000000";
        } else if (rop === 16711778) {
          ctx.fillStyle = "#ffffff";
        } else {
          if (state.brushStyle === 1) {
            return true;
          }
          applyBrush(ctx, state);
        }
        ctx.fillRect(mx(rx), my(ry), mw(rw2), mh(rh2));
      }
      return true;
    default:
      return false;
  }
}
function createWmfCoord(windowOrg, windowExt, canvasW, canvasH) {
  return {
    mx: (x) => (x - windowOrg.x) / (windowExt.cx || 1) * canvasW,
    my: (y) => (y - windowOrg.y) / (windowExt.cy || 1) * canvasH,
    mw: (w) => w / (windowExt.cx || 1) * canvasW,
    mh: (h) => h / (windowExt.cy || 1) * canvasH
  };
}
function replayWmfRecords(view, ctx, header, canvasW, canvasH, replayOptions = {}) {
  const logicalW = header.boundsRight - header.boundsLeft || 1;
  const logicalH = header.boundsBottom - header.boundsTop || 1;
  const windowOrg = { x: header.boundsLeft, y: header.boundsTop };
  const windowExt = { cx: logicalW, cy: logicalH };
  const coord = createWmfCoord(windowOrg, windowExt, canvasW, canvasH);
  const objectTable = /* @__PURE__ */ new Map();
  const allocObjectSlot = () => {
    let slot2 = 0;
    while (objectTable.has(slot2)) {
      slot2++;
    }
    return slot2;
  };
  const state = { ...defaultState(), fontFamilyMap: replayOptions.fontFamilyMap };
  const stateStack = [];
  const wCtx = { view, ctx, state, coord };
  let offset = header.headerSize;
  const maxOffset = view.byteLength;
  const maxRecords = replayOptions.maxRecords ?? MAX_RECORDS_DEFAULT;
  let recordCount = 0;
  while (offset + 6 <= maxOffset && recordCount < maxRecords) {
    const recSizeWords = view.getUint32(offset, true);
    const recType = view.getUint16(offset + 4, true);
    const recSize = recSizeWords * 2;
    if (recSize < 6 || offset + recSize > maxOffset) {
      break;
    }
    if (recType === META_EOF) {
      break;
    }
    recordCount++;
    const dataOff = offset + 6;
    if (handleWmfDrawRecord(wCtx, recType, offset, dataOff, recSize)) {
      offset += recSize;
      continue;
    }
    switch (recType) {
      case META_SETWINDOWORG:
        if (recSize >= 10) {
          windowOrg.y = view.getInt16(dataOff, true);
          windowOrg.x = view.getInt16(dataOff + 2, true);
        }
        break;
      case META_SETWINDOWEXT:
        if (recSize >= 10) {
          windowExt.cy = view.getInt16(dataOff, true);
          windowExt.cx = view.getInt16(dataOff + 2, true);
        }
        break;
      case META_SAVEDC:
        stateStack.push(cloneState(state));
        break;
      case META_RESTOREDC: {
        const restored = stateStack.pop();
        if (restored) {
          Object.assign(state, restored);
        }
        break;
      }
      case META_SETTEXTCOLOR:
        if (recSize >= 10) {
          state.textColor = readColorRef(view, dataOff);
        }
        break;
      case META_SETBKCOLOR:
        if (recSize >= 10) {
          state.bkColor = readColorRef(view, dataOff);
        }
        break;
      case META_SETBKMODE:
        if (recSize >= 8) {
          state.bkMode = view.getUint16(dataOff, true);
        }
        break;
      case META_SETROP2:
        if (recSize >= 8) {
          state.rop2 = view.getUint16(dataOff, true);
        }
        break;
      case META_SETPOLYFILLMODE:
        if (recSize >= 8) {
          state.polyFillMode = view.getUint16(dataOff, true);
        }
        break;
      case META_SETTEXTALIGN:
        if (recSize >= 8) {
          state.textAlign = view.getUint16(dataOff, true);
        }
        break;
      case META_CREATEPENINDIRECT:
        if (recSize >= 16) {
          const slot2 = allocObjectSlot();
          objectTable.set(slot2, {
            kind: "pen",
            style: view.getUint16(dataOff, true) & 255,
            widthX: view.getInt16(dataOff + 2, true),
            color: readColorRef(view, dataOff + 6)
          });
        }
        break;
      case META_CREATEBRUSHINDIRECT:
        if (recSize >= 14) {
          const slot2 = allocObjectSlot();
          objectTable.set(slot2, {
            kind: "brush",
            style: view.getUint16(dataOff, true),
            color: readColorRef(view, dataOff + 2)
          });
        }
        break;
      case META_DIBCREATEPATTERNBRUSH:
        objectTable.set(allocObjectSlot(), {
          kind: "brush",
          style: 0,
          color: recSize >= 14 ? dibAverageColor(view, dataOff + 4, offset + recSize) : "#c0c0c0"
        });
        break;
      case META_CREATEPATTERNBRUSH:
      case META_CREATEPALETTE:
      case META_CREATEREGION:
        objectTable.set(allocObjectSlot(), { kind: "unsupported" });
        break;
      case META_CREATEFONTINDIRECT:
        if (recSize >= 24) {
          let family = "";
          for (let i = 0; i < 32 && dataOff + 18 + i < offset + recSize; i++) {
            const ch = view.getUint8(dataOff + 18 + i);
            if (ch === 0) {
              break;
            }
            family += String.fromCharCode(ch);
          }
          const slot2 = allocObjectSlot();
          objectTable.set(slot2, {
            kind: "font",
            height: Math.abs(view.getInt16(dataOff, true)),
            escapement: view.getInt16(dataOff + 4, true),
            weight: view.getInt16(dataOff + 8, true),
            italic: view.getUint8(dataOff + 10) !== 0,
            underline: view.getUint8(dataOff + 11) !== 0,
            strikeOut: view.getUint8(dataOff + 12) !== 0,
            family: family || "sans-serif"
          });
        }
        break;
      case META_SELECTOBJECT:
        if (recSize >= 8) {
          const obj = objectTable.get(view.getUint16(dataOff, true));
          if (obj) {
            switch (obj.kind) {
              case "pen":
                state.penStyle = obj.style;
                state.penWidth = obj.widthX;
                state.penColor = obj.color;
                break;
              case "brush":
                state.brushStyle = obj.style;
                state.brushColor = obj.color;
                break;
              case "font":
                state.fontHeight = obj.height;
                state.fontWeight = obj.weight;
                state.fontItalic = obj.italic;
                state.fontUnderline = obj.underline;
                state.fontStrikeOut = obj.strikeOut;
                state.fontFamily = obj.family;
                state.fontEscapement = obj.escapement || 0;
                break;
            }
          }
        }
        break;
      case META_DELETEOBJECT:
        if (recSize >= 8) {
          objectTable.delete(view.getUint16(dataOff, true));
        }
        break;
    }
    offset += recSize;
  }
  if (recordCount >= maxRecords) {
    console.warn(
      `[emf-converter] WMF record limit reached (${maxRecords}). Output may be incomplete.`
    );
  }
}
var MAX_METAFILE_RECURSION = 3;
async function decodeDeferredImage(img, recursionDepth = 0) {
  const plainBuffer = new ArrayBuffer(img.imageData.byteLength);
  new Uint8Array(plainBuffer).set(new Uint8Array(img.imageData));
  if (img.isMetafile) {
    if (recursionDepth >= MAX_METAFILE_RECURSION) return null;
    const url = await convertEmfToDataUrl(plainBuffer, void 0, recursionDepth + 1) ?? await convertWmfToDataUrl(plainBuffer, void 0, recursionDepth + 1);
    if (!url) return null;
    const byteString = atob(url.split(",")[1]);
    const ab = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) ab[i] = byteString.charCodeAt(i);
    return await createImageBitmap(new Blob([ab], { type: url.match(/data:([^;]+)/)?.[1] ?? "image/png" }));
  }
  return await createImageBitmap(new Blob([plainBuffer]));
}
function hasEmfPlusImageObjects(view) {
  let offset = 0;
  while (offset + 8 <= view.byteLength) {
    const recType = view.getUint32(offset, true);
    const recSize = view.getUint32(offset + 4, true);
    if (recSize < 8 || offset + recSize > view.byteLength) break;
    if (recType === EMR_COMMENT && recSize >= 16 && view.getUint32(offset + 12, true) === EMFPLUS_SIGNATURE) {
      let p = offset + 16;
      const end = Math.min(offset + recSize, view.byteLength);
      while (p + 12 <= end) {
        const t = view.getUint16(p, true);
        const flags = view.getUint16(p + 2, true);
        const size = view.getUint32(p + 4, true);
        if (size < 12) break;
        if (t === EMFPLUS_OBJECT && (flags >> 8 & 127) === 5) return true;
        p += size;
      }
    }
    offset += recSize;
  }
  return false;
}
async function processDeferredImages(ctx, deferredImages, recursionDepth = 0) {
  emfLog(
    `processDeferredImages: processing ${deferredImages.length} deferred images (recursionDepth=${recursionDepth})...`
  );
  for (let idx = 0; idx < deferredImages.length; idx++) {
    const img = deferredImages[idx];
    emfLog(
      `  Deferred image [${idx}]: isMetafile=${img.isMetafile}, dataLen=${img.imageData.byteLength}, dest=(${img.dx.toFixed(1)},${img.dy.toFixed(1)},${img.dw.toFixed(1)},${img.dh.toFixed(1)}), transform=[${img.transform.map((v) => v.toFixed(3)).join(",")}]`
    );
    try {
      const plainBuffer = new ArrayBuffer(img.imageData.byteLength);
      const dstBytes = new Uint8Array(plainBuffer);
      dstBytes.set(new Uint8Array(img.imageData));
      ctx.setTransform(
        img.transform[0],
        img.transform[1],
        img.transform[2],
        img.transform[3],
        img.transform[4],
        img.transform[5]
      );
      if (img.isMetafile) {
        if (recursionDepth >= MAX_METAFILE_RECURSION) {
          emfWarn(
            `  Deferred image [${idx}]: skipping embedded metafile \u2014 recursion depth ${recursionDepth} >= ${MAX_METAFILE_RECURSION}`
          );
          continue;
        }
        emfLog(`  Deferred image [${idx}]: recursively converting embedded metafile...`);
        const metafileDataUrl = await convertEmfToDataUrl(plainBuffer, void 0, recursionDepth + 1) ?? await convertWmfToDataUrl(plainBuffer, void 0, recursionDepth + 1);
        if (metafileDataUrl) {
          emfLog(
            `  Deferred image [${idx}]: metafile converted, dataUrl length=${metafileDataUrl.length}`
          );
          const byteString = atob(metafileDataUrl.split(",")[1]);
          const mimeMatch = metafileDataUrl.match(/data:([^;]+)/);
          const mime = mimeMatch ? mimeMatch[1] : "image/png";
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const metaBlob = new Blob([ab], { type: mime });
          emfLog(
            `  Deferred image [${idx}]: creating ImageBitmap from ${metaBlob.size} byte blob (${mime})...`
          );
          const bitmap = await createImageBitmap(metaBlob);
          emfLog(`  Deferred image [${idx}]: ImageBitmap created ${bitmap.width}\xD7${bitmap.height}`);
          ctx.drawImage(bitmap, img.dx, img.dy, img.dw, img.dh);
          bitmap.close();
        } else {
          emfWarn(`  Deferred image [${idx}]: metafile conversion returned null`);
        }
      } else {
        emfLog(
          `  Deferred image [${idx}]: creating ImageBitmap from ${plainBuffer.byteLength} byte blob...`
        );
        const blob = new Blob([plainBuffer]);
        const bitmap = await createImageBitmap(blob);
        emfLog(`  Deferred image [${idx}]: ImageBitmap created ${bitmap.width}\xD7${bitmap.height}`);
        ctx.drawImage(bitmap, img.dx, img.dy, img.dw, img.dh);
        bitmap.close();
      }
    } catch (imgErr) {
      imgErr instanceof Error ? imgErr.message : String(imgErr);
      console.warn(
        "[emf-converter] Deferred image draw failed:",
        imgErr instanceof Error ? imgErr.message : imgErr,
        `(isMetafile=${img.isMetafile}, dataLen=${img.imageData.byteLength})`
      );
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
async function convertEmfToDataUrl(buffer, options, recursionDepth = 0) {
  if (recursionDepth > MAX_METAFILE_RECURSION) {
    return null;
  }
  const opts = options ?? {};
  const dpiScale = opts.dpiScale ?? DEFAULT_DPI_SCALE;
  const effectiveMaxWidth = opts.maxWidth;
  const effectiveMaxHeight = opts.maxHeight;
  const replayOptions = {
    maxRecords: opts.maxRecords,
    maxRecordsEmfPlus: opts.maxRecords,
    fontFamilyMap: opts.fontFamilyMap
  };
  try {
    emfLog("=== convertEmfToDataUrl START ===");
    emfLog(
      `Input buffer: ${buffer.byteLength} bytes, maxWidth=${effectiveMaxWidth}, maxHeight=${effectiveMaxHeight}, dpiScale=${dpiScale}`
    );
    if (buffer.byteLength >= 16) {
      const hdrBytes = new Uint8Array(buffer, 0, 16);
      emfLog(
        `First 16 bytes: [${Array.from(hdrBytes).map((b) => b.toString(16).padStart(2, "0")).join(" ")}]`
      );
    }
    const view = new DataView(buffer);
    const header = parseEmfHeader(view);
    if (!header) {
      emfLog("convertEmfToDataUrl: parseEmfHeader returned null \u2014 returning null");
      return null;
    }
    let renderBounds = getRenderableEmfBounds(header);
    if (!renderBounds) {
      emfLog("convertEmfToDataUrl: getRenderableEmfBounds returned null \u2014 returning null");
      return null;
    }
    let logicalW = renderBounds.right - renderBounds.left;
    let logicalH = renderBounds.bottom - renderBounds.top;
    const boundsW = header.bounds.right - header.bounds.left;
    const frameBounds = boundsW > 0 ? emfFrameDeviceBounds(header) : null;
    if (frameBounds && !emfBoundsCoverFrame(renderBounds, frameBounds.deviceRect)) {
      emfLog(
        `convertEmfToDataUrl: bounds disagree with frame \u2014 replaying in frame space (${frameBounds.pxW}\xD7${frameBounds.pxH}px)`
      );
      renderBounds = frameBounds.deviceRect;
      logicalW = frameBounds.pxW;
      logicalH = frameBounds.pxH;
    }
    emfLog(`convertEmfToDataUrl: logicalSize=${logicalW}\xD7${logicalH}`);
    const setup = createCanvas(
      logicalW,
      logicalH,
      effectiveMaxWidth,
      effectiveMaxHeight,
      dpiScale,
      opts.maxCanvasDimension
    );
    if (!setup) {
      emfLog("convertEmfToDataUrl: createCanvas returned null \u2014 returning null");
      return null;
    }
    const { canvas, ctx } = setup;
    emfLog(
      `convertEmfToDataUrl: canvas created ${canvas.width}\xD7${canvas.height} (dpiScale=${dpiScale})`
    );
    let passOptions = replayOptions;
    if (hasEmfPlusImageObjects(view) && typeof OffscreenCanvas !== "undefined") {
      const scratch = new OffscreenCanvas(4, 4).getContext("2d");
      if (scratch) {
        const pending = replayEmfRecords(view, scratch, renderBounds, canvas.width, canvas.height, dpiScale, replayOptions);
        const preDecoded = [];
        for (const img of pending) {
          try {
            preDecoded.push(await decodeDeferredImage(img, recursionDepth));
          } catch (imgErr) {
            console.warn("[emf-converter] image decode failed:", imgErr instanceof Error ? imgErr.message : imgErr);
            preDecoded.push(null);
          }
        }
        passOptions = { ...replayOptions, preDecoded };
      }
    }
    ctx.save();
    emfLog("convertEmfToDataUrl: starting replayEmfRecords...");
    const deferredImages = replayEmfRecords(
      view,
      ctx,
      renderBounds,
      canvas.width,
      canvas.height,
      dpiScale,
      passOptions
    );
    emfLog(
      `convertEmfToDataUrl: replayEmfRecords returned ${deferredImages.length} deferred images`
    );
    ctx.restore();
    await processDeferredImages(ctx, deferredImages);
    emfLog("convertEmfToDataUrl: exporting canvas to PNG data URL...");
    const result = await exportCanvasToPngDataUrl(canvas);
    if (result) {
      emfLog(`convertEmfToDataUrl: SUCCESS \u2014 data URL length=${result.length}`);
    } else {
      emfWarn("convertEmfToDataUrl: exportCanvasToPngDataUrl returned null");
    }
    emfLog("=== convertEmfToDataUrl END ===");
    return result;
  } catch (err) {
    emfWarn("convertEmfToDataUrl: EXCEPTION:", err instanceof Error ? err.message : err);
    console.warn("[pptx-editor] EMF conversion failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
async function convertWmfToDataUrl(buffer, options, recursionDepth = 0) {
  if (recursionDepth > MAX_METAFILE_RECURSION) {
    return null;
  }
  const opts = options ?? {};
  const dpiScale = opts.dpiScale ?? DEFAULT_DPI_SCALE;
  const effectiveMaxWidth = opts.maxWidth;
  const effectiveMaxHeight = opts.maxHeight;
  const replayOptions = {
    maxRecords: opts.maxRecords,
    fontFamilyMap: opts.fontFamilyMap
  };
  try {
    emfLog(
      "=== convertWmfToDataUrl START ===",
      `buffer=${buffer.byteLength} bytes, dpiScale=${dpiScale}`
    );
    const view = new DataView(buffer);
    const header = parseWmfHeader(view);
    if (!header) {
      emfLog("convertWmfToDataUrl: parseWmfHeader returned null");
      return null;
    }
    const logicalW = header.boundsRight - header.boundsLeft;
    const logicalH = header.boundsBottom - header.boundsTop;
    emfLog(`convertWmfToDataUrl: logicalSize=${logicalW}\xD7${logicalH}`);
    if (logicalW <= 0 || logicalH <= 0) {
      emfLog("convertWmfToDataUrl: invalid dimensions \u2014 returning null");
      return null;
    }
    const setup = createCanvas(
      logicalW,
      logicalH,
      effectiveMaxWidth,
      effectiveMaxHeight,
      dpiScale,
      opts.maxCanvasDimension
    );
    if (!setup) {
      return null;
    }
    const { canvas, ctx } = setup;
    ctx.save();
    replayWmfRecords(view, ctx, header, canvas.width, canvas.height, replayOptions);
    ctx.restore();
    const result = await exportCanvasToPngDataUrl(canvas);
    emfLog(`convertWmfToDataUrl: result=${result ? `dataUrl len=${result.length}` : "null"}`);
    emfLog("=== convertWmfToDataUrl END ===");
    return result;
  } catch (err) {
    emfWarn("convertWmfToDataUrl: EXCEPTION:", err instanceof Error ? err.message : err);
    console.warn("[pptx-editor] WMF conversion failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// vendor/genoffice/docx/metafile.ts
var EMF_MIMES = /* @__PURE__ */ new Set(["image/emf", "image/x-emf"]);
var FONT_FAMILY_MAP = {
  \u6E38\u30B4\u30B7\u30C3\u30AF: "Yu Gothic",
  // yuu goshikku
  \u6E38\u660E\u671D: "Yu Mincho",
  // yuu minchou
  \u30E1\u30A4\u30EA\u30AA: "Meiryo",
  "\uFF4D\uFF53 \uFF50\u30B4\u30B7\u30C3\u30AF": "MS PGothic",
  "\uFF4D\uFF53 \u30B4\u30B7\u30C3\u30AF": "MS Gothic",
  "\uFF4D\uFF53 \uFF55\uFF49\u30B4\u30B7\u30C3\u30AF": "MS UI Gothic",
  "\uFF4D\uFF53 \uFF50\u660E\u671D": "MS PMincho",
  "\uFF4D\uFF53 \u660E\u671D": "MS Mincho"
};
var WMF_MIMES = /* @__PURE__ */ new Set(["image/wmf", "image/x-wmf"]);
var EMZ_MIMES = /* @__PURE__ */ new Set(["image/emz", "image/x-emz"]);
var WMZ_MIMES = /* @__PURE__ */ new Set(["image/wmz", "image/x-wmz"]);
function isMetafileMime(mime) {
  return mime !== void 0 && (EMF_MIMES.has(mime) || WMF_MIMES.has(mime) || EMZ_MIMES.has(mime) || WMZ_MIMES.has(mime));
}
function isGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 31 && bytes[1] === 139;
}
var MAX_METAFILE_GUNZIP_BYTES = 64 * 1024 * 1024;
async function gunzip(bytes) {
  const reader = streamBytes(bytes).pipeThrough(decompressionStream("gzip")).getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_METAFILE_GUNZIP_BYTES) {
      await reader.cancel();
      throw new Error(
        `metafile gunzip output exceeds ${MAX_METAFILE_GUNZIP_BYTES} bytes (possible zip bomb)`
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.byteLength;
  }
  return out;
}
function looksLikeEmf(bytes) {
  if (bytes.length < 44) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === 1179469088;
}
function looksLikeWmf(bytes) {
  if (bytes.length < 18) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) === 2596720087) return true;
  const type = dv.getUint16(0, true);
  return (type === 1 || type === 2) && dv.getUint16(2, true) === 9;
}
async function metafileToDataUrl(bytes, mime, raster = {}) {
  try {
    let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (isGzip(u8)) u8 = await gunzip(u8);
    const buffer = u8.slice().buffer;
    if (!isMetafileMime(mime)) return null;
    let isEmf;
    if (looksLikeEmf(u8)) isEmf = true;
    else if (looksLikeWmf(u8)) isEmf = false;
    else isEmf = EMF_MIMES.has(mime) || EMZ_MIMES.has(mime);
    const opts = {
      dpiScale: 2,
      fontFamilyMap: FONT_FAMILY_MAP,
      ...raster.maxSidePx ? { maxWidth: raster.maxSidePx, maxHeight: raster.maxSidePx } : {}
    };
    const result = isEmf ? await convertEmfToDataUrl(buffer, opts) : await convertWmfToDataUrl(buffer, opts);
    if (result === null) {
      console.warn(`metafileToDataUrl: converter returned null (${mime}, ${u8.byteLength} bytes)`);
    }
    return result;
  } catch (err) {
    console.warn(`metafileToDataUrl: conversion failed (${mime}):`, err);
    return null;
  }
}

// vendor/genoffice/docx/tiff.ts
import UTIF from "utif2";
var TIFF_MIMES = /* @__PURE__ */ new Set(["image/tiff", "image/tif", "image/x-tiff"]);
function isTiffMime(mime) {
  return mime !== void 0 && TIFF_MIMES.has(mime);
}
var MAX_TIFF_PIXELS = 15e7;
var MAX_TIFF_DIM = 16384;
function tiffDimsOk(width, height) {
  return typeof width === "number" && typeof height === "number" && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_TIFF_DIM && height <= MAX_TIFF_DIM && width * height <= MAX_TIFF_PIXELS;
}
function decodeTiff(bytes) {
  const buf = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const ifds = UTIF.decode(buf);
  if (!ifds.length) return null;
  const headerDims = (ifd) => ({
    width: Array.isArray(ifd.t256) ? ifd.t256[0] : ifd.width,
    height: Array.isArray(ifd.t257) ? ifd.t257[0] : ifd.height
  });
  let page;
  let pagePixels = 0;
  for (const ifd of ifds) {
    const dims = headerDims(ifd);
    if (!tiffDimsOk(dims.width, dims.height)) continue;
    const pixels = dims.width * dims.height;
    if (!page || pixels > pagePixels) {
      page = ifd;
      pagePixels = pixels;
    }
  }
  if (!page) return null;
  UTIF.decodeImage(buf, page);
  const width = page.width;
  const height = page.height;
  if (!tiffDimsOk(width, height)) return null;
  const rgba = UTIF.toRGBA8(page);
  return {
    width,
    height,
    pixels: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4)
  };
}
function tiffToDataUrl(bytes) {
  const dom = globalThis;
  if (!dom.document || !dom.ImageData) return null;
  try {
    const decoded = decodeTiff(bytes);
    if (!decoded) return null;
    const { width, height, pixels } = decoded;
    const canvas = dom.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return null;
    ctx2d.putImageData(new dom.ImageData(pixels, width, height), 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
async function tiffToDataUrlAsync(bytes) {
  const dom = globalThis;
  if (dom.document) return tiffToDataUrl(bytes);
  if (!dom.OffscreenCanvas || !dom.ImageData) return null;
  try {
    const decoded = decodeTiff(bytes);
    if (!decoded) return null;
    const { width, height, pixels } = decoded;
    const canvas = new dom.OffscreenCanvas(width, height);
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return null;
    ctx2d.putImageData(new dom.ImageData(pixels, width, height), 0, 0);
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()
    );
    let binary = "";
    for (let i = 0; i < png.length; i += 32768) {
      binary += String.fromCharCode(...png.subarray(i, i + 32768));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

// vendor/genoffice/docx/math.ts
function ommlFragmentsOf(paragraphXml) {
  const re = /<m:oMath(?=[\s>])(?:\s[^>]*)?>[\s\S]*?<\/m:oMath>/g;
  return paragraphXml.match(re) ?? [];
}
function ommlToMathML(ommlXml) {
  const fragments = ommlFragmentsOf(ommlXml);
  const sources = fragments.length > 0 ? fragments : [ommlXml];
  const parts = [];
  for (const source of sources) {
    let parsed;
    try {
      parsed = xmlParser.parse(source);
    } catch {
      continue;
    }
    const root = parsed.find((n) => nameOf(n) === "m:oMath");
    if (!root) continue;
    const body = mmlChildren(childrenOf(root));
    if (body) parts.push(`<math display="block"><mrow>${body}</mrow></math>`);
  }
  return parts.join("");
}
function contentChildren(node) {
  return childrenOf(node).filter((c) => {
    const name = nameOf(c);
    return !!name && !name.endsWith("Pr");
  });
}
function mmlChildren(nodes) {
  return nodes.map(mmlOf).join("");
}
function mmlSlot(parent, name) {
  const slot2 = findChild(parent, name);
  if (!slot2) return "<mrow></mrow>";
  return `<mrow>${mmlChildren(contentChildren(slot2))}</mrow>`;
}
function propVal(node, prName, childName) {
  const pr = findChild(node, prName);
  if (!pr) return void 0;
  const child = findChild(pr, childName);
  if (!child) return void 0;
  return attrsOf(child)["m:val"];
}
function propOn(node, prName, childName) {
  const val2 = propVal(node, prName, childName);
  return val2 !== void 0 && !["0", "false", "off"].includes(val2.toLowerCase());
}
function mo(ch, extra = "") {
  return `<mo${extra}>${escapeXmlText(ch)}</mo>`;
}
function mmlOf(node) {
  switch (nameOf(node)) {
    case "m:r":
      return runToMml(node);
    case "m:f": {
      const type = propVal(node, "m:fPr", "m:type");
      const attrs = type === "noBar" ? ' linethickness="0"' : type === "lin" || type === "skw" ? ' bevelled="true"' : "";
      return `<mfrac${attrs}>${mmlSlot(node, "m:num")}${mmlSlot(node, "m:den")}</mfrac>`;
    }
    case "m:sSup":
      return `<msup>${mmlSlot(node, "m:e")}${mmlSlot(node, "m:sup")}</msup>`;
    case "m:sSub":
      return `<msub>${mmlSlot(node, "m:e")}${mmlSlot(node, "m:sub")}</msub>`;
    case "m:sSubSup":
      return `<msubsup>${mmlSlot(node, "m:e")}${mmlSlot(node, "m:sub")}${mmlSlot(node, "m:sup")}</msubsup>`;
    case "m:sPre":
      return "<mmultiscripts>" + mmlSlot(node, "m:e") + "<mprescripts/>" + mmlSlot(node, "m:sub") + mmlSlot(node, "m:sup") + "</mmultiscripts>";
    case "m:rad": {
      const inner = mmlSlot(node, "m:e");
      if (propOn(node, "m:radPr", "m:degHide") || !findChild(node, "m:deg")) {
        return `<msqrt>${inner}</msqrt>`;
      }
      return `<mroot>${inner}${mmlSlot(node, "m:deg")}</mroot>`;
    }
    case "m:d": {
      const beg = propVal(node, "m:dPr", "m:begChr") ?? "(";
      const end = propVal(node, "m:dPr", "m:endChr") ?? ")";
      const sep = propVal(node, "m:dPr", "m:sepChr") ?? "|";
      const slots = childrenOf(node).filter((c) => nameOf(c) === "m:e");
      const body = slots.map((slot2) => `<mrow>${mmlChildren(contentChildren(slot2))}</mrow>`).join(sep ? mo(sep) : "");
      const open = beg ? mo(beg, ' stretchy="true"') : "";
      const close = end ? mo(end, ' stretchy="true"') : "";
      return `<mrow>${open}${body}${close}</mrow>`;
    }
    case "m:nary": {
      const chr = propVal(node, "m:naryPr", "m:chr") ?? "\u222B";
      const limLoc = propVal(node, "m:naryPr", "m:limLoc") ?? (chr === "\u222B" ? "subSup" : "undOvr");
      const subHide = propOn(node, "m:naryPr", "m:subHide");
      const supHide = propOn(node, "m:naryPr", "m:supHide");
      const op = mo(chr, ' stretchy="false"');
      let scripted = op;
      if (!subHide && !supHide) {
        const tag2 = limLoc === "undOvr" ? "munderover" : "msubsup";
        scripted = `<${tag2}>${op}${mmlSlot(node, "m:sub")}${mmlSlot(node, "m:sup")}</${tag2}>`;
      } else if (!subHide) {
        const tag2 = limLoc === "undOvr" ? "munder" : "msub";
        scripted = `<${tag2}>${op}${mmlSlot(node, "m:sub")}</${tag2}>`;
      } else if (!supHide) {
        const tag2 = limLoc === "undOvr" ? "mover" : "msup";
        scripted = `<${tag2}>${op}${mmlSlot(node, "m:sup")}</${tag2}>`;
      }
      return `<mrow>${scripted}${mmlSlot(node, "m:e")}</mrow>`;
    }
    case "m:func":
      return `<mrow>${mmlSlot(node, "m:fName")}<mo>\u2061</mo>${mmlSlot(node, "m:e")}</mrow>`;
    case "m:limLow":
      return `<munder>${mmlSlot(node, "m:e")}${mmlSlot(node, "m:lim")}</munder>`;
    case "m:limUpp":
      return `<mover>${mmlSlot(node, "m:e")}${mmlSlot(node, "m:lim")}</mover>`;
    case "m:acc": {
      const chr = propVal(node, "m:accPr", "m:chr") ?? "\u0302";
      return `<mover accent="true">${mmlSlot(node, "m:e")}${mo(chr)}</mover>`;
    }
    case "m:bar": {
      const pos = propVal(node, "m:barPr", "m:pos") ?? "bot";
      const line = pos === "top" ? "\xAF" : "_";
      const tag2 = pos === "top" ? "mover" : "munder";
      return `<${tag2}>${mmlSlot(node, "m:e")}${mo(line, ' stretchy="true"')}</${tag2}>`;
    }
    case "m:groupChr": {
      const chr = propVal(node, "m:groupChrPr", "m:chr") ?? "\u23DF";
      const pos = propVal(node, "m:groupChrPr", "m:pos") ?? "bot";
      const tag2 = pos === "top" ? "mover" : "munder";
      return `<${tag2}>${mmlSlot(node, "m:e")}${mo(chr, ' stretchy="true"')}</${tag2}>`;
    }
    case "m:m": {
      const jc = attrsOf(
        findChild(
          findChild(
            findChild(findChild(findChild(node, "m:mPr") ?? {}, "m:mcs") ?? {}, "m:mc") ?? {},
            "m:mcPr"
          ) ?? {},
          "m:mcJc"
        ) ?? {}
      )["m:val"];
      const cellAttrs = jc === "left" || jc === "right" ? ` style="text-align:${jc};padding-${jc}:0"` : "";
      const rows = childrenOf(node).filter((c) => nameOf(c) === "m:mr").map((row) => {
        const cells = childrenOf(row).filter((c) => nameOf(c) === "m:e").map(
          (cell) => `<mtd${cellAttrs}><mrow>${mmlChildren(contentChildren(cell))}</mrow></mtd>`
        ).join("");
        return `<mtr>${cells}</mtr>`;
      }).join("");
      return `<mtable>${rows}</mtable>`;
    }
    case "m:eqArr": {
      const rows = childrenOf(node).filter((c) => nameOf(c) === "m:e").map((row) => `<mtr><mtd><mrow>${mmlChildren(contentChildren(row))}</mrow></mtd></mtr>`).join("");
      return `<mtable>${rows}</mtable>`;
    }
    case "m:borderBox": {
      const sides = ["Top", "Right", "Bot", "Left"].filter((side) => !propOn(node, "m:borderBoxPr", `m:hide${side}`)).map((side) => `border-${side === "Bot" ? "bottom" : side.toLowerCase()}:0.06em solid`);
      const style = sides.length ? ` style="${sides.join(";")};padding:0.15em"` : "";
      return `<mrow${style}>${mmlChildren(contentChildren(findChild(node, "m:e") ?? {}))}</mrow>`;
    }
    case "m:box":
    case "m:phant":
      return mmlSlot(node, "m:e");
    case "m:t":
      return runTextToMml(textOf(node), false);
    case void 0:
      return "";
    default:
      return mmlChildren(contentChildren(node));
  }
}
function runToMml(run2) {
  const sty = propVal(run2, "m:rPr", "m:sty");
  const plain = sty === "p" || !!findChild(findChild(run2, "m:rPr") ?? {}, "m:nor");
  let out = "";
  for (const child of childrenOf(run2)) {
    if (nameOf(child) === "m:t") out += runTextToMml(textOf(child), plain);
  }
  return out;
}
var OPERATOR_CHARS = new Set("+-\u2212=<>\xB1\u2213\xD7\xF7\xB7\u22C5\u2219*/!%&|,;:()[]{}\u2032\u2033\u221E\u2192\u2190\u2194\u21D2\u21D0\u21D4\u2208\u2209\u2282\u2283\u222A\u2229\u2200\u2203\u2227\u2228\xAC\u2264\u2265\u2260\u2248\u2261\u223C\u221D\u22A5\u2225\xB0\u2202\u2207");
function runTextToMml(text, plain) {
  if (plain)
    return text === "" ? "" : `<mi${[...text].length === 1 ? ' mathvariant="normal"' : ""}>${escapeXmlText(text)}</mi>`;
  let out = "";
  let i = 0;
  const chars = [...text];
  while (i < chars.length) {
    const ch = chars[i];
    if (/[0-9.]/.test(ch)) {
      let num2 = "";
      while (i < chars.length && /[0-9.]/.test(chars[i])) num2 += chars[i++];
      out += `<mn>${num2}</mn>`;
    } else if (/[A-Za-z\u0370-\u03FF\u{1D400}-\u{1D7FF}]/u.test(ch)) {
      out += `<mi>${escapeXmlText(ch)}</mi>`;
      i++;
    } else if (ch === " ") {
      i++;
    } else if (OPERATOR_CHARS.has(ch)) {
      const glyph = ch === "-" ? "\u2212" : ch;
      out += "()[]{}|".includes(ch) ? mo(ch, ' stretchy="false"') : mo(glyph);
      i++;
    } else {
      out += `<mtext>${escapeXmlText(ch)}</mtext>`;
      i++;
    }
  }
  return out;
}
var LATEX_SYMBOLS = {
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  epsilon: "\u03B5",
  varepsilon: "\u03B5",
  zeta: "\u03B6",
  eta: "\u03B7",
  theta: "\u03B8",
  vartheta: "\u03D1",
  iota: "\u03B9",
  kappa: "\u03BA",
  lambda: "\u03BB",
  mu: "\u03BC",
  nu: "\u03BD",
  xi: "\u03BE",
  pi: "\u03C0",
  rho: "\u03C1",
  sigma: "\u03C3",
  tau: "\u03C4",
  upsilon: "\u03C5",
  phi: "\u03C6",
  varphi: "\u03D5",
  chi: "\u03C7",
  psi: "\u03C8",
  omega: "\u03C9",
  Gamma: "\u0393",
  Delta: "\u0394",
  Theta: "\u0398",
  Lambda: "\u039B",
  Xi: "\u039E",
  Pi: "\u03A0",
  Sigma: "\u03A3",
  Upsilon: "\u03A5",
  Phi: "\u03A6",
  Psi: "\u03A8",
  Omega: "\u03A9",
  infty: "\u221E",
  pm: "\xB1",
  mp: "\u2213",
  times: "\xD7",
  div: "\xF7",
  cdot: "\u22C5",
  ast: "*",
  le: "\u2264",
  leq: "\u2264",
  ge: "\u2265",
  geq: "\u2265",
  ne: "\u2260",
  neq: "\u2260",
  approx: "\u2248",
  equiv: "\u2261",
  sim: "\u223C",
  propto: "\u221D",
  to: "\u2192",
  rightarrow: "\u2192",
  leftarrow: "\u2190",
  leftrightarrow: "\u2194",
  Rightarrow: "\u21D2",
  Leftarrow: "\u21D0",
  Leftrightarrow: "\u21D4",
  partial: "\u2202",
  nabla: "\u2207",
  in: "\u2208",
  notin: "\u2209",
  subset: "\u2282",
  supset: "\u2283",
  subseteq: "\u2286",
  supseteq: "\u2287",
  cup: "\u222A",
  cap: "\u2229",
  forall: "\u2200",
  exists: "\u2203",
  wedge: "\u2227",
  vee: "\u2228",
  neg: "\xAC",
  angle: "\u2220",
  perp: "\u22A5",
  parallel: "\u2225",
  ldots: "\u2026",
  cdots: "\u22EF",
  vdots: "\u22EE",
  ddots: "\u22F1",
  prime: "\u2032",
  circ: "\u2218",
  degree: "\xB0",
  bullet: "\u2219",
  star: "\u22C6",
  emptyset: "\u2205",
  hbar: "\u210F",
  ell: "\u2113",
  Re: "\u211C",
  Im: "\u2111",
  aleph: "\u2135",
  therefore: "\u2234",
  because: "\u2235"
};
var LATEX_FUNCTIONS = /* @__PURE__ */ new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "sinh",
  "cosh",
  "tanh",
  "coth",
  "arcsin",
  "arccos",
  "arctan",
  "ln",
  "log",
  "exp",
  "max",
  "min",
  "sup",
  "inf",
  "arg",
  "det",
  "gcd",
  "deg",
  "dim",
  "ker",
  "mod"
]);
var NARY_OPS = {
  sum: { chr: "\u2211", limLoc: "undOvr" },
  prod: { chr: "\u220F", limLoc: "undOvr" },
  coprod: { chr: "\u2210", limLoc: "undOvr" },
  bigcup: { chr: "\u22C3", limLoc: "undOvr" },
  bigcap: { chr: "\u22C2", limLoc: "undOvr" },
  int: { chr: "\u222B", limLoc: "subSup" },
  iint: { chr: "\u222C", limLoc: "subSup" },
  iiint: { chr: "\u222D", limLoc: "subSup" },
  oint: { chr: "\u222E", limLoc: "subSup" }
};
var ACCENT_CHARS = {
  hat: "\u0302",
  bar: "\u0304",
  vec: "\u20D7",
  dot: "\u0307",
  ddot: "\u0308",
  tilde: "\u0303",
  check: "\u030C",
  breve: "\u0306"
};
var MATRIX_DELIMS = {
  matrix: null,
  pmatrix: { beg: "(", end: ")" },
  bmatrix: { beg: "[", end: "]" },
  Bmatrix: { beg: "{", end: "}" },
  vmatrix: { beg: "|", end: "|" },
  Vmatrix: { beg: "\u2016", end: "\u2016" },
  cases: { beg: "{", end: "" }
};
var UnsupportedOmml = class extends Error {
};
function lazyMap(build) {
  let map = null;
  return () => map ??= build();
}
var symbolCommands = lazyMap(() => {
  const map = /* @__PURE__ */ new Map();
  for (const [name, ch] of Object.entries(LATEX_SYMBOLS)) {
    if (!map.has(ch)) map.set(ch, name);
  }
  return map;
});
var naryCommands = lazyMap(() => {
  const map = /* @__PURE__ */ new Map();
  for (const [name, { chr }] of Object.entries(NARY_OPS)) {
    if (!map.has(chr)) map.set(chr, name);
  }
  return map;
});
var accentCommands = lazyMap(() => {
  const map = /* @__PURE__ */ new Map();
  for (const [name, ch] of Object.entries(ACCENT_CHARS)) {
    if (!map.has(ch)) map.set(ch, name);
  }
  return map;
});
var delimTokens = lazyMap(() => {
  const map = /* @__PURE__ */ new Map([["", "."]]);
  for (const [token, ch] of Object.entries(LEFT_RIGHT_CHARS)) {
    if (ch !== "" && !map.has(ch)) map.set(ch, token);
  }
  return map;
});
var matrixEnvs = lazyMap(() => {
  const map = /* @__PURE__ */ new Map();
  for (const [env, delims] of Object.entries(MATRIX_DELIMS)) {
    if (env !== "matrix" && delims) map.set(`${delims.beg} ${delims.end}`, env);
  }
  return map;
});
function ommlToLatex(ommlXml) {
  const fragments = ommlFragmentsOf(ommlXml);
  const sources = fragments.length > 0 ? fragments : [ommlXml];
  if (sources.length !== 1) return null;
  let parsed;
  try {
    parsed = xmlParser.parse(sources[0]);
  } catch {
    return null;
  }
  const root = parsed.find((n) => nameOf(n) === "m:oMath");
  if (!root) return null;
  try {
    return latexOfChildren(childrenOf(root)).trim().replace(/\s{2,}/g, " ");
  } catch (e) {
    if (e instanceof UnsupportedOmml) return null;
    throw e;
  }
}
function latexOfChildren(nodes) {
  return nodes.filter((n) => !!nameOf(n)).map(latexOfNode).join("");
}
function latexSlot(parent, name) {
  const slot2 = findChild(parent, name);
  if (!slot2) return "";
  return latexOfChildren(contentChildren(slot2));
}
function latexOfNode(node) {
  switch (nameOf(node)) {
    case "m:r":
      return runToLatex(node);
    case "m:t":
      return charsToLatex(textOf(node));
    case "m:f": {
      const type = propVal(node, "m:fPr", "m:type");
      if (type !== void 0 && type !== "bar") throw new UnsupportedOmml();
      return `\\frac{${latexSlot(node, "m:num")}}{${latexSlot(node, "m:den")}}`;
    }
    case "m:sSup":
      return `{${latexSlot(node, "m:e")}}^{${latexSlot(node, "m:sup")}}`;
    case "m:sSub":
      return `{${latexSlot(node, "m:e")}}_{${latexSlot(node, "m:sub")}}`;
    case "m:sSubSup":
      return `{${latexSlot(node, "m:e")}}_{${latexSlot(node, "m:sub")}}^{${latexSlot(node, "m:sup")}}`;
    case "m:rad":
      if (propOn(node, "m:radPr", "m:degHide") || !findChild(node, "m:deg")) {
        return `\\sqrt{${latexSlot(node, "m:e")}}`;
      }
      return `\\sqrt[${latexSlot(node, "m:deg")}]{${latexSlot(node, "m:e")}}`;
    case "m:d":
      return delimiterToLatex(node);
    case "m:nary": {
      const chr = propVal(node, "m:naryPr", "m:chr") ?? "\u222B";
      const command = naryCommands().get(chr);
      if (!command) throw new UnsupportedOmml();
      const sub = propOn(node, "m:naryPr", "m:subHide") ? "" : `_{${latexSlot(node, "m:sub")}}`;
      const sup = propOn(node, "m:naryPr", "m:supHide") ? "" : `^{${latexSlot(node, "m:sup")}}`;
      return `\\${command}${sub}${sup} {${latexSlot(node, "m:e")}}`;
    }
    case "m:func": {
      const name = plainTextOfRuns(findChild(node, "m:fName")).trim();
      const arg = `{${latexSlot(node, "m:e")}}`;
      if (LATEX_FUNCTIONS.has(name)) return `\\${name} ${arg}`;
      if (name === "lim") return `\\lim ${arg}`;
      if (/^[A-Za-z]+$/.test(name)) return `\\operatorname{${name}} ${arg}`;
      throw new UnsupportedOmml();
    }
    case "m:limLow": {
      const base = plainTextOfRuns(findChild(node, "m:e")).trim();
      if (base === "lim") return `\\lim_{${latexSlot(node, "m:lim")}}`;
      throw new UnsupportedOmml();
    }
    case "m:acc": {
      const chr = propVal(node, "m:accPr", "m:chr") ?? "\u0302";
      const command = accentCommands().get(chr);
      if (!command) throw new UnsupportedOmml();
      return `\\${command}{${latexSlot(node, "m:e")}}`;
    }
    case "m:bar": {
      const pos = propVal(node, "m:barPr", "m:pos") ?? "bot";
      return `\\${pos === "top" ? "overline" : "underline"}{${latexSlot(node, "m:e")}}`;
    }
    case "m:groupChr": {
      const chr = propVal(node, "m:groupChrPr", "m:chr") ?? "\u23DF";
      if (chr === "\u23DF") return `\\underbrace{${latexSlot(node, "m:e")}}`;
      if (chr === "\u23DE") return `\\overbrace{${latexSlot(node, "m:e")}}`;
      throw new UnsupportedOmml();
    }
    case "m:m":
      return `\\begin{matrix} ${matrixBody(node)} \\end{matrix}`;
    case "m:box":
    case "m:borderBox":
    case "m:phant":
      return latexSlot(node, "m:e");
    case void 0:
      return "";
    default:
      throw new UnsupportedOmml();
  }
}
function matrixBody(node) {
  const rowName = findChildren(node, "m:mr").length > 0 ? "m:mr" : "m:e";
  const rows = childrenOf(node).filter((c) => nameOf(c) === rowName).map(
    (row) => rowName === "m:mr" ? childrenOf(row).filter((c) => nameOf(c) === "m:e").map((cell) => latexOfChildren(contentChildren(cell))).join(" & ") : latexOfChildren(contentChildren(row))
  );
  return rows.join(" \\\\ ");
}
function delimiterToLatex(node) {
  const beg = propVal(node, "m:dPr", "m:begChr") ?? "(";
  const end = propVal(node, "m:dPr", "m:endChr") ?? ")";
  const slots = childrenOf(node).filter((c) => nameOf(c) === "m:e");
  if (slots.length !== 1) throw new UnsupportedOmml();
  const inner = contentChildren(slots[0]);
  if (beg === "(" && end === ")" && inner.length === 1 && nameOf(inner[0]) === "m:f" && propVal(inner[0], "m:fPr", "m:type") === "noBar") {
    return `\\binom{${latexSlot(inner[0], "m:num")}}{${latexSlot(inner[0], "m:den")}}`;
  }
  if (inner.length === 1 && (nameOf(inner[0]) === "m:m" || nameOf(inner[0]) === "m:eqArr")) {
    const env = matrixEnvs().get(`${beg} ${end}`);
    if (env) return `\\begin{${env}} ${matrixBody(inner[0])} \\end{${env}}`;
  }
  const begTok = delimTokens().get(beg);
  const endTok = delimTokens().get(end);
  if (begTok === void 0 || endTok === void 0) throw new UnsupportedOmml();
  return `\\left${begTok} ${latexOfChildren(inner)} \\right${endTok}`;
}
function plainTextOfRuns(node) {
  if (!node) return "";
  let out = "";
  for (const run2 of findChildren(node, "m:r")) {
    for (const child of childrenOf(run2)) {
      if (nameOf(child) === "m:t") out += textOf(child);
    }
  }
  return out;
}
function runToLatex(run2) {
  const sty = propVal(run2, "m:rPr", "m:sty");
  const plain = sty === "p" || !!findChild(findChild(run2, "m:rPr") ?? {}, "m:nor");
  let text = "";
  for (const child of childrenOf(run2)) {
    if (nameOf(child) === "m:t") text += textOf(child);
  }
  if (!plain) return charsToLatex(text);
  const trimmed = text.trim();
  if (trimmed === "") return " ";
  if (LATEX_FUNCTIONS.has(trimmed)) return `\\${trimmed} `;
  if (trimmed === "lim") return "\\lim ";
  if (/[{}\\]/.test(text)) throw new UnsupportedOmml();
  return `\\text{${text}}`;
}
var CHAR_ESCAPES = {
  "{": "\\{ ",
  "}": "\\} ",
  _: "\\_ ",
  "^": "\\^ ",
  "&": "\\& ",
  "%": "\\% ",
  $: "\\$ ",
  "#": "\\# "
};
function charsToLatex(text) {
  let out = "";
  for (const ch of text) {
    if (ch === "\\" || ch === "\n") throw new UnsupportedOmml();
    if (ch in CHAR_ESCAPES) {
      out += CHAR_ESCAPES[ch];
      continue;
    }
    const command = symbolCommands().get(ch);
    out += command ? `\\${command} ` : ch;
  }
  return out;
}
var LEFT_RIGHT_CHARS = {
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "|": "|",
  ".": "",
  "\\{": "{",
  "\\}": "}",
  "\\|": "\u2016",
  "\\langle": "\u27E8",
  "\\rangle": "\u27E9",
  "\\lfloor": "\u230A",
  "\\rfloor": "\u230B",
  "\\lceil": "\u2308",
  "\\rceil": "\u2309"
};

// vendor/genoffice/docx/checkbox-control.ts
var DEFAULT_GLYPHS = { checked: "\u2612", unchecked: "\u2610" };
var glyphOf = (hex, fallback) => {
  const code = parseInt(hex ?? "", 16);
  return Number.isFinite(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : fallback;
};
var isOn = (val2) => {
  if (val2 === void 0) return true;
  const lower = val2.toLowerCase();
  return lower === "1" || lower === "true" || lower === "on";
};
function sdtCheckboxGlyphs(sdtPrXml) {
  const state = (name) => {
    const m = new RegExp(`<w14:${name}\\b[^>]*\\bw14:val=(?:"([^"]*)"|'([^']*)')`).exec(sdtPrXml);
    return m?.[1] ?? m?.[2];
  };
  return {
    checked: glyphOf(state("checkedState"), DEFAULT_GLYPHS.checked),
    unchecked: glyphOf(state("uncheckedState"), DEFAULT_GLYPHS.unchecked)
  };
}
function sdtCheckboxControl(sdt) {
  const sdtPr = findChild(sdt, "w:sdtPr");
  const box = sdtPr ? findChild(sdtPr, "w14:checkbox") : void 0;
  if (!sdtPr || !box) return null;
  const checkedEl = findChild(box, "w14:checked");
  const checked = checkedEl ? isOn(attrsOf(checkedEl)["w14:val"]) : false;
  const sdtPrXml = serializeXNode(sdtPr);
  const glyphs = sdtCheckboxGlyphs(sdtPrXml);
  return { sdtPrXml, glyph: checked ? glyphs.checked : glyphs.unchecked };
}
function sdtCheckboxIsChecked(sdtPrXml, glyph) {
  const glyphs = sdtCheckboxGlyphs(sdtPrXml);
  if (glyph === glyphs.checked) return true;
  if (glyph === glyphs.unchecked) return false;
  return /[☑☒✓✔✅]/u.test(glyph);
}
function syncSdtCheckbox(sdtPrXml, checked) {
  const val2 = `<w14:checked w14:val="${checked ? "1" : "0"}"/>`;
  const stripped = sdtPrXml.replace(/<w14:checked(?:\s[^>]*)?\/>/g, "");
  if (/<w14:checkbox(?:\s[^>]*)?\/>/.test(stripped))
    return stripped.replace(
      /<w14:checkbox((?:\s[^>]*)?)\/>/,
      `<w14:checkbox$1>${val2}</w14:checkbox>`
    );
  return stripped.replace(/<w14:checkbox(?:\s[^>]*)?>/, (open) => `${open}${val2}`);
}

// vendor/genoffice/docx/generate.ts
var WRAP_ELEMENT_RE = /<wp:wrapNone\s*\/>|<wp:wrapSquare[^>]*\/>|<wp:wrapTight[^>]*\/>|<wp:wrapThrough[^>]*\/>|<wp:wrapTopAndBottom\s*\/>|<wp:wrapSquare[\s\S]*?<\/wp:wrapSquare>|<wp:wrapTight[\s\S]*?<\/wp:wrapTight>|<wp:wrapThrough[\s\S]*?<\/wp:wrapThrough>|<wp:wrapTopAndBottom[\s\S]*?<\/wp:wrapTopAndBottom>/g;
function applyImageWrap(xml, wrap, posOffset, marginAlign, zOrder) {
  const hasAnchor = /<wp:anchor[\s>]/.test(xml);
  const existingWrap = xml.match(WRAP_ELEMENT_RE)?.[0];
  let out = xml.replace(/<wp:simplePos[^>]*\/>/, "").replace(/<wp:positionH[\s\S]*?<\/wp:positionH>/, "").replace(/<wp:positionV[\s\S]*?<\/wp:positionV>/, "").replace(WRAP_ELEMENT_RE, "");
  if (!wrap) {
    if (!hasAnchor) return xml;
    out = out.replace(/<wp:anchor[^>]*>/, '<wp:inline distT="0" distB="0" distL="0" distR="0">');
    return out.replace(/<\/wp:anchor>/, "</wp:inline>");
  }
  const behind = wrap === "behind" ? "1" : "0";
  const isSide = wrap === "square-left" || wrap === "square-right" || wrap === "tight-left" || wrap === "tight-right" || wrap === "through-left" || wrap === "through-right";
  let position;
  if (posOffset !== void 0) {
    const relH = posOffset.relativeTo ?? "column";
    const relV = posOffset.relativeTo ?? "paragraph";
    position = `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${relH}"><wp:posOffset>${Math.round(posOffset.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${relV}"><wp:posOffset>${Math.round(posOffset.y)}</wp:posOffset></wp:positionV>`;
  } else if (marginAlign !== void 0) {
    position = `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>${marginAlign.h}</wp:align></wp:positionH><wp:positionV relativeFrom="margin"><wp:align>${marginAlign.v}</wp:align></wp:positionV>`;
  } else {
    const hAlign = wrap.endsWith("-right") ? "right" : wrap === "topBottom" ? "center" : "left";
    position = `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${hAlign}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>`;
  }
  const keepKind = wrap.startsWith("tight-") ? "wp:wrapTight" : wrap.startsWith("through-") ? "wp:wrapThrough" : null;
  const wrapElement = keepKind && existingWrap?.startsWith(`<${keepKind}`) ? existingWrap : isSide ? '<wp:wrapSquare wrapText="bothSides"/>' : wrap === "topBottom" ? "<wp:wrapTopAndBottom/>" : "<wp:wrapNone/>";
  const anchorOpen = `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${251658240 + (zOrder ?? 0)}" behindDoc="${behind}" locked="0" layoutInCell="1" allowOverlap="1">`;
  if (hasAnchor) {
    out = out.replace(/<wp:anchor[^>]*>/, anchorOpen);
  } else {
    out = out.replace(/<wp:inline[^>]*>/, anchorOpen).replace(/<\/wp:inline>/, "</wp:anchor>");
  }
  out = out.replace(/(<wp:anchor[^>]*>)/, `$1${position}`);
  if (/<wp:docPr/.test(out)) return out.replace(/<wp:docPr/, `${wrapElement}<wp:docPr`);
  return out.replace(/<a:graphic[\s>]/, (m) => `${wrapElement}${m}`);
}
var PPR_CHILD_ORDER = [
  "w:pStyle",
  "w:keepNext",
  "w:keepLines",
  "w:pageBreakBefore",
  "w:framePr",
  "w:widowControl",
  "w:numPr",
  "w:suppressLineNumbers",
  "w:pBdr",
  "w:shd",
  "w:tabs",
  "w:suppressAutoHyphens",
  "w:kinsoku",
  "w:wordWrap",
  "w:overflowPunct",
  "w:topLinePunct",
  "w:autoSpaceDE",
  "w:autoSpaceDN",
  "w:bidi",
  "w:adjustRightInd",
  "w:snapToGrid",
  "w:spacing",
  "w:ind",
  "w:contextualSpacing",
  "w:mirrorIndents",
  "w:suppressOverlap",
  "w:jc",
  "w:textDirection",
  "w:textAlignment",
  "w:textboxTightWrap",
  "w:outlineLvl",
  "w:divId",
  "w:cnfStyle",
  "w:rPr",
  "w:sectPr",
  "w:pPrChange"
];
function paraSpacingXml(format) {
  const attrs = [];
  if (format.spaceBefore && format.spaceBefore > 0) {
    attrs.push(`w:before="${Math.round(format.spaceBefore)}"`);
  }
  if (format.spaceBeforeAuto !== void 0)
    attrs.push(`w:beforeAutospacing="${format.spaceBeforeAuto ? 1 : 0}"`);
  if (format.spaceAfter !== void 0 && format.spaceAfter >= 0) {
    attrs.push(`w:after="${Math.round(format.spaceAfter)}"`);
  }
  if (format.spaceAfterAuto !== void 0)
    attrs.push(`w:afterAutospacing="${format.spaceAfterAuto ? 1 : 0}"`);
  if ((format.lineRule === "exact" || format.lineRule === "atLeast") && format.lineRawTwips) {
    attrs.push(`w:line="${Math.round(format.lineRawTwips)}"`, `w:lineRule="${format.lineRule}"`);
  } else if (format.lineSpacing && format.lineSpacing > 0) {
    attrs.push(`w:line="${Math.round(format.lineSpacing * 240)}"`, 'w:lineRule="auto"');
  }
  return attrs.length > 0 ? `<w:spacing ${attrs.join(" ")}/>` : "";
}
function formatPPrChildren(format) {
  if (!format) return [];
  const out = [];
  if (format.pageBreakBefore) out.push({ name: "w:pageBreakBefore", xml: "<w:pageBreakBefore/>" });
  for (const tag2 of PPR_FLAG_TAGS) {
    const v = format[PPR_FLAG_FIELDS[tag2]];
    if (v !== void 0) out.push({ name: tag2, xml: v ? `<${tag2}/>` : `<${tag2} w:val="0"/>` });
  }
  if (format.borders) {
    const style = format.borderStyle;
    const defaultSz = Math.max(2, Math.round(style?.szEighths ?? 4));
    const space = Math.min(31, Math.max(0, Math.round(style?.spacePt ?? 0)));
    const defaultColor = style?.color ? escapeXmlAttr(style.color) : "auto";
    const line = (side, ch) => {
      const declared = format.borderLines?.[ch];
      const sz = declared?.szPt ? Math.max(1, Math.round(declared.szPt * 8)) : defaultSz;
      const color = declared?.color ? escapeXmlAttr(declared.color) : defaultColor;
      const sp = declared?.spacePt !== void 0 ? Math.min(31, Math.max(0, Math.round(declared.spacePt))) : space;
      return `<w:${side} w:val="single" w:sz="${sz}" w:space="${sp}" w:color="${color}"/>`;
    };
    const sides = [];
    if (format.borders.includes("t")) sides.push(line("top", "t"));
    if (format.borders.includes("l")) sides.push(line("left", "l"));
    if (format.borders.includes("b")) sides.push(line("bottom", "b"));
    if (format.borders.includes("r")) sides.push(line("right", "r"));
    if (sides.length > 0) out.push({ name: "w:pBdr", xml: `<w:pBdr>${sides.join("")}</w:pBdr>` });
  }
  if (format.shadingFill) {
    out.push({
      name: "w:shd",
      xml: `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXmlAttr(format.shadingFill)}"/>`
    });
  }
  if (format.bidi) out.push({ name: "w:bidi", xml: "<w:bidi/>" });
  const spacing = paraSpacingXml(format);
  if (spacing) out.push({ name: "w:spacing", xml: spacing });
  const indAttrs = [];
  if (format.indentLeft !== void 0) indAttrs.push(`w:left="${Math.round(format.indentLeft)}"`);
  if (format.indentRight !== void 0) indAttrs.push(`w:right="${Math.round(format.indentRight)}"`);
  if (format.indentFirstLine !== void 0) {
    if (format.indentFirstLine >= 0)
      indAttrs.push(`w:firstLine="${Math.round(format.indentFirstLine)}"`);
    else indAttrs.push(`w:hanging="${Math.round(-format.indentFirstLine)}"`);
  }
  if (indAttrs.length > 0) out.push({ name: "w:ind", xml: `<w:ind ${indAttrs.join(" ")}/>` });
  if (format.align) {
    let jc = format.align === "justify" ? "both" : format.align;
    if (format.bidi && (jc === "left" || jc === "right")) jc = jc === "left" ? "right" : "left";
    out.push({ name: "w:jc", xml: `<w:jc w:val="${jc}"/>` });
  }
  const realStops = (format.tabStops ?? []).filter((ts) => !ts.rel && !ts.inherited);
  if (realStops.length > 0) {
    const tabXml = realStops.map((ts) => {
      let xml = `<w:tab w:val="${escapeXmlAttr(ts.val)}" w:pos="${ts.pos}"`;
      if (ts.leader && ts.leader !== "none") xml += ` w:leader="${escapeXmlAttr(ts.leader)}"`;
      return xml + "/>";
    }).join("");
    out.push({ name: "w:tabs", xml: `<w:tabs>${tabXml}</w:tabs>` });
  }
  if (format.textDirection) {
    out.push({ name: "w:textDirection", xml: `<w:textDirection w:val="${format.textDirection}"/>` });
  }
  if (format.frame) {
    out.push({ name: "w:framePr", xml: framePrXml(format.frame) });
  } else if (format.dropCap) {
    const { type, lines } = format.dropCap;
    out.push({
      name: "w:framePr",
      xml: `<w:framePr w:dropCap="${type}" w:lines="${lines}" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>`
    });
  }
  if (format.emptyRunSizeHalfPoints) {
    const sz = Math.round(format.emptyRunSizeHalfPoints);
    out.push({ name: "w:rPr", xml: `<w:rPr><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>` });
  }
  return out;
}
function framePrXml(frame) {
  const attrs = [`w:w="${Math.round(frame.wTwips)}"`];
  if (frame.hTwips !== void 0) {
    attrs.push(`w:h="${Math.round(frame.hTwips)}"`, `w:hRule="${frame.hRule ?? "atLeast"}"`);
  }
  if (frame.vSpaceTwips) attrs.push(`w:vSpace="${Math.round(frame.vSpaceTwips)}"`);
  if (frame.hSpaceTwips) attrs.push(`w:hSpace="${Math.round(frame.hSpaceTwips)}"`);
  attrs.push(
    `w:wrap="${frame.wrap ?? "none"}"`,
    `w:vAnchor="${frame.vAnchor ?? "page"}"`,
    `w:hAnchor="${frame.hAnchor ?? "page"}"`,
    `w:x="${Math.round(frame.xTwips)}"`
  );
  if (frame.xAlign) attrs.push(`w:xAlign="${frame.xAlign}"`);
  attrs.push(`w:y="${Math.round(frame.yTwips)}"`);
  if (frame.yAlign) attrs.push(`w:yAlign="${frame.yAlign}"`);
  if (frame.anchorLock) attrs.push('w:anchorLock="1"');
  return `<w:framePr ${attrs.join(" ")}/>`;
}
var PPR_FLAG_FIELDS = {
  "w:keepNext": "keepNext",
  "w:keepLines": "keepLines",
  "w:widowControl": "widowControl",
  "w:suppressLineNumbers": "suppressLineNumbers",
  "w:contextualSpacing": "contextualSpacing"
};
var PPR_FLAG_TAGS = Object.keys(PPR_FLAG_FIELDS);
var FORMAT_MANAGED_TAGS = /* @__PURE__ */ new Set([
  "w:pageBreakBefore",
  "w:pBdr",
  "w:shd",
  "w:bidi",
  "w:spacing",
  "w:ind",
  "w:jc"
]);
function splitXmlChildren(xml) {
  const out = [];
  const tagRe = /<(\/?)([A-Za-z0-9:._-]+)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  let depth = 0;
  let start = -1;
  let name = "";
  let match;
  while ((match = tagRe.exec(xml)) !== null) {
    const closing = match[1] === "/";
    const selfClosing = match[3].endsWith("/");
    if (closing) {
      depth--;
      if (depth === 0) out.push({ name, xml: xml.slice(start, match.index + match[0].length) });
    } else if (selfClosing) {
      if (depth === 0) out.push({ name: match[2], xml: match[0] });
    } else {
      if (depth === 0) {
        start = match.index;
        name = match[2];
      }
      depth++;
    }
  }
  return out;
}
var JC_TO_ALIGN = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  lowKashida: "justify",
  mediumKashida: "justify",
  highKashida: "justify",
  thaiDistribute: "justify",
  distribute: "distribute"
};
function rawSpacingUnchanged(raw, f) {
  const rule = rawAttr(raw, "w:lineRule") ?? "auto";
  const line = parseInt(rawAttr(raw, "w:line") ?? "", 10);
  const before = parseInt(rawAttr(raw, "w:before") ?? "", 10);
  const afterStr = rawAttr(raw, "w:after");
  const after = parseInt(afterStr ?? "", 10);
  const rawBefore = before > 0 ? before : void 0;
  const rawAfter = afterStr !== void 0 && after >= 0 ? after : void 0;
  const fBefore = f.spaceBefore && f.spaceBefore > 0 ? Math.round(f.spaceBefore) : void 0;
  const fAfter = f.spaceAfter !== void 0 && f.spaceAfter >= 0 ? Math.round(f.spaceAfter) : void 0;
  if (rawBefore !== fBefore || rawAfter !== fAfter) return false;
  const rawAuto = (v) => v === void 0 ? void 0 : v === "1" || v === "true";
  if (rawAuto(rawAttr(raw, "w:beforeAutospacing")) !== f.spaceBeforeAuto) return false;
  if (rawAuto(rawAttr(raw, "w:afterAutospacing")) !== f.spaceAfterAuto) return false;
  if ((f.lineRule === "exact" || f.lineRule === "atLeast") && f.lineRawTwips) {
    return line > 0 && rule === f.lineRule && line === Math.round(f.lineRawTwips);
  }
  if (f.lineSpacing && f.lineSpacing > 0) {
    return line > 0 && rule === "auto" && Math.round(line / 240 * 100) / 100 === f.lineSpacing;
  }
  return !(line > 0);
}
function rawIndUnchanged(raw, f) {
  const left = parseInt(rawAttr(raw, "w:left") ?? rawAttr(raw, "w:start") ?? "", 10);
  const right = parseInt(rawAttr(raw, "w:right") ?? rawAttr(raw, "w:end") ?? "", 10);
  const firstLine = parseInt(rawAttr(raw, "w:firstLine") ?? "", 10);
  const hanging = parseInt(rawAttr(raw, "w:hanging") ?? "", 10);
  const rawLeft = Number.isFinite(left) ? left : void 0;
  const rawRight = Number.isFinite(right) ? right : void 0;
  const rawFirst = hanging > 0 ? -hanging : firstLine > 0 ? firstLine : Number.isFinite(firstLine) || Number.isFinite(hanging) ? 0 : void 0;
  const norm = (v) => v !== void 0 ? Math.round(v) : void 0;
  return rawLeft === norm(f.indentLeft) && rawRight === norm(f.indentRight) && rawFirst === norm(f.indentFirstLine);
}
function rawPBdrUnchanged(raw, f) {
  let rawBorders = "";
  const rawLines = {};
  if (raw) {
    const inner = raw.replace(/^<w:pBdr[^>]*>/, "").replace(/<\/w:pBdr>$/, "");
    const kids = splitXmlChildren(inner);
    for (const [side, ch] of [
      ["top", "t"],
      ["bottom", "b"],
      ["left", "l"],
      ["right", "r"]
    ]) {
      const el = kids.find((k) => k.name === `w:${side}`);
      const val2 = el ? rawAttr(el.xml, "w:val") : void 0;
      if (!el || val2 === "none" || val2 === "nil") continue;
      rawBorders += ch;
      const color = rawAttr(el.xml, "w:color");
      const sz = parseInt(rawAttr(el.xml, "w:sz") ?? "", 10);
      const line = {};
      if (color && color !== "auto") line.color = color;
      if (Number.isFinite(sz) && sz > 0) line.szPt = sz / 8;
      const space = parseInt(rawAttr(el.xml, "w:space") ?? "", 10);
      if (Number.isFinite(space) && space > 0) line.spacePt = space;
      if (line.color !== void 0 || line.szPt !== void 0 || line.spacePt !== void 0)
        rawLines[ch] = line;
    }
  }
  const norm = (s) => s ? [...new Set(s)].sort().join("") : "";
  if (norm(rawBorders) !== norm(f.borders)) return false;
  const normLines = (lines) => JSON.stringify(
    ["t", "b", "l", "r"].map((ch) => [
      lines?.[ch]?.color ?? null,
      lines?.[ch]?.szPt ?? null,
      lines?.[ch]?.spacePt ?? null
    ])
  );
  return normLines(rawLines) === normLines(f.borderLines);
}
function rawTabsUnchanged(raw, allStops) {
  const stops = allStops.filter((s) => !s.rel && !s.inherited);
  const rawStops = [];
  if (raw) {
    const inner = raw.replace(/^<w:tabs[^>]*>/, "").replace(/<\/w:tabs>$/, "");
    for (const kid of splitXmlChildren(inner)) {
      if (kid.name !== "w:tab") continue;
      const pos = parseInt(rawAttr(kid.xml, "w:pos") ?? "", 10);
      if (!Number.isFinite(pos)) continue;
      rawStops.push({ pos, val: rawAttr(kid.xml, "w:val") ?? "left" });
      const leader = rawAttr(kid.xml, "w:leader");
      if (leader && leader !== "none") rawStops[rawStops.length - 1].leader = leader;
    }
  }
  if (rawStops.length !== stops.length) return false;
  const normLeader = (l) => l && l !== "none" ? l : void 0;
  return rawStops.every(
    (r, i) => r.pos === stops[i].pos && r.val === stops[i].val && normLeader(r.leader) === normLeader(stops[i].leader)
  );
}
function rawFramePrUnchanged(raw, f) {
  if (f.frame !== void 0) return raw !== void 0 && raw === framePrXml(f.frame);
  const val2 = rawAttr(raw, "w:dropCap");
  const rawDc = val2 === "drop" || val2 === "margin" ? { type: val2, lines: parseInt(rawAttr(raw, "w:lines") ?? "3", 10) || 3 } : void 0;
  return rawDc?.type === f.dropCap?.type && rawDc?.lines === f.dropCap?.lines;
}
function sameIndent(a, b) {
  const norm = (v) => v !== void 0 ? Math.round(v) : void 0;
  return norm(a.indentLeft) === norm(b.indentLeft) && norm(a.indentRight) === norm(b.indentRight) && norm(a.indentFirstLine) === norm(b.indentFirstLine);
}
function charIndentCancelAttrs(chars) {
  if (!chars) return [];
  const out = [];
  if (chars.left) out.push('w:leftChars="0"');
  if (chars.right) out.push('w:rightChars="0"');
  if (chars.hanging) out.push('w:hangingChars="0"');
  else if (chars.firstLine) out.push('w:firstLineChars="0"');
  return out;
}
function pprGroupUnchanged(tag2, raw, f, original) {
  switch (tag2) {
    case "w:pageBreakBefore":
      return rawBool(raw) === !!f.pageBreakBefore;
    case "w:keepNext":
    case "w:keepLines":
    case "w:widowControl":
    case "w:suppressLineNumbers":
    case "w:contextualSpacing": {
      const field = PPR_FLAG_FIELDS[tag2];
      const v = f[field];
      if (v === void 0) return original?.[field] === void 0;
      return raw !== void 0 && rawBool(raw) === v;
    }
    case "w:bidi":
      return rawBool(raw) === !!f.bidi;
    case "w:jc": {
      const val2 = rawAttr(raw, "w:val");
      let rawAlign = val2 ? JC_TO_ALIGN[val2] : void 0;
      if (f.bidi && (rawAlign === "left" || rawAlign === "right")) {
        rawAlign = rawAlign === "left" ? "right" : "left";
      }
      return rawAlign === f.align;
    }
    case "w:spacing":
      return rawSpacingUnchanged(raw, f);
    case "w:ind":
      if (original !== void 0) {
        if (sameIndent(original, f)) return true;
        if (original.charIndents) return false;
      }
      return rawIndUnchanged(raw, f);
    case "w:pBdr":
      return rawPBdrUnchanged(raw, f);
    case "w:shd": {
      const fill = rawAttr(raw, "w:fill");
      return (fill && fill !== "auto" ? fill : void 0) === f.shadingFill;
    }
    case "w:tabs":
      return rawTabsUnchanged(raw, f.tabStops ?? []);
    case "w:framePr":
      return rawFramePrUnchanged(raw, f);
    case "w:rPr": {
      const m = raw ? /<w:sz\b[^>]*w:val="(\d+)"/.exec(raw) : null;
      return (m ? parseInt(m[1], 10) : void 0) === f.emptyRunSizeHalfPoints;
    }
    default:
      return false;
  }
}
function mergePPrFormat(rawPPr, format, original) {
  const open = /^<w:pPr(?: [^>]*)?>/.exec(rawPPr)?.[0];
  const fresh = formatPPrChildren(format);
  if (original?.charIndents && !sameIndent(original, format ?? {})) {
    const cancel = charIndentCancelAttrs(original.charIndents);
    const at = fresh.findIndex((c) => c.name === "w:ind");
    const xml = at === -1 ? `<w:ind ${cancel.join(" ")}/>` : fresh[at].xml.replace(/\/>$/, ` ${cancel.join(" ")}/>`);
    if (at === -1) fresh.push({ name: "w:ind", xml });
    else fresh[at] = { name: "w:ind", xml };
  }
  if (!open) {
    const sorted = [...fresh].sort(
      (a, b) => PPR_CHILD_ORDER.indexOf(a.name) - PPR_CHILD_ORDER.indexOf(b.name)
    );
    return sorted.length > 0 ? `<w:pPr>${sorted.map((c) => c.xml).join("")}</w:pPr>` : "";
  }
  const inner = rawPPr.slice(open.length, rawPPr.length - "</w:pPr>".length);
  const managedTags = new Set(FORMAT_MANAGED_TAGS);
  if (format?.tabStops !== void 0) managedTags.add("w:tabs");
  for (const tag2 of PPR_FLAG_TAGS) {
    const field = PPR_FLAG_FIELDS[tag2];
    if (format?.[field] !== void 0 || original?.[field] !== void 0) managedTags.add(tag2);
  }
  if (format?.dropCap !== void 0 || format?.frame !== void 0) managedTags.add("w:framePr");
  if (format?.textDirection !== void 0) managedTags.add("w:textDirection");
  if (format?.emptyRunSizeHalfPoints !== void 0) managedTags.add("w:rPr");
  const rawChildren = splitXmlChildren(inner);
  const rawOf = (tag2) => rawChildren.find((c) => c.name === tag2)?.xml;
  const rebuilt = new Set(
    [...managedTags].filter((tag2) => !pprGroupUnchanged(tag2, rawOf(tag2), format ?? {}, original))
  );
  const rank = (n) => PPR_CHILD_ORDER.indexOf(n);
  const freshOut = fresh.filter((c) => rebuilt.has(c.name)).sort((a, b) => rank(a.name) - rank(b.name));
  const kept = rawChildren.filter((c) => !rebuilt.has(c.name));
  const parts = [];
  let fi = 0;
  let prevRank = -1;
  for (const child of kept) {
    const own = rank(child.name);
    const effective = own === -1 ? prevRank : Math.max(own, prevRank);
    while (fi < freshOut.length && rank(freshOut[fi].name) < effective)
      parts.push(freshOut[fi++].xml);
    parts.push(child.xml);
    prevRank = effective;
  }
  while (fi < freshOut.length) parts.push(freshOut[fi++].xml);
  if (parts.length === 0) return "";
  return `${open}${parts.join("")}</w:pPr>`;
}
function revisionPPrChangeXml(changeJson) {
  let change;
  try {
    change = JSON.parse(changeJson);
  } catch {
    return null;
  }
  const old = change.old ?? {};
  const oldFormat = old.format && typeof old.format === "object" ? old.format : old;
  const children = [];
  if (old.styleId) {
    children.push({
      name: "w:pStyle",
      xml: `<w:pStyle w:val="${escapeXmlAttr(String(old.styleId))}"/>`
    });
  }
  if (old.type === "docListItem" && old.numId) {
    const ilvl = Math.min(Math.max(Number(old.ilvl) || 0, 0), 8);
    children.push({
      name: "w:numPr",
      xml: `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${escapeXmlAttr(String(old.numId))}"/></w:numPr>`
    });
  }
  children.push(...formatPPrChildren(oldFormat));
  children.sort((a, b) => PPR_CHILD_ORDER.indexOf(a.name) - PPR_CHILD_ORDER.indexOf(b.name));
  const attrs = ` w:id="${escapeXmlAttr(String(change.id ?? "0"))}" w:author="${escapeXmlAttr(String(change.author ?? ""))}"` + (change.date ? ` w:date="${escapeXmlAttr(String(change.date))}"` : "");
  return `<w:pPrChange${attrs}><w:pPr>${children.map((child) => child.xml).join("")}</w:pPr></w:pPrChange>`;
}
function generateParagraphXml(block, ctx) {
  const crossStarts = (block.commentStarts ?? []).map((id) => `<w:commentRangeStart w:id="${escapeXmlAttr(id)}"/>`).join("");
  const crossEnds = (block.commentEnds ?? []).map(
    (id) => `<w:commentRangeEnd w:id="${escapeXmlAttr(id)}"/><w:r><w:commentReference w:id="${escapeXmlAttr(id)}"/></w:r>`
  ).join("");
  const content = bookmarksXml(ctx, block.hiddenBookmarks) + bookmarksXml(ctx, block.bookmarks) + crossStarts + generateRunsXml(block.runs, ctx) + crossEnds;
  if (block.rawPPr !== void 0) return `<w:p>${block.rawPPr}${content}</w:p>`;
  const children = [];
  let styleId;
  if (block.type === "heading") {
    const level = Math.min(Math.max(block.level ?? 1, 1), 9);
    if (block.outlineOnly) {
      styleId = block.styleId;
      children.push({ name: "w:outlineLvl", xml: `<w:outlineLvl w:val="${level - 1}"/>` });
    } else styleId = block.styleId ?? ctx.headingStyleIds.get(level);
  } else if (block.type === "listItem") {
    styleId = block.styleId ?? ctx.listParagraphStyleId;
  } else {
    styleId = block.styleId;
  }
  if (styleId)
    children.push({ name: "w:pStyle", xml: `<w:pStyle w:val="${escapeXmlAttr(styleId)}"/>` });
  if (block.type === "listItem" && block.list) {
    const ilvl = Math.min(Math.max(block.list.ilvl, 0), 8);
    children.push({
      name: "w:numPr",
      xml: `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${escapeXmlAttr(block.list.numId)}"/></w:numPr>`
    });
  }
  children.push(...formatPPrChildren(block.format));
  if (block.pPrChange) {
    const revision = revisionPPrChangeXml(block.pPrChange);
    if (revision) children.push({ name: "w:pPrChange", xml: revision });
  }
  children.sort((a, b) => PPR_CHILD_ORDER.indexOf(a.name) - PPR_CHILD_ORDER.indexOf(b.name));
  const pPr = children.length > 0 ? `<w:pPr>${children.map((c) => c.xml).join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${content}</w:p>`;
}
var standaloneBookmarkSeq = 0;
function bookmarksXml(ctx, names) {
  if (!names?.length) return "";
  return names.map((name) => {
    const id = ctx.allocateBookmarkId?.(name) ?? ++standaloneBookmarkSeq;
    return `<w:bookmarkStart w:id="${id}" w:name="${escapeXmlAttr(name)}"/><w:bookmarkEnd w:id="${id}"/>`;
  }).join("");
}
function generateRunsXml(runs, ctx) {
  return runsXml(runs, ctx.allocateHyperlinkRel);
}
function inlineRunsXml(runs) {
  return runsXml(runs, null);
}
function runsXml(runs, allocate) {
  const firstOf = /* @__PURE__ */ new Map();
  const lastOf = /* @__PURE__ */ new Map();
  runs.forEach((run2, i) => {
    for (const id of run2.commentIds ?? []) {
      if (!firstOf.has(id)) firstOf.set(id, i);
      lastOf.set(id, i);
    }
  });
  const startsAt = (i) => [...firstOf].filter(([, at]) => at === i).map(([id]) => `<w:commentRangeStart w:id="${escapeXmlAttr(id)}"/>`).join("");
  const endsAt = (i) => [...lastOf].filter(([, at]) => at === i).map(
    ([id]) => `<w:commentRangeEnd w:id="${escapeXmlAttr(id)}"/><w:r><w:commentReference w:id="${escapeXmlAttr(id)}"/></w:r>`
  ).join("");
  const parts = [];
  const emitRange = (from, to) => {
    let i = from;
    while (i < to) {
      const run2 = runs[i];
      if (run2.link) {
        const group = [];
        const groupStart = i;
        const href = run2.link.href;
        let rId = run2.link.rId;
        while (i < to && runs[i].link && runs[i].link.href === href) {
          const next = runs[i].link.rId;
          if (group.length > 0 && next !== void 0 && rId !== void 0 && next !== rId) break;
          rId = rId ?? next;
          group.push(runs[i]);
          i++;
        }
        for (let j = groupStart; j < i; j++) parts.push(startsAt(j));
        const tooltip = group[0]?.link?.tooltip;
        const tipAttr = tooltip ? ` w:tooltip="${escapeXmlAttr(tooltip)}"` : "";
        if (href.startsWith("#")) {
          const inner = group.map((r) => runFragmentXml(r, true)).join("");
          parts.push(
            `<w:hyperlink w:anchor="${escapeXmlAttr(href.slice(1))}"${tipAttr}>${inner}</w:hyperlink>`
          );
        } else {
          const finalRId = rId ?? allocate?.(href);
          if (finalRId) {
            const inner = group.map((r) => runFragmentXml(r, true)).join("");
            parts.push(
              `<w:hyperlink r:id="${escapeXmlAttr(finalRId)}"${tipAttr}>${inner}</w:hyperlink>`
            );
          } else {
            parts.push(group.map((r) => runFragmentXml(r, false)).join(""));
          }
        }
        for (let j = groupStart; j < i; j++) parts.push(endsAt(j));
      } else {
        parts.push(startsAt(i));
        parts.push(runFragmentXml(run2, false));
        parts.push(endsAt(i));
        i++;
      }
    }
  };
  const revKey = (r) => r.ins || r.del ? JSON.stringify([
    r.ins?.author ?? null,
    r.ins?.date ?? null,
    r.ins?.id ?? null,
    r.del?.author ?? null,
    r.del?.date ?? null,
    r.del?.id ?? null
  ]) : "";
  let revSeq = 9001;
  const revAttrs = (info) => ` w:id="${escapeXmlAttr(info.id ?? String(revSeq++))}" w:author="${escapeXmlAttr(info.author)}"` + (info.date ? ` w:date="${escapeXmlAttr(info.date)}"` : "");
  let g = 0;
  while (g < runs.length) {
    const key = revKey(runs[g]);
    let end = g;
    while (end < runs.length && revKey(runs[end]) === key) end++;
    if (key === "") {
      emitRange(g, end);
    } else {
      const { ins, del } = runs[g];
      if (ins) parts.push(`<w:ins${revAttrs(ins)}>`);
      if (del) parts.push(`<w:del${revAttrs(del)}>`);
      emitRange(g, end);
      if (del) parts.push("</w:del>");
      if (ins) parts.push("</w:ins>");
    }
    g = end;
  }
  return parts.join("");
}
function splitGlyphRuns(run2, isGlyph, glyphXml, plainXml) {
  let out = "";
  let plain = "";
  for (const ch of run2.text) {
    if (isGlyph(ch)) {
      if (plain) out += plainXml(plain);
      plain = "";
      out += glyphXml(ch);
    } else plain += ch;
  }
  if (plain) out += plainXml(plain);
  return out;
}
function runFragmentXml(run2, insideLink) {
  if (run2.math) return run2.math.omml;
  if (run2.ruby) return `<w:r>${run2.ruby.xml}</w:r>`;
  if (run2.image) {
    const text = run2.text === "" ? "" : generateRunXml({ ...run2, image: void 0 }, insideLink);
    return `${text}<w:r>${run2.rawRPr ?? ""}${run2.image.xml}</w:r>`;
  }
  if (run2.sym) {
    return `<w:r>${runRPrXml(run2, insideLink)}<w:sym w:font="${escapeXmlAttr(run2.sym.font)}" w:char="${escapeXmlAttr(run2.sym.char)}"/></w:r>`;
  }
  if (run2.noteRef) {
    const tag2 = run2.noteRef.kind === "footnote" ? "w:footnoteReference" : "w:endnoteReference";
    return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${tag2} w:id="${escapeXmlAttr(run2.noteRef.id)}"/></w:r>`;
  }
  if (run2.refField !== void 0) {
    const name = run2.refField.replace(/"/g, "");
    const instr = run2.refInstr ?? ` REF ${name} \\h `;
    return `<w:r><w:fldChar w:fldCharType="begin"${run2.fldDirty ? ' w:dirty="true"' : ""}/></w:r><w:r><w:instrText xml:space="preserve">${escapeXmlText(instr)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` + generateRunXml({ ...run2, refField: void 0, fldDirty: void 0 }, insideLink) + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  }
  if (run2.sdtCheckboxXml) {
    const glyphs = sdtCheckboxGlyphs(run2.sdtCheckboxXml);
    const inner = (text) => generateRunXml({ ...run2, text, sdtCheckboxXml: void 0 }, insideLink);
    return splitGlyphRuns(
      run2,
      (ch) => ch === glyphs.checked || ch === glyphs.unchecked,
      (ch) => `<w:sdt>${syncSdtCheckbox(run2.sdtCheckboxXml, sdtCheckboxIsChecked(run2.sdtCheckboxXml, ch))}<w:sdtContent>${inner(ch)}</w:sdtContent></w:sdt>`,
      inner
    );
  }
  if (run2.instrField !== void 0) {
    const instrXml = `<w:r><w:instrText xml:space="preserve"> ${escapeXmlText(run2.instrField)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const endXml = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    if (run2.zoteroFieldPart && run2.zoteroFieldPart !== "single") {
      const cachedXml = generateRunXml(
        {
          ...run2,
          instrField: void 0,
          zoteroFieldId: void 0,
          zoteroFieldPart: void 0
        },
        insideLink
      );
      if (run2.zoteroFieldPart === "begin") {
        return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' + instrXml + cachedXml;
      }
      if (run2.zoteroFieldPart === "end") return cachedXml + endXml;
      return cachedXml;
    }
    if (run2.fldBeginXml) {
      const syncedField = (checked) => {
        const val2 = `<w:checked w:val="${checked ? "1" : "0"}"/>`;
        let begin = run2.fldBeginXml.replace(/<w:checked(?:\s[^>]*)?\/>/g, "");
        if (begin.includes("</w:checkBox>"))
          begin = begin.replace("</w:checkBox>", `${val2}</w:checkBox>`);
        else
          begin = begin.replace(/<w:checkBox((?:\s[^>]*)?)\/>/, `<w:checkBox$1>${val2}</w:checkBox>`);
        return begin + instrXml + endXml;
      };
      return splitGlyphRuns(
        run2,
        (ch) => ch === "\u2610" || ch === "\u2612",
        (ch) => syncedField(ch === "\u2612"),
        (plain) => generateRunXml(
          { ...run2, text: plain, instrField: void 0, fldBeginXml: void 0 },
          insideLink
        )
      );
    }
    return `<w:r><w:fldChar w:fldCharType="begin"${run2.fldDirty ? ' w:dirty="true"' : ""}/></w:r>` + instrXml + generateRunXml({ ...run2, instrField: void 0, fldDirty: void 0 }, insideLink) + endXml;
  }
  let xml = run2.text === "" ? "" : generateRunXml(run2, insideLink);
  if (run2.xeTerm !== void 0) {
    const term = run2.xeTerm.replace(/"/g, "");
    xml += `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> XE "${escapeXmlText(term)}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  }
  return xml;
}
var RPR_CHILD_ORDER = [
  "w:rStyle",
  "w:rFonts",
  "w:b",
  "w:bCs",
  "w:i",
  "w:iCs",
  "w:caps",
  "w:smallCaps",
  "w:strike",
  "w:dstrike",
  "w:outline",
  "w:shadow",
  "w:emboss",
  "w:imprint",
  "w:noProof",
  "w:snapToGrid",
  "w:vanish",
  "w:webHidden",
  "w:color",
  "w:spacing",
  "w:w",
  "w:kern",
  "w:position",
  "w:sz",
  "w:szCs",
  "w:highlight",
  "w:u",
  "w:effect",
  "w:bdr",
  "w:shd",
  "w:fitText",
  "w:vertAlign",
  "w:rtl",
  "w:cs",
  "w:em",
  "w:lang",
  "w:eastAsianLayout",
  "w:specVanish",
  "w:oMath",
  "w:rPrChange"
];
var RUN_MANAGED_GROUPS = [
  { key: "rStyle", tags: ["w:rStyle"] },
  { key: "rFonts", tags: ["w:rFonts"] },
  { key: "bold", tags: ["w:b", "w:bCs"] },
  { key: "italic", tags: ["w:i", "w:iCs"] },
  { key: "strike", tags: ["w:strike"] },
  { key: "caps", tags: ["w:caps", "w:smallCaps"] },
  { key: "dstrike", tags: ["w:dstrike"] },
  { key: "vanish", tags: ["w:vanish"] },
  { key: "color", tags: ["w:color"] },
  { key: "spacing", tags: ["w:spacing"] },
  { key: "scale", tags: ["w:w"] },
  { key: "kern", tags: ["w:kern"] },
  { key: "position", tags: ["w:position"] },
  { key: "size", tags: ["w:sz", "w:szCs"] },
  { key: "highlight", tags: ["w:highlight"] },
  { key: "underline", tags: ["w:u"] },
  { key: "shading", tags: ["w:shd"] },
  { key: "vertAlign", tags: ["w:vertAlign"] },
  { key: "rtl", tags: ["w:rtl"] },
  { key: "rPrChange", tags: ["w:rPrChange"] }
];
var rawAttr = (xml, attr) => xml ? new RegExp(` ${attr}="([^"]*)"`).exec(xml)?.[1] : void 0;
function rawBool(xml) {
  return rawOnOff(xml) === true;
}
function rawOnOff(xml) {
  if (!xml) return void 0;
  const val2 = rawAttr(xml, "w:val");
  if (val2 === void 0) return true;
  return !["0", "false", "none", "off"].includes(val2.toLowerCase());
}
var rawInt = (xml) => {
  const v = rawAttr(xml, "w:val");
  if (v === void 0) return void 0;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? void 0 : n;
};
function rawCaps(caps, smallCaps) {
  const c = rawOnOff(caps);
  const sc = rawOnOff(smallCaps);
  if (c) return "all";
  if (sc) return "small";
  if (c === false || sc === false) return "none";
  return void 0;
}
var onOffXml = (tag2, on) => on ? `<${tag2}/>` : `<${tag2} w:val="0"/>`;
function freshRFontsXml(font, fontAscii, fontCs, eastAsiaFont) {
  const legacy = font && fontAscii === void 0 && eastAsiaFont === void 0 ? font : void 0;
  const ascii = fontAscii ?? legacy;
  const ea = eastAsiaFont ?? (fontAscii !== void 0 && font === fontAscii ? void 0 : font);
  const cs = fontCs ?? legacy;
  return `<w:rFonts${ascii ? ` w:ascii="${escapeXmlAttr(ascii)}"` : ""}${ea ? ` w:eastAsia="${escapeXmlAttr(ea)}"` : ""}${ascii ? ` w:hAnsi="${escapeXmlAttr(ascii)}"` : ""}${cs ? ` w:cs="${escapeXmlAttr(cs)}"` : ""}/>`;
}
function mergeRFontsXml(rawXml, run2) {
  const attrs = /* @__PURE__ */ new Map();
  for (const m of rawXml.matchAll(/ ([\w:]+)="([^"]*)"/g)) attrs.set(m[1], m[2]);
  const rawPrimary = attrs.get("w:eastAsia") ?? attrs.get("w:ascii") ?? attrs.get("w:hAnsi");
  const hadEastAsia = attrs.has("w:eastAsia") || attrs.has("w:eastAsiaTheme");
  const set = (slot2, theme, value) => {
    attrs.set(slot2, escapeXmlAttr(value));
    attrs.delete(theme);
  };
  if (run2.fontAscii && run2.fontAscii !== run2.themeRFonts?.fontAscii) {
    set("w:ascii", "w:asciiTheme", run2.fontAscii);
    set("w:hAnsi", "w:hAnsiTheme", run2.fontAscii);
  }
  if (run2.font && run2.font !== run2.themeRFonts?.font && (hadEastAsia || run2.font !== rawPrimary || run2.eastAsiaFont !== void 0)) {
    set("w:eastAsia", "w:eastAsiaTheme", run2.font);
  }
  if (run2.fontCs) set("w:cs", "w:cstheme", run2.fontCs);
  return `<w:rFonts${[...attrs].map(([k, v]) => ` ${k}="${v}"`).join("")}/>`;
}
function revisionRPrChangeXml(run2) {
  const change = run2.rPrChange;
  if (!change) return null;
  const old = change.old ?? {};
  const props = [];
  if (old.styleId) props.push(`<w:rStyle w:val="${escapeXmlAttr(old.styleId)}"/>`);
  if (old.font || old.fontAscii) props.push(freshRFontsXml(old.font, old.fontAscii));
  if (old.bold) props.push("<w:b/>");
  if (old.italic) props.push("<w:i/>");
  if (old.strike) props.push("<w:strike/>");
  if (old.color) props.push(`<w:color w:val="${escapeXmlAttr(old.color)}"/>`);
  if (old.charSpacingTwips) props.push(`<w:spacing w:val="${old.charSpacingTwips}"/>`);
  if (old.charScalePct) props.push(`<w:w w:val="${old.charScalePct}"/>`);
  if (old.sizeHalfPoints) {
    props.push(`<w:sz w:val="${old.sizeHalfPoints}"/>`);
    props.push(`<w:szCs w:val="${old.sizeHalfPoints}"/>`);
  }
  if (old.highlight) props.push(`<w:highlight w:val="${escapeXmlAttr(old.highlight)}"/>`);
  if (old.underline) props.push('<w:u w:val="single"/>');
  if (old.vertAlign) props.push(`<w:vertAlign w:val="${old.vertAlign}"/>`);
  const attrs = ` w:id="${escapeXmlAttr(change.id ?? "0")}" w:author="${escapeXmlAttr(change.author)}"` + (change.date ? ` w:date="${escapeXmlAttr(change.date)}"` : "");
  return `<w:rPrChange${attrs}><w:rPr>${props.join("")}</w:rPr></w:rPrChange>`;
}
function modelRPrChildren(run2, insideLink) {
  const out = [];
  const styleId = run2.styleId ?? (insideLink && !run2.link?.plain ? "Hyperlink" : void 0);
  if (styleId) out.push({ name: "w:rStyle", xml: `<w:rStyle w:val="${escapeXmlAttr(styleId)}"/>` });
  if (run2.font || run2.fontAscii || run2.fontCs) {
    out.push({
      name: "w:rFonts",
      xml: freshRFontsXml(run2.font, run2.fontAscii, run2.fontCs, run2.eastAsiaFont)
    });
  }
  if (run2.bold) {
    out.push({ name: "w:b", xml: "<w:b/>" }, { name: "w:bCs", xml: "<w:bCs/>" });
  }
  if (run2.italic) {
    out.push({ name: "w:i", xml: "<w:i/>" }, { name: "w:iCs", xml: "<w:iCs/>" });
  }
  if (run2.strike) out.push({ name: "w:strike", xml: "<w:strike/>" });
  if (run2.caps === "all") out.push({ name: "w:caps", xml: "<w:caps/>" });
  else if (run2.caps === "small") out.push({ name: "w:smallCaps", xml: "<w:smallCaps/>" });
  else if (run2.caps === "none") {
    out.push(
      { name: "w:caps", xml: onOffXml("w:caps", false) },
      { name: "w:smallCaps", xml: onOffXml("w:smallCaps", false) }
    );
  }
  if (run2.dstrike !== void 0)
    out.push({ name: "w:dstrike", xml: onOffXml("w:dstrike", run2.dstrike) });
  if (run2.vanishOwn !== void 0)
    out.push({ name: "w:vanish", xml: onOffXml("w:vanish", run2.vanishOwn) });
  if (run2.color)
    out.push({ name: "w:color", xml: `<w:color w:val="${escapeXmlAttr(run2.color)}"/>` });
  if (run2.charSpacingTwips !== void 0)
    out.push({ name: "w:spacing", xml: `<w:spacing w:val="${run2.charSpacingTwips}"/>` });
  if (run2.charScalePct) out.push({ name: "w:w", xml: `<w:w w:val="${run2.charScalePct}"/>` });
  if (run2.kernHalfPoints !== void 0)
    out.push({ name: "w:kern", xml: `<w:kern w:val="${run2.kernHalfPoints}"/>` });
  if (run2.positionHalfPoints)
    out.push({ name: "w:position", xml: `<w:position w:val="${run2.positionHalfPoints}"/>` });
  if (run2.sizeHalfPoints) {
    out.push({ name: "w:sz", xml: `<w:sz w:val="${run2.sizeHalfPoints}"/>` });
    out.push({ name: "w:szCs", xml: `<w:szCs w:val="${run2.sizeHalfPoints}"/>` });
  }
  if (run2.highlight)
    out.push({ name: "w:highlight", xml: `<w:highlight w:val="${escapeXmlAttr(run2.highlight)}"/>` });
  if (run2.underline) out.push({ name: "w:u", xml: '<w:u w:val="single"/>' });
  if (run2.shading) {
    out.push({
      name: "w:shd",
      xml: `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXmlAttr(run2.shading)}"/>`
    });
  }
  if (run2.vertAlign)
    out.push({ name: "w:vertAlign", xml: `<w:vertAlign w:val="${run2.vertAlign}"/>` });
  if (run2.rtl) out.push({ name: "w:rtl", xml: "<w:rtl/>" });
  const rPrChange = revisionRPrChangeXml(run2);
  if (rPrChange) out.push({ name: "w:rPrChange", xml: rPrChange });
  return out;
}
function mergeRPrModel(rawRPr, run2, insideLink) {
  const open = /^<w:rPr(?: [^>]*)?>/.exec(rawRPr)?.[0];
  const fresh = modelRPrChildren(run2, insideLink);
  if (!open) {
    return fresh.length > 0 ? `<w:rPr>${fresh.map((c) => c.xml).join("")}</w:rPr>` : "";
  }
  const inner = rawRPr.slice(open.length, rawRPr.length - "</w:rPr>".length);
  const rawChildren = splitXmlChildren(inner);
  const rawOf = (tag2) => rawChildren.find((c) => c.name === tag2)?.xml;
  const cs = !!run2.cs || rawBool(rawOf("w:rtl"));
  const rebuiltTags = /* @__PURE__ */ new Set();
  const freshByGroup = /* @__PURE__ */ new Map();
  for (const g of RUN_MANAGED_GROUPS) freshByGroup.set(g.key, []);
  for (const f of fresh) {
    const g = RUN_MANAGED_GROUPS.find((grp) => grp.tags.includes(f.name));
    freshByGroup.get(g.key).push(f);
  }
  const groupEqual = (key) => {
    switch (key) {
      case "rStyle": {
        const raw = rawAttr(rawOf("w:rStyle"), "w:val");
        if (run2.styleId) return raw === run2.styleId;
        return raw === void 0 ? !insideLink || !!run2.link?.rId || !!run2.link?.plain : raw === "Hyperlink";
      }
      case "rFonts": {
        const attrs = rawOf("w:rFonts");
        const ascii = rawAttr(attrs, "w:ascii") ?? rawAttr(attrs, "w:hAnsi");
        return ((rawAttr(attrs, "w:eastAsia") ?? ascii) === run2.font || run2.font !== void 0 && run2.font === run2.themeRFonts?.font) && (ascii === run2.fontAscii || run2.fontAscii !== void 0 && run2.fontAscii === run2.themeRFonts?.fontAscii) && (run2.eastAsiaFont === void 0 || rawAttr(attrs, "w:eastAsia") === run2.eastAsiaFont || run2.eastAsiaFont === run2.themeRFonts?.font) && (run2.fontCs === void 0 || rawAttr(attrs, "w:cs") === run2.fontCs);
      }
      case "bold":
        return rawBool(rawOf(cs ? "w:bCs" : "w:b")) === !!run2.bold;
      case "italic":
        return rawBool(rawOf(cs ? "w:iCs" : "w:i")) === !!run2.italic;
      case "strike":
        return rawBool(rawOf("w:strike")) === !!run2.strike;
      case "caps":
        return rawCaps(rawOf("w:caps"), rawOf("w:smallCaps")) === run2.caps;
      case "dstrike":
        return rawBool(rawOf("w:dstrike")) === !!run2.dstrike;
      // `vanish` may be style-inherited; only the run's own value is compared
      case "vanish":
        return run2.vanishOwn === void 0 || rawOnOff(rawOf("w:vanish")) === run2.vanishOwn;
      case "spacing":
        return rawInt(rawOf("w:spacing")) === run2.charSpacingTwips;
      case "scale": {
        const raw = rawInt(rawOf("w:w"));
        return (raw && raw !== 100 ? raw : void 0) === run2.charScalePct;
      }
      case "kern": {
        const raw = rawAttr(rawOf("w:kern"), "w:val");
        return (raw === void 0 ? void 0 : parseInt(raw, 10) || 0) === run2.kernHalfPoints;
      }
      case "position":
        return (rawInt(rawOf("w:position")) || void 0) === run2.positionHalfPoints;
      case "color": {
        const raw = rawAttr(rawOf("w:color"), "w:val");
        return raw === run2.color || run2.themeColor !== void 0 && run2.color === run2.themeColor;
      }
      case "size": {
        const raw = rawAttr(rawOf(cs ? "w:szCs" : "w:sz"), "w:val");
        return (raw ? parseInt(raw, 10) || void 0 : void 0) === run2.sizeHalfPoints;
      }
      case "highlight": {
        const raw = rawAttr(rawOf("w:highlight"), "w:val");
        return (raw === "none" ? void 0 : raw) === run2.highlight;
      }
      case "shading": {
        const raw = rawAttr(rawOf("w:shd"), "w:fill");
        return (raw && raw !== "auto" ? raw : void 0) === run2.shading;
      }
      case "underline": {
        const val2 = rawAttr(rawOf("w:u"), "w:val");
        return (val2 !== void 0 && val2 !== "none") === !!run2.underline;
      }
      case "vertAlign": {
        const raw = rawAttr(rawOf("w:vertAlign"), "w:val");
        const modeled = raw === "superscript" || raw === "subscript" ? raw : void 0;
        return modeled === run2.vertAlign;
      }
      case "rtl":
        return rawBool(rawOf("w:rtl")) === !!run2.rtl;
      case "rPrChange":
        return !!rawOf("w:rPrChange") === !!run2.rPrChange;
      default:
        return true;
    }
  };
  const freshOut = [];
  for (const g of RUN_MANAGED_GROUPS) {
    if (groupEqual(g.key)) continue;
    for (const t of g.tags) rebuiltTags.add(t);
    const rawRFonts = g.key === "rFonts" ? rawOf("w:rFonts") : void 0;
    if (rawRFonts && (run2.font || run2.fontAscii)) {
      freshOut.push({ name: "w:rFonts", xml: mergeRFontsXml(rawRFonts, run2) });
    } else {
      freshOut.push(...freshByGroup.get(g.key));
    }
  }
  const kept = rawChildren.filter((c) => !rebuiltTags.has(c.name));
  const rank = (n) => RPR_CHILD_ORDER.indexOf(n);
  const parts = [];
  let fi = 0;
  let prevRank = -1;
  for (const child of kept) {
    const own = rank(child.name);
    const effective = own === -1 ? prevRank : Math.max(own, prevRank);
    while (fi < freshOut.length && rank(freshOut[fi].name) < effective)
      parts.push(freshOut[fi++].xml);
    parts.push(child.xml);
    prevRank = effective;
  }
  while (fi < freshOut.length) parts.push(freshOut[fi++].xml);
  if (parts.length === 0) return "";
  return `${open}${parts.join("")}</w:rPr>`;
}
function runRPrXml(run2, insideLink) {
  if (run2.rawRPr !== void 0) return mergeRPrModel(run2.rawRPr, run2, insideLink);
  const props = modelRPrChildren(run2, insideLink).map((c) => c.xml);
  return props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
}
function generateRunXml(run2, insideLink) {
  const rPr = runRPrXml(run2, insideLink);
  const textTag = run2.del ? "w:delText" : "w:t";
  const segments = [];
  let buffer = "";
  const flush = () => {
    if (buffer !== "") {
      segments.push(`<${textTag} xml:space="preserve">${escapeXmlText(buffer)}</${textTag}>`);
      buffer = "";
    }
  };
  for (const ch of run2.text) {
    if (ch === "	") {
      flush();
      segments.push("<w:tab/>");
    } else if (ch === "\n") {
      flush();
      segments.push("<w:br/>");
    } else if (ch === "\f") {
      flush();
      segments.push('<w:br w:type="page"/>');
    } else if (ch === "\v") {
      flush();
      segments.push('<w:br w:type="column"/>');
    } else if (ch === "") {
      flush();
      segments.push('<w:br w:type="textWrapping" w:clear="all"/>');
    } else if (ch === "\u2011") {
      flush();
      segments.push("<w:noBreakHyphen/>");
    } else if (ch === "\xAD") {
      flush();
      segments.push("<w:softHyphen/>");
    } else {
      buffer += ch;
    }
  }
  flush();
  return `<w:r>${rPr}${segments.join("")}</w:r>`;
}

// vendor/genoffice/docx/theme.ts
var THEME_PART_PATH = "word/theme/theme1.xml";
var THEME_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
var THEME_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.theme+xml";
function readThemeFonts(themeXml) {
  const major = fontOf(themeXml, "a:majorFont");
  const minor = fontOf(themeXml, "a:minorFont");
  if (!major && !minor) return null;
  const slot2 = (tag2, kind) => sectionOf(themeXml, tag2)?.match(new RegExp(`<${kind} typeface="([^"]*)"`))?.[1] || void 0;
  const eastAsia = slot2("a:minorFont", "a:ea");
  const majorEastAsia = slot2("a:majorFont", "a:ea");
  const minorCs = slot2("a:minorFont", "a:cs");
  const majorCs = slot2("a:majorFont", "a:cs");
  const majorScripts = scriptFontsOf(themeXml, "a:majorFont");
  const minorScripts = scriptFontsOf(themeXml, "a:minorFont");
  return {
    major: major ?? "",
    minor: minor ?? "",
    ...eastAsia ? { eastAsia } : {},
    ...majorEastAsia ? { majorEastAsia } : {},
    ...minorCs ? { minorCs } : {},
    ...majorCs ? { majorCs } : {},
    ...majorScripts ? { majorScripts } : {},
    ...minorScripts ? { minorScripts } : {}
  };
}
function scriptFontsOf(themeXml, tag2) {
  const section = sectionOf(themeXml, tag2);
  if (!section) return void 0;
  const out = {};
  for (const m of section.matchAll(/<a:font script="([^"]+)" typeface="([^"]+)"/g)) {
    out[m[1]] = m[2];
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
function sectionOf(xml, tag2) {
  return new RegExp(`<${tag2}(?:\\s[^>]*)?>[\\s\\S]*?</${tag2}>`).exec(xml)?.[0] ?? null;
}
function fontOf(xml, tag2) {
  const section = sectionOf(xml, tag2);
  return section ? /<a:latin typeface="([^"]*)"/.exec(section)?.[1] ?? null : null;
}
function applyFontGroup(xml, tag2, typeface, eastAsia) {
  const section = sectionOf(xml, tag2);
  if (!section) return xml;
  let next = section.replace(/(<a:latin typeface=")[^"]*(")/, `$1${escapeXmlAttr(typeface)}$2`);
  if (eastAsia !== void 0) {
    next = next.replace(/(<a:ea typeface=")[^"]*(")/, `$1${escapeXmlAttr(eastAsia)}$2`);
  }
  return xml.replace(section, next);
}
function applyThemeFonts(themeXml, fonts) {
  let xml = applyFontGroup(themeXml, "a:majorFont", fonts.major, fonts.eastAsia);
  xml = applyFontGroup(xml, "a:minorFont", fonts.minor, fonts.eastAsia);
  return xml;
}
var COLOR_TAGS = [
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6"
];
var READ_TAGS = ["dk1", "lt1", ...COLOR_TAGS, "hlink", "folHlink"];
function readThemeColors(themeXml) {
  const scheme = sectionOf(themeXml, "a:clrScheme");
  if (!scheme) return null;
  const out = {};
  const name = /<a:clrScheme name="([^"]*)"/.exec(themeXml)?.[1];
  if (name) out.name = name;
  for (const tag2 of READ_TAGS) {
    const m = new RegExp(
      `<a:${tag2}>\\s*<a:(?:srgbClr val|sysClr[^>]*? lastClr)="([0-9A-Fa-f]{6})"`
    ).exec(scheme);
    if (m) out[tag2] = m[1].toUpperCase();
  }
  return Object.keys(out).length > 0 ? out : null;
}
var THEME_COLOR_SLOTS = {
  dark1: "dk1",
  text1: "dk1",
  light1: "lt1",
  background1: "lt1",
  dark2: "dk2",
  text2: "dk2",
  light2: "lt2",
  background2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hyperlink: "hlink",
  followedHyperlink: "folHlink"
};
var SLOT_FALLBACK = { dk1: "000000", lt1: "FFFFFF" };
var DEFAULT_THEME_COLORS = {
  dk1: "000000",
  lt1: "FFFFFF",
  dk2: "44546A",
  lt2: "E7E6E6",
  accent1: "4472C4",
  accent2: "ED7D31",
  accent3: "A5A5A5",
  accent4: "FFC000",
  accent5: "5B9BD5",
  accent6: "70AD47",
  hlink: "0563C1",
  folHlink: "954F72"
};
function resolveThemeColor(themeColor, colors, tint, shade) {
  const slot2 = THEME_COLOR_SLOTS[themeColor];
  if (!slot2) return null;
  const base = colors[slot2] ?? SLOT_FALLBACK[slot2];
  if (!base || !/^[0-9A-Fa-f]{6}$/.test(base)) return null;
  const factorOf = (hex) => {
    const v = hex ? parseInt(hex, 16) : NaN;
    return Number.isFinite(v) ? Math.max(0, Math.min(255, v)) / 255 : null;
  };
  const s = factorOf(shade);
  const t = factorOf(tint);
  if (s === null && t === null) return base.toUpperCase();
  const [h, sat, l0] = rgbToHsl([0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16) / 255));
  let l = l0;
  if (s !== null) l *= s;
  if (t !== null) l = l * t + (1 - t);
  return hslToRgb(h, sat, l).map(
    (c) => Math.round(c * 255).toString(16).padStart(2, "0").toUpperCase()
  ).join("");
}
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0) => {
    const t = (t0 % 1 + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}
function applyThemeColors(themeXml, colors) {
  let scheme = sectionOf(themeXml, "a:clrScheme");
  if (!scheme) return themeXml;
  const original = scheme;
  for (const tag2 of COLOR_TAGS) {
    const value = colors[tag2];
    if (!value) continue;
    scheme = scheme.replace(
      new RegExp(`(<a:${tag2}>\\s*<a:srgbClr val=")[0-9A-Fa-f]{6}(")`),
      `$1${value}$2`
    );
  }
  let xml = themeXml.replace(original, scheme);
  if (colors.name) {
    xml = xml.replace(/(<a:clrScheme name=")[^"]*(")/, `$1${escapeXmlAttr(colors.name)}$2`);
  }
  return xml;
}
function buildThemeXml(fonts, colors) {
  const c = (tag2) => `<a:${tag2}><a:srgbClr val="${colors[tag2] ?? DEFAULT_THEME_COLORS[tag2]}"/></a:${tag2}>`;
  const font = (tag2, typeface) => `<${tag2}><a:latin typeface="${escapeXmlAttr(typeface)}"/><a:ea typeface="${escapeXmlAttr(fonts.eastAsia ?? "")}"/><a:cs typeface=""/></${tag2}>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="${escapeXmlAttr(colors.name ?? "Office")}"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` + c("dk2") + c("lt2") + c("accent1") + c("accent2") + c("accent3") + c("accent4") + c("accent5") + c("accent6") + `<a:hlink><a:srgbClr val="${DEFAULT_THEME_COLORS.hlink}"/></a:hlink><a:folHlink><a:srgbClr val="${DEFAULT_THEME_COLORS.folHlink}"/></a:folHlink></a:clrScheme><a:fontScheme name="Office">${font("a:majorFont", fonts.major)}${font("a:minorFont", fonts.minor)}</a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

// vendor/genoffice/docx/parse-xml-text.ts
function stripHash(v) {
  return v.startsWith("#") ? v.slice(1) : v;
}
function lineTwipsOf(v) {
  return v !== void 0 && /^-?\d+(?:\.\d*)?$/.test(v) ? parseInt(v, 10) : NaN;
}
function colorFrom(container, theme) {
  if (!container) return void 0;
  const a = attrsOf(findChild(container, "w:color") ?? {});
  if (a["w:themeColor"] && theme) {
    const resolved = resolveThemeColor(
      a["w:themeColor"],
      theme,
      a["w:themeTint"],
      a["w:themeShade"]
    );
    if (resolved) return resolved;
  }
  const val2 = a["w:val"];
  return val2 && val2 !== "auto" ? stripHash(val2) : void 0;
}
function autoColorOf(container) {
  if (!container) return void 0;
  return attrsOf(findChild(container, "w:color") ?? {})["w:val"] === "auto" ? "auto" : void 0;
}
function onOffOf(parent, name) {
  const child = findChild(parent, name);
  if (!child) return void 0;
  const val2 = attrsOf(child)["w:val"];
  if (val2 === void 0) return true;
  return !["0", "false", "none", "off"].includes(val2.toLowerCase());
}
function onOffTagIn(xml, name) {
  const tag2 = new RegExp(`<${name}(?=[\\s/>])[^>]*>`, "i").exec(xml)?.[0];
  if (tag2 === void 0) return void 0;
  const val2 = /\bw:val=(?:"([^"]*)"|'([^']*)')/i.exec(tag2);
  const raw = val2?.[1] ?? val2?.[2];
  if (raw === void 0) return true;
  return !["0", "false", "none", "off"].includes(raw.toLowerCase());
}
function plainText(xml) {
  const texts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:tc>/g;
  let m;
  let pendingGap = false;
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === "</w:tc>") {
      pendingGap = texts.length > 0;
      continue;
    }
    if (pendingGap) {
      texts.push(" ");
      pendingGap = false;
    }
    texts.push(m[1]);
  }
  return decodeEntities(texts.join(""));
}
function mathTokens(xml) {
  const tokens = [];
  const re = /<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) tokens.push(decodeEntities(m[1]));
  return tokens;
}
function decodeNumericCharRefs(text) {
  return text.replace(
    /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
    (entity, hex, decimal) => {
      const codePoint = parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 1114111 && !(codePoint >= 55296 && codePoint <= 57343) ? String.fromCodePoint(codePoint) : entity;
    }
  );
}
function decodeEntities(text) {
  return decodeNumericCharRefs(text).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
var EMU_PER_PX2 = 9525;
var EMU_PER_PT = 12700;

// vendor/genoffice/docx/text-patch.ts
function patchParagraphTexts(entryXml, newText, opts = {}) {
  const paras = paragraphSlices(entryXml);
  if (paras.length === 0) return null;
  const oldParaTexts = paras.map(
    (p, i) => i === 0 && opts.stripFirstParaLeadingSpace ? decodedTextOf(p.xml).replace(/^\s+/, "") : decodedTextOf(p.xml)
  );
  if (oldParaTexts.join("\n") === newText) return entryXml;
  const newParaTexts = newText.split("\n");
  if (newParaTexts.length !== paras.length) return null;
  let out = "";
  let cursor = 0;
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    out += entryXml.slice(cursor, para.start);
    if (oldParaTexts[i] === newParaTexts[i]) {
      out += para.xml;
    } else {
      const skipLeading = i === 0 && opts.stripFirstParaLeadingSpace === true;
      const patched = patchOneParagraph(para.xml, newParaTexts[i], skipLeading);
      if (patched === null) return null;
      out += patched;
    }
    cursor = para.end;
  }
  out += entryXml.slice(cursor);
  const check = paragraphSlices(out).map(
    (p, i) => i === 0 && opts.stripFirstParaLeadingSpace ? decodedTextOf(p.xml).replace(/^\s+/, "") : decodedTextOf(p.xml)
  );
  return check.join("\n") === newText ? out : null;
}
function paragraphSlices(xml) {
  const out = [];
  const re = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>|<\/w:p>/g;
  let m;
  let depth = 0;
  let start = -1;
  while ((m = re.exec(xml)) !== null) {
    const token = m[0];
    if (token === "</w:p>") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        const end = m.index + token.length;
        out.push({ start, end, xml: xml.slice(start, end) });
        start = -1;
      }
    } else if (token.endsWith("/>")) {
      if (depth === 0) out.push({ start: m.index, end: m.index + token.length, xml: token });
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}
function tSlices(paraXml) {
  const out = [];
  const re = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(paraXml)) !== null) {
    const inner = m[2];
    const innerStart = m.index + m[0].length - inner.length - "</w:t>".length;
    out.push({
      tagStart: m.index,
      innerStart,
      innerEnd: innerStart + inner.length,
      text: decodeEntities(inner)
    });
  }
  return out;
}
function decodedTextOf(paraXml) {
  return tSlices(paraXml).map((t) => t.text).join("");
}
function patchOneParagraph(paraXml, newText, skipLeading) {
  const slices = tSlices(paraXml);
  if (slices.length === 0) return null;
  const raw = slices.map((t) => t.text).join("");
  const lead = skipLeading ? raw.length - raw.replace(/^\s+/, "").length : 0;
  const oldText = raw.slice(lead);
  if (oldText === newText) return paraXml;
  let prefix = 0;
  const maxCommon = Math.min(oldText.length, newText.length);
  while (prefix < maxCommon && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < maxCommon - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) {
    suffix++;
  }
  const changeStart = lead + prefix;
  const changeEnd = lead + oldText.length - suffix;
  const replacement = newText.slice(prefix, newText.length - suffix);
  let acc = 0;
  let first = -1;
  let last = -1;
  const bounds = [];
  for (let i = 0; i < slices.length; i++) {
    const start = acc;
    const end = acc + slices[i].text.length;
    bounds.push({ start, end });
    const touches = changeStart === changeEnd ? start <= changeStart && changeStart <= end : start < changeEnd && end > changeStart;
    if (touches) {
      if (first === -1) first = i;
      last = i;
    }
    acc = end;
  }
  if (first === -1) {
    return null;
  }
  const newInner = [];
  for (let i = first; i <= last; i++) {
    if (i === first) {
      const head = slices[i].text.slice(0, changeStart - bounds[i].start);
      const tail = slices[last].text.slice(changeEnd - bounds[last].start);
      newInner.push(escapeXmlText(head + replacement + tail));
    } else {
      newInner.push("");
    }
  }
  let out = paraXml;
  for (let i = last; i >= first; i--) {
    const s = slices[i];
    const closeEnd = s.innerEnd + "</w:t>".length;
    out = out.slice(0, s.tagStart) + `<w:t xml:space="preserve">${newInner[i - first]}</w:t>` + out.slice(closeEnd);
  }
  return out;
}

// vendor/genoffice/docx/notes.ts
var ROOT = { footnote: "w:footnotes", endnote: "w:endnotes" };
var ENTRY = { footnote: "w:footnote", endnote: "w:endnote" };
var NOTE_PART_PATH = {
  footnote: "word/footnotes.xml",
  endnote: "word/endnotes.xml"
};
var NOTE_REL_TYPE = {
  footnote: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  endnote: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes"
};
var NOTE_CONTENT_TYPE = {
  footnote: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
  endnote: "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"
};
var NOTE_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function rootAttributes(originalXml, rootTag, fallback, required = {}) {
  const attrs = originalXml ? new RegExp(`<${rootTag}\\b([^>]*?)/?>`).exec(originalXml)?.[1]?.trim() : void 0;
  const base = attrs && attrs.includes("xmlns:") ? attrs : fallback;
  const missing = Object.entries(required).filter(([prefix]) => !base.includes(`xmlns:${prefix}=`)).map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join("");
  return base + missing;
}
var NOTE_REF_MARK_RE = /<w:(?:footnote|endnote)Ref\b\s*\/?>/;
function parseNotesXml(xml, kind) {
  return noteEntriesOf(xml, kind).map(({ id, text, xml: entryXml }) => {
    const richParas = noteRichParas(entryXml);
    const hasFormat = richParas.some(
      (paras) => paras.some(
        (r) => r.bold || r.italic || r.underline || r.strike || r.color || r.sizeHalfPoints || r.caps || r.fontAscii || r.textOutline
      )
    );
    const styleId = /<w:pStyle w:val="([^"]+)"/.exec(entryXml)?.[1];
    const spacing = noteDirectSpacing(entryXml);
    const noRefMark = !NOTE_REF_MARK_RE.test(entryXml);
    return {
      id,
      text,
      ...hasFormat ? { richParas } : {},
      ...styleId ? { styleId } : {},
      .../ADDIN\s+(?:ZOTERO_|CSL_)/.test(entryXml) ? { zoteroField: true } : {},
      ...spacing ? { spacing } : {},
      ...noRefMark ? { noRefMark: true } : {}
    };
  });
}
function noteDirectSpacing(entryXml) {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(entryXml)?.[0];
  const sp = pPr && /<w:spacing [^>]*\/>/.exec(pPr)?.[0];
  if (!sp) return void 0;
  const num2 = (attr) => {
    const v = new RegExp(`w:${attr}="(-?\\d+)"`).exec(sp)?.[1];
    return v === void 0 ? void 0 : parseInt(v, 10);
  };
  const rule = /w:lineRule="(auto|atLeast|exact)"/.exec(sp)?.[1];
  const before = num2("before");
  const after = num2("after");
  const line = num2("line");
  if (before === void 0 && after === void 0 && line === void 0) return void 0;
  return {
    ...before !== void 0 ? { beforeTwips: before } : {},
    ...after !== void 0 ? { afterTwips: after } : {},
    ...line !== void 0 ? { lineRawTwips: line, lineRule: rule ?? "auto" } : {}
  };
}
function noteRichParas(entryXml) {
  const out = [];
  const pRe = /<w:p(?:\s[^>]*)?\/>|<w:p[\s>][\s\S]*?<\/w:p>/g;
  let p;
  const flag = (rPr, tag2) => onOffTagIn(rPr, `w:${tag2}`) === true;
  while ((p = pRe.exec(entryXml)) !== null) {
    const runs = [];
    const rRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
    let r;
    while ((r = rRe.exec(p[0])) !== null) {
      const inner = r[1];
      if (NOTE_REF_MARK_RE.test(inner)) continue;
      const text = notePlainText(inner);
      if (!text) continue;
      const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)?.[0] ?? "";
      const run2 = { text };
      if (flag(rPr, "b")) run2.bold = true;
      if (flag(rPr, "i")) run2.italic = true;
      const uVal = /<w:u\s[^>]*w:val="([^"]*)"/.exec(rPr)?.[1];
      if (uVal && uVal !== "none") run2.underline = true;
      if (flag(rPr, "strike")) run2.strike = true;
      const color = /<w:color [^>]*w:val="([0-9A-Fa-f]{6})"/.exec(rPr)?.[1];
      if (color) run2.color = color.toUpperCase();
      const sz = /<w:sz [^>]*w:val="(\d+)"/.exec(rPr)?.[1];
      if (sz) run2.sizeHalfPoints = parseInt(sz, 10);
      const rFonts = /<w:rFonts\b[^>]*>/.exec(rPr)?.[0];
      const fontAscii = rFonts && (/\bw:ascii="([^"]+)"/.exec(rFonts) ?? /\bw:hAnsi="([^"]+)"/.exec(rFonts))?.[1];
      if (fontAscii) run2.fontAscii = fontAscii;
      if (flag(rPr, "caps")) run2.caps = "all";
      else if (flag(rPr, "smallCaps")) run2.caps = "small";
      const outline = noteTextOutline(rPr);
      if (outline) run2.textOutline = outline;
      runs.push(run2);
    }
    out.push(runs);
  }
  if (out[0]?.[0]) {
    out[0][0].text = out[0][0].text.replace(/^\s+/, "");
    if (out[0][0].text === "") out[0].shift();
  }
  return out;
}
function noteTextOutline(rPr) {
  const m = /<w14:textOutline\b([^>]*)>([\s\S]*?)<\/w14:textOutline>/.exec(rPr);
  if (!m) return void 0;
  const widthEmu = parseInt(/\bw14:w="(\d+)"/.exec(m[1])?.[1] ?? "", 10);
  const solid = /<w14:solidFill>([\s\S]*?)<\/w14:solidFill>/.exec(m[2])?.[1];
  const color = solid && /<w14:srgbClr w14:val="([0-9A-Fa-f]{6})"/.exec(solid)?.[1];
  if (!(widthEmu > 0) || !color) return void 0;
  const alphaRaw = parseInt(/<w14:alpha w14:val="(\d+)"/.exec(solid)?.[1] ?? "", 10);
  return {
    color: color.toUpperCase(),
    widthPt: Math.round(widthEmu / 12700 * 100) / 100,
    ...alphaRaw >= 0 && alphaRaw < 1e5 ? { alpha: alphaRaw / 1e5 } : {}
  };
}
function noteEntriesOf(xml, kind) {
  const out = [];
  const entry = ENTRY[kind];
  const re = new RegExp(`<${entry}(\\s[^>]*[^/>])?>([\\s\\S]*?)</${entry}>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    if (/w:type=(?:"[^"]*"|'[^']*')/.test(attrs)) continue;
    const id = /w:id=(?:"([^"]+)"|'([^']+)')/.exec(attrs)?.slice(1, 3).find(Boolean);
    if (!id) continue;
    const paras = [];
    const pRe = /<w:p(?:\s[^>]*)?\/>|<w:p[\s>][\s\S]*?<\/w:p>/g;
    let p;
    while ((p = pRe.exec(m[2])) !== null) paras.push(notePlainText(p[0]));
    if (paras.length > 0) paras[0] = paras[0].replace(/^\s+/, "");
    out.push({ id, text: paras.join("\n"), xml: m[0] });
  }
  return out;
}
function notePlainText(xml) {
  const texts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) texts.push(m[1]);
  return decodeEntities(texts.join(""));
}
function separatorEntries(kind) {
  const entry = ENTRY[kind];
  return `<${entry} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></${entry}><${entry} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></${entry}>`;
}
function noteRunXml(run2) {
  const props = [];
  const fonts = [];
  if (run2.fontAscii) {
    fonts.push(
      `w:ascii="${escapeXmlAttr(run2.fontAscii)}" w:hAnsi="${escapeXmlAttr(run2.fontAscii)}"`
    );
  }
  if (run2.font) fonts.push(`w:eastAsia="${escapeXmlAttr(run2.font)}"`);
  if (fonts.length > 0) props.push(`<w:rFonts ${fonts.join(" ")}/>`);
  if (run2.bold) props.push("<w:b/>");
  if (run2.italic) props.push("<w:i/>");
  if (run2.underline) props.push('<w:u w:val="single"/>');
  if (run2.strike) props.push("<w:strike/>");
  if (run2.color) props.push(`<w:color w:val="${escapeXmlAttr(run2.color)}"/>`);
  if (run2.sizeHalfPoints) {
    props.push(`<w:sz w:val="${run2.sizeHalfPoints}"/><w:szCs w:val="${run2.sizeHalfPoints}"/>`);
  }
  const rPr = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(run2.text)}</w:t></w:r>`;
}
function noteEntryXml(kind, note) {
  const entry = ENTRY[kind];
  const refTag = kind === "footnote" ? "w:footnoteRef" : "w:endnoteRef";
  if (note.richParas?.length) {
    const paras2 = note.richParas.map((runs, i) => {
      const sz = runs[0]?.sizeHalfPoints;
      const szXml = sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : "";
      const refRun = i === 0 ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/>${szXml}</w:rPr><${refTag}/></w:r><w:r>${sz ? `<w:rPr>${szXml}</w:rPr>` : ""}<w:t xml:space="preserve"> </w:t></w:r>` : "";
      const pPr = '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>';
      return `<w:p>${pPr}${refRun}${runs.map(noteRunXml).join("")}</w:p>`;
    });
    return `<${entry} w:id="${escapeXmlAttr(note.id)}">${paras2.join("")}</${entry}>`;
  }
  const paras = note.text.split("\n").map((line, i) => {
    const refRun = i === 0 ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${refTag}/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>` : "";
    const textRun = line === "" ? "" : `<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`;
    return `<w:p>${refRun}${textRun}</w:p>`;
  });
  return `<${entry} w:id="${escapeXmlAttr(note.id)}">${paras.join("")}</${entry}>`;
}
function buildNotesXml(kind, notes, originalXml) {
  const entry = ENTRY[kind];
  let structural = "";
  const originals = /* @__PURE__ */ new Map();
  if (originalXml) {
    const re = new RegExp(
      `<${entry}\\s[^>]*w:type=(?:"[^"]*"|'[^']*')[^>]*>[\\s\\S]*?</${entry}>`,
      "g"
    );
    structural = (originalXml.match(re) ?? []).join("");
    for (const e of noteEntriesOf(originalXml, kind)) originals.set(e.id, e);
  }
  if (!structural) structural = separatorEntries(kind);
  const body = notes.map((n) => {
    const orig = originals.get(n.id);
    if (!orig) return noteEntryXml(kind, n);
    if (orig.text === n.text) return orig.xml;
    const patched = patchParagraphTexts(orig.xml, n.text, {
      stripFirstParaLeadingSpace: true
    });
    return patched ?? noteEntryXml(kind, n);
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${ROOT[kind]} ${rootAttributes(originalXml, ROOT[kind], NOTE_NS)}>${structural}${body}</${ROOT[kind]}>`;
}

// vendor/genoffice/docx/scan.ts
var NAME_RE2 = /^<\/?\s*([A-Za-z_][\w:.-]*)/;
var TEXT_ELEMENTS = /* @__PURE__ */ new Set(["w:t", "w:delText", "w:instrText", "w:delInstrText", "a:t", "m:t"]);
function opaqueEnd(documentXml, start) {
  if (documentXml.startsWith("<!--", start)) {
    const at = documentXml.indexOf("-->", start + 4);
    return at === -1 ? documentXml.length : at + 3;
  }
  if (documentXml.startsWith("<![CDATA[", start)) {
    const at = documentXml.indexOf("]]>", start + 9);
    return at === -1 ? documentXml.length : at + 3;
  }
  if (documentXml.startsWith("<?", start)) {
    const at = documentXml.indexOf("?>", start + 2);
    return at === -1 ? documentXml.length : at + 2;
  }
  if (!documentXml.startsWith("<!", start)) return null;
  let quote = "";
  let subsetDepth = 0;
  for (let index = start + 2; index < documentXml.length; index += 1) {
    const character = documentXml[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      subsetDepth += 1;
    } else if (character === "]") {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === ">" && subsetDepth === 0) {
      return index + 1;
    }
  }
  return documentXml.length;
}
function tagAt(documentXml, start) {
  let quote = "";
  let end = documentXml.length;
  for (let index = start + 1; index < documentXml.length; index += 1) {
    const character = documentXml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      end = index + 1;
      break;
    }
  }
  const text = documentXml.slice(start, end);
  const closing = text.startsWith("</");
  return {
    start,
    end,
    name: NAME_RE2.exec(text)?.[1] ?? "",
    closing,
    selfClosing: !closing && text.endsWith("/>")
  };
}
function scanBody(documentXml) {
  const elements = [];
  const opaqueRegions = [];
  let cursor = 0;
  let bodyContentStart = -1;
  let bodyContentEnd = -1;
  let inBody = false;
  const stack = [];
  while (cursor < documentXml.length) {
    const start = documentXml.indexOf("<", cursor);
    if (start === -1) break;
    const opaque = opaqueEnd(documentXml, start);
    if (opaque !== null) {
      const textCdata = documentXml.startsWith("<![CDATA[", start) && stack.length > 0 && TEXT_ELEMENTS.has(stack[stack.length - 1].name);
      if (bodyContentStart !== -1 && !textCdata) opaqueRegions.push({ start, end: opaque });
      cursor = opaque;
      continue;
    }
    const tag2 = tagAt(documentXml, start);
    cursor = tag2.end;
    if (!inBody) {
      if (!tag2.closing && tag2.name === "w:body") {
        if (bodyContentStart === -1) bodyContentStart = tag2.end;
        if (!tag2.selfClosing) inBody = true;
        else if (bodyContentEnd === -1) bodyContentEnd = tag2.end;
      }
      continue;
    }
    if (stack.length === 0 && tag2.closing && tag2.name === "w:body") {
      bodyContentEnd = start;
      inBody = false;
      continue;
    }
    if (tag2.closing) {
      if (stack.length === 0) {
        throw new Error(`unexpected closing tag </${tag2.name}> at body level`);
      }
      const current = stack.pop();
      if (stack.length === 0 && current) {
        elements.push({ name: current.name, start: current.start, end: tag2.end });
      }
      continue;
    }
    if (tag2.selfClosing) {
      if (stack.length === 0) elements.push({ name: tag2.name, start: tag2.start, end: tag2.end });
      continue;
    }
    stack.push({ name: tag2.name, start: tag2.start });
  }
  if (bodyContentStart === -1) {
    throw new Error("document.xml has no <w:body> element");
  }
  if (bodyContentEnd === -1) bodyContentEnd = documentXml.length;
  const bodyOpaqueRegions = opaqueRegions.filter(
    (region) => region.start >= bodyContentStart && region.end <= bodyContentEnd
  );
  if (elements.length === 0) {
    return {
      elements,
      opaqueRegions: bodyOpaqueRegions,
      innerStart: bodyContentStart,
      innerEnd: bodyContentEnd,
      bodyContentStart,
      bodyContentEnd
    };
  }
  return {
    elements,
    opaqueRegions: bodyOpaqueRegions,
    innerStart: elements[0].start,
    innerEnd: elements[elements.length - 1].end,
    bodyContentStart,
    bodyContentEnd
  };
}

// vendor/genoffice/docx/section.ts
var DEFAULT_SECTION = {
  pageWidth: 12240,
  pageHeight: 15840,
  orientation: "portrait",
  marginTop: 1440,
  marginRight: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
  pageBorder: false,
  columns: 1,
  headerDist: 720,
  footerDist: 720
};
function vAlignOf(xml) {
  const v = strAttr(/<w:vAlign[^>]*\/?>/.exec(xml)?.[0] ?? "", "w:val");
  return v === "center" || v === "both" || v === "bottom" ? v : void 0;
}
function strAttr(tag2, name) {
  return new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`).exec(tag2)?.[1];
}
function intAttr(tag2, name, fallback) {
  const m = new RegExp(`${name}=["'](-?\\d+)["']`).exec(tag2);
  const v = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(v) ? v : fallback;
}
function hasVisiblePageBorder(xml) {
  const pgBorders = /<w:pgBorders[^>]*\/>|<w:pgBorders[\s\S]*?<\/w:pgBorders>/.exec(xml)?.[0];
  if (!pgBorders) return false;
  const sides = pgBorders.match(/<w:(?:top|left|bottom|right)\b[^>]*\/?>/g) ?? [];
  return sides.some((side) => {
    const val2 = strAttr(side, "w:val");
    return val2 !== void 0 && val2 !== "none" && val2 !== "nil";
  });
}
var LINE_BORDER_VALS = /* @__PURE__ */ new Set([
  "single",
  "thick",
  "double",
  "dotted",
  "dashed",
  "dotDash",
  "dotDotDash",
  "triple",
  "thinThickSmallGap",
  "thickThinSmallGap",
  "thinThickThinSmallGap",
  "thinThickMediumGap",
  "thickThinMediumGap",
  "thinThickThinMediumGap",
  "thinThickLargeGap",
  "thickThinLargeGap",
  "thinThickThinLargeGap",
  "wave",
  "doubleWave",
  "dashSmallGap",
  "dashDotStroked",
  "threeDEmboss",
  "threeDEngrave",
  "outset",
  "inset"
]);
function pageBorderPropsOf(xml) {
  const pgBorders = /<w:pgBorders[^>]*\/>|<w:pgBorders[\s\S]*?<\/w:pgBorders>/.exec(xml)?.[0];
  if (!pgBorders || !hasVisiblePageBorder(xml)) return void 0;
  const display = strAttr(pgBorders, "w:display");
  const offsetFrom = strAttr(pgBorders, "w:offsetFrom");
  const zOrder = /\bw:zOrder\s*=\s*["']back["']/.test(pgBorders) ? "back" : void 0;
  let spacePt = 0;
  let widthPt = 0;
  let color;
  const sides = {};
  for (const side of pgBorders.match(/<w:(?:top|left|bottom|right)\b[^>]*\/?>/g) ?? []) {
    const val2 = strAttr(side, "w:val");
    if (!val2 || val2 === "none" || val2 === "nil") continue;
    const name = /<w:(top|left|bottom|right)\b/.exec(side)[1];
    const sideColor = /w:color\s*=\s*["']([0-9A-Fa-f]{6})["']/.exec(side)?.[1];
    const art = !LINE_BORDER_VALS.has(val2);
    const sz = intAttr(side, "w:sz", 0);
    sides[name] = {
      val: val2,
      widthPt: art ? sz : sz / 8,
      spacePt: intAttr(side, "w:space", 0),
      ...sideColor ? { color: sideColor } : {},
      ...art ? { art } : {}
    };
    spacePt = Math.max(spacePt, intAttr(side, "w:space", 0));
    widthPt = Math.max(widthPt, sides[name].widthPt);
    color ??= sideColor;
  }
  return {
    ...display ? { display } : {},
    ...offsetFrom ? { offsetFrom } : {},
    ...zOrder ? { zOrder } : {},
    spacePt,
    widthPt,
    ...color ? { color } : {},
    sides
  };
}
function sectionSettingsFromXml(xml, opts = {}) {
  const pgSz = /<w:pgSz[^>]*\/?>/.exec(xml)?.[0] ?? "";
  const pgMar = /<w:pgMar[^>]*\/?>/.exec(xml)?.[0] ?? "";
  let docGrid;
  const docGridTag = /<w:docGrid[^>]*\/?>/.exec(xml)?.[0];
  if (docGridTag) {
    const gridType = strAttr(docGridTag, "w:type") ?? "default";
    const validTypes = ["default", "lines", "linesAndChars", "snapToChars"];
    const linePitch = intAttr(docGridTag, "w:linePitch", -1);
    const charSpace = intAttr(docGridTag, "w:charSpace", Number.NaN);
    docGrid = {
      type: validTypes.includes(gridType) ? gridType : "default",
      ...linePitch >= 0 ? { linePitch } : {},
      ...Number.isFinite(charSpace) ? { charSpace } : {}
    };
  }
  const colsElement = /<w:cols[^>]*>[\s\S]*?<\/w:cols>/.exec(xml)?.[0];
  const colWidths = (colsElement?.match(/<w:col [^>]*w:w=["']\d+["'][^>]*>/g) ?? []).map((tag2) => intAttr(tag2, "w:w", 0)).filter((w) => w > 0);
  const pageBorderProps = pageBorderPropsOf(xml);
  const footnotePr = notePropsFromXml(xml, "w:footnotePr");
  const endnotePr = notePropsFromXml(xml, "w:endnotePr");
  const lineNumbers = lineNumberingOf(xml);
  const marginTop = intAttr(pgMar, "w:top", DEFAULT_SECTION.marginTop);
  const marginBottom = intAttr(pgMar, "w:bottom", DEFAULT_SECTION.marginBottom);
  const gutter = Math.max(0, intAttr(pgMar, "w:gutter", 0));
  const gutterAtTop = gutter > 0 && !!opts.gutterAtTop;
  return {
    pageWidth: intAttr(pgSz, "w:w", DEFAULT_SECTION.pageWidth),
    pageHeight: intAttr(pgSz, "w:h", DEFAULT_SECTION.pageHeight),
    orientation: strAttr(pgSz, "w:orient") === "landscape" ? "landscape" : "portrait",
    marginTop: Math.abs(marginTop) + (gutterAtTop ? gutter : 0),
    marginRight: intAttr(pgMar, "w:right", DEFAULT_SECTION.marginRight),
    marginBottom: Math.abs(marginBottom),
    marginLeft: intAttr(pgMar, "w:left", DEFAULT_SECTION.marginLeft) + (gutterAtTop ? 0 : gutter),
    ...marginTop < 0 ? { marginTopFixed: true } : {},
    ...marginBottom < 0 ? { marginBottomFixed: true } : {},
    ...gutter > 0 ? { gutter } : {},
    ...gutterAtTop ? { gutterAtTop: true } : {},
    headerDist: intAttr(pgMar, "w:header", 720),
    footerDist: intAttr(pgMar, "w:footer", 720),
    ...vAlignOf(xml) ? { vAlign: vAlignOf(xml) } : {},
    pageBorder: hasVisiblePageBorder(xml),
    ...pageBorderProps ? { pageBorderProps } : {},
    columns: intAttr(/<w:cols[^>]*\/?>/.exec(xml)?.[0] ?? "", "w:num", 1),
    colSpace: intAttr(/<w:cols[^>]*\/?>/.exec(xml)?.[0] ?? "", "w:space", 720),
    ...colWidths.length >= 2 ? { colWidths } : {},
    ...lineNumbers ? { lineNumbers } : {},
    ...onOffTagIn(xml, "w:bidi") ? { bidi: true } : {},
    ...docGrid ? { docGrid } : {},
    ...textDirectionOf(xml) ? { textDirection: textDirectionOf(xml) } : {},
    ...footnotePr ? { footnotePr } : {},
    ...endnotePr ? { endnotePr } : {}
  };
}
function notePropsFromXml(xml, tag2) {
  const el = new RegExp(`<${tag2}>([\\s\\S]*?)</${tag2}>`).exec(xml)?.[1];
  if (!el) return void 0;
  const val2 = (name) => {
    const tag3 = new RegExp(`<w:${name}\\b[^>]*\\/?>`).exec(el)?.[0] ?? "";
    return strAttr(tag3, "w:val");
  };
  const pos = val2("pos");
  const numFmt = val2("numFmt");
  const numStart = val2("numStart");
  const numRestart = val2("numRestart");
  const out = {
    ...pos === "pageBottom" || pos === "beneathText" || pos === "sectEnd" || pos === "docEnd" ? { pos } : {},
    ...numFmt ? { numFmt } : {},
    ...numStart && /^\d+$/.test(numStart) ? { numStart: parseInt(numStart, 10) } : {},
    ...numRestart === "continuous" || numRestart === "eachSect" || numRestart === "eachPage" ? { numRestart } : {}
  };
  return Object.keys(out).length > 0 ? out : void 0;
}
function lineNumberingOf(xml) {
  const tag2 = /<w:lnNumType\b[^>]*\/?>/.exec(xml)?.[0];
  if (!tag2) return void 0;
  const restart = strAttr(tag2, "w:restart");
  const distance = intAttr(tag2, "w:distance", -1);
  return {
    countBy: Math.max(1, intAttr(tag2, "w:countBy", 1)),
    // Word skips w:start lines before the first label and restarts per page unless told otherwise
    start: Math.max(0, intAttr(tag2, "w:start", 0)) + 1,
    ...distance >= 0 ? { distance } : {},
    restart: restart === "continuous" || restart === "newSection" ? restart : "newPage"
  };
}
function textDirectionOf(xml) {
  const val2 = strAttr(/<w:textDirection[^>]*\/?>/.exec(xml)?.[0] ?? "", "w:val");
  return val2 && val2 !== "lrTb" ? val2 : void 0;
}
function xmlFlagOn(xml, tag2) {
  for (const m of xml.matchAll(new RegExp(`<${tag2}(?=[\\s/>])[^>]*>`, "g"))) {
    const val2 = strAttr(m[0], "w:val");
    if (val2 === void 0 || !/^(?:0|false|off)$/.test(val2)) return true;
  }
  return false;
}
function hfReferenceTags(xml, kind) {
  return xml.match(
    new RegExp(`<w:${kind}Reference\\b[^>]*(?:\\/>|>\\s*<\\/w:${kind}Reference>)`, "g")
  ) ?? [];
}
function hfReferenceType(tag2) {
  return /\bw:type\s*=\s*["']([^"']*)["']/.exec(tag2)?.[1];
}
function hfReferenceRId(tag2) {
  return /\br:id\s*=\s*["']([^"']+)["']/.exec(tag2)?.[1];
}
function stripElement(xml, tag2) {
  return xml.replace(new RegExp(`<${tag2}[^>]*\\/>|<${tag2}[^>]*>[\\s\\S]*?<\\/${tag2}>`, "g"), "");
}
function applyPageNumType(sectPrXml, fmt, start) {
  const xml = stripElement(sectPrXml, "w:pgNumType");
  if (fmt === void 0 && start === void 0) return xml;
  const tag2 = `<w:pgNumType${fmt !== void 0 ? ` w:fmt="${fmt}"` : ""}${start !== void 0 ? ` w:start="${start}"` : ""}/>`;
  return insertBefore(xml, tag2, PG_NUM_TYPE_FOLLOWERS);
}
function injectIntoSectPr(xml, tag2) {
  const m = /<w:sectPr(?:\s[^>]*?)?\/>|<w:sectPr(?:\s[^>]*?)?>/.exec(xml);
  if (!m) return xml;
  const open = m[0].endsWith("/>") ? `${m[0].slice(0, -2)}>` : m[0];
  return xml.replace(m[0], () => `${open}${tag2}${m[0].endsWith("/>") ? "</w:sectPr>" : ""}`);
}
var PG_NUM_TYPE_FOLLOWERS = /<w:(?:cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings)[\s/>]/;
var TITLE_PG_FOLLOWERS = /<w:(?:textDirection|bidi|rtlGutter|docGrid|printerSettings)[\s/>]/;
function insertBefore(sectPrXml, tag2, followers) {
  const m = followers.exec(sectPrXml);
  if (m) return `${sectPrXml.slice(0, m.index)}${tag2}${sectPrXml.slice(m.index)}`;
  return sectPrXml.replace(/<\/w:sectPr>/, `${tag2}</w:sectPr>`);
}
function applySectionSettings(sectPrXml, settings) {
  const orient = settings.orientation === "landscape" ? ' w:orient="landscape"' : "";
  const pgSz = `<w:pgSz w:w="${settings.pageWidth}" w:h="${settings.pageHeight}"${orient}/>`;
  let xml = sectPrXml;
  if (/<w:pgSz[^>]*\/?>/.test(xml)) {
    xml = xml.replace(/<w:pgSz[^>]*\/?>/, pgSz);
  } else {
    xml = injectIntoSectPr(xml, pgSz);
  }
  const replaceMarAttr = (tag2, name, value) => {
    if (new RegExp(`${name}="`).test(tag2)) {
      return tag2.replace(new RegExp(`${name}="-?\\d+"`), `${name}="${value}"`);
    }
    return tag2.replace(/\/>$/, ` ${name}="${value}"/>`);
  };
  const marMatch = /<w:pgMar[^>]*\/>/.exec(xml);
  if (marMatch) {
    let tag2 = marMatch[0];
    const gutter = settings.gutter ?? 0;
    const top = Math.max(0, settings.marginTop - (settings.gutterAtTop ? gutter : 0));
    tag2 = replaceMarAttr(tag2, "w:top", settings.marginTopFixed ? -top : top);
    tag2 = replaceMarAttr(tag2, "w:right", settings.marginRight);
    tag2 = replaceMarAttr(
      tag2,
      "w:bottom",
      settings.marginBottomFixed ? -settings.marginBottom : settings.marginBottom
    );
    tag2 = replaceMarAttr(
      tag2,
      "w:left",
      Math.max(0, settings.marginLeft - (settings.gutterAtTop ? 0 : gutter))
    );
    if (settings.headerDist !== void 0)
      tag2 = replaceMarAttr(tag2, "w:header", settings.headerDist);
    if (settings.footerDist !== void 0)
      tag2 = replaceMarAttr(tag2, "w:footer", settings.footerDist);
    if (settings.gutter !== void 0) tag2 = replaceMarAttr(tag2, "w:gutter", gutter);
    xml = xml.replace(marMatch[0], tag2);
  } else {
    const gutter = settings.gutter ?? 0;
    const pgMar = `<w:pgMar w:top="${settings.marginTop - (settings.gutterAtTop ? gutter : 0)}" w:right="${settings.marginRight}" w:bottom="${settings.marginBottom}" w:left="${settings.marginLeft - (settings.gutterAtTop ? 0 : gutter)}" w:header="708" w:footer="708" w:gutter="${gutter}"/>`;
    xml = xml.replace(/<\/w:sectPr>/, `${pgMar}</w:sectPr>`);
  }
  xml = xml.replace(/<w:pgBorders[^>]*\/>|<w:pgBorders[\s\S]*?<\/w:pgBorders>/, "");
  if (settings.pageBorder) {
    const side = (name) => `<w:${name} w:val="single" w:sz="4" w:space="24" w:color="auto"/>`;
    const pgBorders = `<w:pgBorders w:offsetFrom="page">${side("top")}${side("left")}${side("bottom")}${side("right")}</w:pgBorders>`;
    xml = xml.replace(/(<w:pgMar[^>]*\/>)/, `$1${pgBorders}`);
  }
  const colsMatch = /<w:cols[^>]*\/>|<w:cols[^>]*>[\s\S]*?<\/w:cols>/.exec(xml);
  const numAttr = settings.columns > 1 ? ` w:num="${settings.columns}"` : "";
  const colsAnchor = (tag2) => {
    const anchor = /(<w:pgBorders[\s\S]*?<\/w:pgBorders>|<w:pgMar[^>]*\/>)/.exec(xml);
    if (anchor) return xml.replace(anchor[0], `${anchor[0]}${tag2}`);
    return xml.replace(/<\/w:sectPr>/, `${tag2}</w:sectPr>`);
  };
  if (settings.colWidths !== void 0 && settings.columns > 1 && settings.colWidths.length === settings.columns) {
    const currentWidths = (colsMatch?.[0].match(/<w:col [^>]*w:w=["']\d+["'][^>]*>/g) ?? []).map(
      (t) => intAttr(t, "w:w", 0)
    );
    const unchanged = colsMatch !== null && intAttr(colsMatch[0], "w:num", 1) === settings.columns && currentWidths.length === settings.colWidths.length && currentWidths.every((w, i) => w === settings.colWidths[i]);
    if (!unchanged) {
      const space = settings.colSpace ?? 720;
      const children = settings.colWidths.map(
        (w, i) => i < settings.colWidths.length - 1 ? `<w:col w:w="${w}" w:space="${space}"/>` : `<w:col w:w="${w}"/>`
      ).join("");
      const tag2 = `<w:cols${numAttr} w:space="${space}" w:equalWidth="0">${children}</w:cols>`;
      xml = colsMatch ? xml.replace(colsMatch[0], tag2) : colsAnchor(tag2);
    }
  } else if (colsMatch) {
    const openTag = /^<w:cols[^>]*>/.exec(colsMatch[0])?.[0] ?? colsMatch[0];
    const selfClosing = colsMatch[0].endsWith("/>");
    const currentNum = / w:num="(\d+)"/.exec(openTag)?.[1] ?? "1";
    if (selfClosing || currentNum !== String(settings.columns)) {
      let tag2 = openTag.replace(/ w:num="\d+"/, "").replace(/\/?>$/, "/>");
      if (numAttr) tag2 = tag2.replace(/^<w:cols/, `<w:cols${numAttr}`);
      if (settings.colSpace !== void 0 && settings.colSpace !== intAttr(tag2, "w:space", 720)) {
        tag2 = / w:space="\d+"/.test(tag2) ? tag2.replace(/ w:space="\d+"/, ` w:space="${settings.colSpace}"`) : tag2.replace(/\/>$/, ` w:space="${settings.colSpace}"/>`);
      }
      xml = xml.replace(colsMatch[0], tag2);
    }
  } else if (numAttr) {
    xml = colsAnchor(`<w:cols${numAttr} w:space="${settings.colSpace ?? 425}"/>`);
  }
  const BIDI_ELEMENT = /<w:bidi(?=[\s/>])[^>]*(?:\/>|>[\s\S]*?<\/w:bidi>)/i;
  if (settings.bidi !== void 0) {
    const hasBidi = BIDI_ELEMENT.test(xml);
    if (settings.bidi && !hasBidi) {
      if (/<w:docGrid/.test(xml)) xml = xml.replace(/(<w:docGrid)/, "<w:bidi/>$1");
      else xml = xml.replace(/<\/w:sectPr>/, "<w:bidi/></w:sectPr>");
    } else if (!settings.bidi && hasBidi) {
      xml = xml.replace(BIDI_ELEMENT, "");
    }
  }
  return xml;
}
function applySectionStartType(sectPrXml, type) {
  let xml = stripElement(sectPrXml, "w:type");
  if (type === "nextPage") return xml;
  const tag2 = `<w:type w:val="${type}"/>`;
  if (/<w:pgSz/.test(xml)) xml = xml.replace(/(<w:pgSz)/, `${tag2}$1`);
  else xml = injectIntoSectPr(xml, tag2);
  return xml;
}
function applyTitlePg(sectPrXml, on) {
  const xml = stripElement(sectPrXml, "w:titlePg");
  return on ? insertBefore(xml, "<w:titlePg/>", TITLE_PG_FOLLOWERS) : xml;
}

// vendor/genoffice/docx/sources.ts
var SOURCES_NS = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
var CUSTOM_XML_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
async function findSourcesPart(zip) {
  for (const name of Object.keys(zip.files)) {
    if (!/^customXml\/item\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name).async("string");
    if (xml.includes("Sources") && xml.includes(SOURCES_NS)) return name;
  }
  return null;
}
function parseSourcesXml(xml) {
  const out = [];
  const re = /<b:Source>([\s\S]*?)<\/b:Source>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    const field = (tag3) => {
      const f = new RegExp(`<b:${tag3}>([\\s\\S]*?)</b:${tag3}>`).exec(body)?.[1];
      return f ? decodeEntities2(f.trim()) : void 0;
    };
    const tag2 = field("Tag");
    if (!tag2) continue;
    let author = field("Corporate") ?? "";
    if (!author) {
      const last = field("Last") ?? "";
      const first = field("First") ?? "";
      author = [last, first].filter(Boolean).join(", ");
    }
    out.push({
      tag: tag2,
      type: field("SourceType") ?? "Misc",
      author,
      title: field("Title") ?? "",
      year: field("Year") ?? "",
      publisher: field("Publisher") ?? field("JournalName") ?? field("InternetSiteTitle"),
      url: field("URL")
    });
  }
  return out;
}
function decodeEntities2(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function sourceEntryXml(source) {
  const t = (tag2, value) => value ? `<b:${tag2}>${escapeXmlText(value)}</b:${tag2}>` : "";
  const comma = source.author.indexOf(",");
  const last = comma === -1 ? source.author : source.author.slice(0, comma).trim();
  const first = comma === -1 ? "" : source.author.slice(comma + 1).trim();
  const authorXml = source.author ? "<b:Author><b:Author><b:NameList><b:Person>" + t("Last", last) + t("First", first) + "</b:Person></b:NameList></b:Author></b:Author>" : "";
  const publisherTag = source.type === "JournalArticle" ? "JournalName" : source.type === "InternetSite" ? "InternetSiteTitle" : "Publisher";
  return "<b:Source>" + t("Tag", source.tag) + t("SourceType", source.type) + authorXml + t("Title", source.title) + t("Year", source.year) + t(publisherTag, source.publisher) + t("URL", source.url) + "</b:Source>";
}
function buildSourcesXml(sources, originalXml = null) {
  const originals = /* @__PURE__ */ new Map();
  let rootOpen = `<b:Sources SelectedStyle="\\APASixthEditionOfficeOnline.xsl" StyleName="APA" Version="6" xmlns:b="${SOURCES_NS}" xmlns="${SOURCES_NS}">`;
  if (originalXml) {
    const open = /<b:Sources(?:\s[^>]*)?>/.exec(originalXml)?.[0];
    if (open) rootOpen = open;
    for (const m of originalXml.match(/<b:Source>[\s\S]*?<\/b:Source>/g) ?? []) {
      const parsed = parseSourcesXml(m)[0];
      if (parsed) originals.set(parsed.tag, { xml: m, parsed });
    }
  }
  const unchanged = (a, b) => a.type === b.type && a.author === b.author && a.title === b.title && a.year === b.year && (a.publisher ?? "") === (b.publisher ?? "") && (a.url ?? "") === (b.url ?? "");
  const body = sources.map((s) => {
    const orig = originals.get(s.tag);
    return orig && unchanged(orig.parsed, s) ? orig.xml : sourceEntryXml(s);
  }).join("");
  return rootOpen + body + "</b:Sources>";
}
function buildSourcesItemPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ds:datastoreItem ds:itemID="{4A8D2934-D5B1-4C15-A6F4-7A1B2C3D4E5F}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${SOURCES_NS}"/></ds:schemaRefs></ds:datastoreItem>`;
}

// vendor/genoffice/docx/symbol-fonts.ts
var SYMBOL = {
  33: "!",
  34: "\u2200",
  35: "#",
  36: "\u2203",
  37: "%",
  38: "&",
  39: "\u220D",
  40: "(",
  41: ")",
  42: "\u2217",
  43: "+",
  44: ",",
  45: "\u2212",
  46: ".",
  47: "/",
  48: "0",
  49: "1",
  50: "2",
  51: "3",
  52: "4",
  53: "5",
  54: "6",
  55: "7",
  56: "8",
  57: "9",
  58: ":",
  59: ";",
  60: "<",
  61: "=",
  62: ">",
  63: "?",
  64: "\u2245",
  65: "\u0391",
  66: "\u0392",
  67: "\u03A7",
  68: "\u0394",
  69: "\u0395",
  70: "\u03A6",
  71: "\u0393",
  72: "\u0397",
  73: "\u0399",
  74: "\u03D1",
  75: "\u039A",
  76: "\u039B",
  77: "\u039C",
  78: "\u039D",
  79: "\u039F",
  80: "\u03A0",
  81: "\u0398",
  82: "\u03A1",
  83: "\u03A3",
  84: "\u03A4",
  85: "\u03A5",
  86: "\u03C2",
  87: "\u03A9",
  88: "\u039E",
  89: "\u03A8",
  90: "\u0396",
  91: "[",
  92: "\u2234",
  93: "]",
  94: "\u22A5",
  95: "_",
  96: "\u203E",
  97: "\u03B1",
  98: "\u03B2",
  99: "\u03C7",
  100: "\u03B4",
  101: "\u03B5",
  102: "\u03C6",
  103: "\u03B3",
  104: "\u03B7",
  105: "\u03B9",
  106: "\u03D5",
  107: "\u03BA",
  108: "\u03BB",
  109: "\u03BC",
  110: "\u03BD",
  111: "\u03BF",
  112: "\u03C0",
  113: "\u03B8",
  114: "\u03C1",
  115: "\u03C3",
  116: "\u03C4",
  117: "\u03C5",
  118: "\u03D6",
  119: "\u03C9",
  120: "\u03BE",
  121: "\u03C8",
  122: "\u03B6",
  123: "{",
  124: "|",
  125: "}",
  126: "\u223C",
  160: "\u20AC",
  161: "\u03D2",
  162: "\u2032",
  163: "\u2264",
  164: "\u2044",
  165: "\u221E",
  166: "\u0192",
  167: "\u2663",
  168: "\u2666",
  169: "\u2665",
  170: "\u2660",
  171: "\u2194",
  172: "\u2190",
  173: "\u2191",
  174: "\u2192",
  175: "\u2193",
  176: "\xB0",
  177: "\xB1",
  178: "\u2033",
  179: "\u2265",
  180: "\xD7",
  181: "\u221D",
  182: "\u2202",
  183: "\u2022",
  184: "\xF7",
  185: "\u2260",
  186: "\u2261",
  187: "\u2248",
  188: "\u2026",
  189: "\u23D0",
  190: "\u23AF",
  191: "\u21B5",
  192: "\u2135",
  193: "\u2111",
  194: "\u211C",
  195: "\u2118",
  196: "\u2297",
  197: "\u2295",
  198: "\u2205",
  199: "\u2229",
  200: "\u222A",
  201: "\u2283",
  202: "\u2287",
  203: "\u2284",
  204: "\u2282",
  205: "\u2286",
  206: "\u2208",
  207: "\u2209",
  208: "\u2220",
  209: "\u2207",
  210: "\xAE",
  211: "\xA9",
  212: "\u2122",
  213: "\u220F",
  214: "\u221A",
  215: "\u22C5",
  216: "\xAC",
  217: "\u2227",
  218: "\u2228",
  219: "\u21D4",
  220: "\u21D0",
  221: "\u21D1",
  222: "\u21D2",
  223: "\u21D3",
  224: "\u25CA",
  225: "\u2329",
  226: "\xAE",
  227: "\xA9",
  228: "\u2122",
  229: "\u2211",
  230: "\u239B",
  231: "\u239C",
  232: "\u239D",
  233: "\u23A1",
  234: "\u23A2",
  235: "\u23A3",
  236: "\u23A7",
  237: "\u23A8",
  238: "\u23A9",
  239: "\u23AA",
  240: "\u20AC",
  241: "\u232A",
  242: "\u222B",
  243: "\u2320",
  244: "\u23AE",
  245: "\u2321",
  246: "\u239E",
  247: "\u239F",
  248: "\u23A0",
  249: "\u23A4",
  250: "\u23A5",
  251: "\u23A6",
  252: "\u23AB",
  253: "\u23AC",
  254: "\u23AD"
};
var WINGDINGS = {
  33: "\u270F",
  34: "\u2702",
  35: "\u2701",
  36: "\u{1F453}",
  37: "\u{1F514}",
  38: "\u{1F4D6}",
  39: "\u{1F56F}",
  40: "\u260E",
  41: "\u2706",
  42: "\u2709",
  43: "\u2709",
  44: "\u{1F4EA}",
  45: "\u{1F4EB}",
  46: "\u{1F4EC}",
  47: "\u{1F4ED}",
  48: "\u{1F4C1}",
  49: "\u{1F4C2}",
  50: "\u{1F4C4}",
  51: "\u{1F4C4}",
  52: "\u{1F4C4}",
  53: "\u{1F5C4}",
  54: "\u231B",
  55: "\u2328",
  56: "\u{1F5B1}",
  57: "\u{1F5B2}",
  58: "\u{1F5A5}",
  59: "\u{1F4BD}",
  60: "\u{1F4BE}",
  61: "\u{1F4BE}",
  62: "\u2707",
  63: "\u270D",
  64: "\u270D",
  65: "\u270C",
  66: "\u{1F44C}",
  67: "\u{1F44D}",
  68: "\u{1F44E}",
  69: "\u261C",
  70: "\u261E",
  71: "\u261D",
  72: "\u261F",
  73: "\u{1F590}",
  74: "\u263A",
  75: "\u{1F610}",
  76: "\u2639",
  77: "\u{1F4A3}",
  78: "\u2620",
  79: "\u{1F3F3}",
  80: "\u2690",
  81: "\u2708",
  82: "\u263C",
  83: "\u{1F4A7}",
  84: "\u2744",
  85: "\u271D",
  86: "\u271E",
  87: "\u2628",
  88: "\u2720",
  89: "\u2721",
  90: "\u262A",
  91: "\u262F",
  92: "\u0950",
  93: "\u2638",
  94: "\u2648",
  95: "\u2649",
  96: "\u264A",
  97: "\u264B",
  98: "\u264C",
  99: "\u264D",
  100: "\u264E",
  101: "\u264F",
  102: "\u2650",
  103: "\u2651",
  104: "\u2652",
  105: "\u2653",
  106: "&",
  107: "&",
  108: "\u25CF",
  109: "\u274D",
  110: "\u25A0",
  111: "\u2751",
  112: "\u2752",
  113: "\u2751",
  114: "\u2752",
  115: "\u2B27",
  116: "\u29EB",
  117: "\u25C6",
  118: "\u2756",
  119: "\u2B25",
  120: "\u2327",
  121: "\u2191",
  122: "\u2318",
  123: "\u{1F3F5}",
  124: "\u273F",
  125: "\u275D",
  126: "\u275E",
  128: "\u24EA",
  129: "\u2460",
  130: "\u2461",
  131: "\u2462",
  132: "\u2463",
  133: "\u2464",
  134: "\u2465",
  135: "\u2466",
  136: "\u2467",
  137: "\u2468",
  138: "\u2469",
  139: "\u24FF",
  140: "\u2776",
  141: "\u2777",
  142: "\u2778",
  143: "\u2779",
  144: "\u277A",
  145: "\u277B",
  146: "\u277C",
  147: "\u277D",
  148: "\u277E",
  149: "\u277F",
  150: "\u2766",
  151: "\u2766",
  152: "\u2766",
  153: "\u2766",
  154: "\u2767",
  155: "\u2767",
  156: "\u2767",
  157: "\u2767",
  158: "\xB7",
  159: "\u2022",
  160: "\u25AA",
  161: "\u25CB",
  162: "\u25CB",
  163: "\u25CB",
  164: "\u25C9",
  165: "\u25CE",
  166: "\u274D",
  167: "\u25AA",
  168: "\u25A1",
  169: "\u2726",
  170: "\u2726",
  171: "\u2605",
  172: "\u2736",
  173: "\u2734",
  174: "\u2739",
  175: "\u2735",
  176: "\u2316",
  177: "\u2316",
  178: "\u27E1",
  179: "\u2311",
  180: "\u2370",
  181: "\u272A",
  182: "\u2730",
  183: "\u{1F550}",
  184: "\u{1F551}",
  185: "\u{1F552}",
  186: "\u{1F553}",
  187: "\u{1F554}",
  188: "\u{1F555}",
  189: "\u{1F556}",
  190: "\u{1F557}",
  191: "\u{1F558}",
  192: "\u{1F559}",
  193: "\u{1F55A}",
  194: "\u{1F55B}",
  195: "\u21B2",
  196: "\u21B3",
  197: "\u21B0",
  198: "\u21B1",
  199: "\u2B11",
  200: "\u2B0F",
  201: "\u2B10",
  202: "\u2B0E",
  203: "\u2756",
  204: "\u2756",
  205: "\u2767",
  206: "\u2767",
  207: "\u2767",
  208: "\u2767",
  209: "\u2767",
  210: "\u2767",
  211: "\u2767",
  212: "\u2767",
  213: "\u232B",
  214: "\u2326",
  215: "\u25C0",
  216: "\u27A2",
  217: "\u25B2",
  218: "\u25BC",
  219: "\u21E6",
  220: "\u21E8",
  221: "\u21E7",
  222: "\u21E9",
  223: "\u21E6",
  224: "\u21E8",
  225: "\u21E7",
  226: "\u21E9",
  227: "\u21D6",
  228: "\u21D7",
  229: "\u21D9",
  230: "\u21D8",
  231: "\u2B05",
  232: "\u27A1",
  233: "\u2B06",
  234: "\u2B07",
  235: "\u2B09",
  236: "\u2B08",
  237: "\u2B0B",
  238: "\u2B0A",
  239: "\u2190",
  240: "\u2192",
  241: "\u2191",
  242: "\u2193",
  243: "\u2194",
  244: "\u2195",
  245: "\u2196",
  246: "\u2197",
  247: "\u2199",
  248: "\u2198",
  249: "\u21E8",
  250: "\u21E8",
  251: "\u2717",
  252: "\u2713",
  253: "\u2612",
  254: "\u2611"
};
var WINGDINGS_2 = {
  33: "\u{1F58A}",
  34: "\u{1F58B}",
  35: "\u{1F58C}",
  36: "\u{1F58D}",
  37: "\u2704",
  38: "\u2702",
  39: "\u260F",
  40: "\u2706",
  41: "\u{1F4C4}",
  42: "\u{1F4C4}",
  43: "\u{1F4C4}",
  44: "\u{1F4C4}",
  45: "\u{1F4C4}",
  46: "\u{1F4C4}",
  47: "\u{1F4C4}",
  48: "\u{1F4C4}",
  49: "\u{1F4C4}",
  50: "\u{1F4CB}",
  51: "\u{1F5D1}",
  52: "\u2750",
  53: "\u{1F5A5}",
  54: "\u{1F5A8}",
  55: "\u{1F4E0}",
  56: "\u{1F4BF}",
  57: "\u{1F4FC}",
  58: "\u{1F5B1}",
  59: "\u{1F5B1}",
  60: "\u{1F44D}",
  61: "\u{1F44E}",
  62: "\u261C",
  63: "\u261E",
  64: "\u261A",
  65: "\u261B",
  66: "\u{1F448}",
  67: "\u{1F449}",
  68: "\u261A",
  69: "\u261B",
  70: "\u261D",
  71: "\u261F",
  72: "\u261D",
  73: "\u261F",
  74: "\u{1F446}",
  75: "\u{1F447}",
  76: "\u261D",
  77: "\u261F",
  78: "\u{1F590}",
  79: "\u2715",
  80: "\u2713",
  81: "\u2612",
  82: "\u2611",
  83: "\u2612",
  84: "\u2612",
  85: "\u2297",
  86: "\u2297",
  87: "\u29B8",
  88: "\u29B8",
  89: "&",
  90: "&",
  91: "&",
  92: "&",
  93: "\u203D",
  94: "\u203D",
  95: "\u203D",
  96: "\u203D",
  97: "\u2766",
  98: "\u2766",
  99: "\u2766",
  100: "\u2766",
  101: "\u2767",
  102: "\u2767",
  103: "\u2767",
  104: "\u2767",
  105: "\u24EA",
  106: "\u2460",
  107: "\u2461",
  108: "\u2462",
  109: "\u2463",
  110: "\u2464",
  111: "\u2465",
  112: "\u2466",
  113: "\u2467",
  114: "\u2468",
  115: "\u2469",
  116: "\u24FF",
  117: "\u2776",
  118: "\u2777",
  119: "\u2778",
  120: "\u2779",
  121: "\u277A",
  122: "\u277B",
  123: "\u277C",
  124: "\u277D",
  125: "\u277E",
  126: "\u277F",
  128: "\u2609",
  129: "\u{1F315}",
  130: "\u263D",
  131: "\u263E",
  132: "\u2E3F",
  133: "\u271D",
  134: "\u271D",
  135: "\u{1F55C}",
  136: "\u{1F55D}",
  137: "\u{1F55E}",
  138: "\u{1F55F}",
  139: "\u{1F560}",
  140: "\u{1F561}",
  141: "\u{1F562}",
  142: "\u{1F563}",
  143: "\u{1F564}",
  144: "\u{1F565}",
  145: "\u{1F566}",
  146: "\u{1F567}",
  147: "\u2725",
  148: "\u2725",
  149: "\u2022",
  150: "\u25CF",
  151: "\u25CF",
  152: "\u25CF",
  153: "\u25E6",
  154: "\u25CB",
  155: "\u25CB",
  156: "\u25CB",
  157: "\u25C9",
  158: "\u25C9",
  159: "\u25AA",
  160: "\u25A0",
  161: "\u25A0",
  162: "\u25A0",
  163: "\u25A1",
  164: "\u25A1",
  165: "\u25A1",
  166: "\u25A1",
  167: "\u25A3",
  168: "\u25A3",
  169: "\u25A3",
  170: "\u25A3",
  171: "\u2B25",
  172: "\u2B29",
  173: "\u2B25",
  174: "\u25C6",
  175: "\u25C7",
  176: "\u25C8",
  177: "\u25C8",
  178: "\u25C8",
  179: "\u25C8",
  180: "\u2B29",
  181: "\u2B2A",
  182: "\u2B27",
  183: "\u29EB",
  184: "\u25CA",
  185: "\u25CA",
  186: "\u25D6",
  187: "\u25D7",
  188: "\u25D3",
  189: "\u25D2",
  190: "\u25FC",
  191: "\u2B25",
  192: "\u2B1F",
  193: "\u2B1F",
  194: "\u2B23",
  195: "\u2B22",
  196: "\u2B22",
  197: "\u2B22",
  198: "\u271B",
  199: "\u271B",
  200: "\u271A",
  201: "\u271A",
  202: "\u271A",
  203: "\u271A",
  204: "\u271A",
  205: "\u2715",
  206: "\u2715",
  207: "\u2716",
  208: "\u2716",
  209: "\u2716",
  210: "\u2716",
  211: "\u2716",
  212: "\u2731",
  213: "\u2731",
  214: "\u2731",
  215: "\u2731",
  216: "\u2731",
  217: "\u2731",
  218: "\u2732",
  219: "\u2732",
  220: "\u2732",
  221: "\u2732",
  222: "\u2732",
  223: "\u2732",
  224: "\u2733",
  225: "\u2733",
  226: "\u2733",
  227: "\u2733",
  228: "\u2733",
  229: "\u2726",
  230: "\u2726",
  231: "\u2726",
  232: "\u2726",
  233: "\u2605",
  234: "\u2605",
  235: "\u2736",
  236: "\u2736",
  237: "\u2737",
  238: "\u2738",
  239: "\u2739",
  240: "\u2739",
  241: "\u2735",
  242: "\u2735",
  243: "\u272F",
  244: "\u273B",
  245: "\u2743",
  246: "\u2727",
  247: "\u2727",
  248: "\u203B",
  249: "\u2042"
};
var WINGDINGS_3 = {
  33: "\u2190",
  34: "\u2192",
  35: "\u2191",
  36: "\u2193",
  37: "\u2196",
  38: "\u2197",
  39: "\u2199",
  40: "\u2198",
  41: "\u21E4",
  42: "\u21E5",
  43: "\u2912",
  44: "\u2913",
  45: "\u2196",
  46: "\u2198",
  47: "\u21D1",
  48: "\u21D3",
  49: "\u2B64",
  50: "\u2B65",
  51: "\u21E0",
  52: "\u21E2",
  53: "\u21E1",
  54: "\u21E3",
  55: "\u21AF",
  56: "\u21B2",
  57: "\u21B3",
  58: "\u21B0",
  59: "\u21B1",
  60: "\u2B11",
  61: "\u2B0F",
  62: "\u2B10",
  63: "\u2B0E",
  64: "\u2B90",
  65: "\u2B91",
  66: "\u21B5",
  67: "\u21B4",
  68: "\u21C4",
  69: "\u2B83",
  70: "\u21E5",
  71: "\u2913",
  72: "\u21C7",
  73: "\u21C9",
  74: "\u21C8",
  75: "\u21CA",
  76: "\u21B6",
  77: "\u21B7",
  78: "\u21B6",
  79: "\u21B7",
  80: "\u21BB",
  81: "\u21BA",
  82: "\u238B",
  83: "\u2324",
  84: "\u2303",
  85: "\u2325",
  86: "\u23B5",
  87: "\u237D",
  88: "\u21EA",
  89: "\u21EA",
  90: "\u21E6",
  91: "\u21E8",
  92: "\u21E6",
  93: "\u21E8",
  94: "\u21E6",
  95: "\u21E8",
  96: "\u21E6",
  97: "\u21E8",
  98: "\u21E6",
  99: "\u21E8",
  100: "\u21E6",
  101: "\u21E8",
  102: "\u2190",
  103: "\u2192",
  104: "\u2191",
  105: "\u2193",
  106: "\u2196",
  107: "\u2197",
  108: "\u2199",
  109: "\u2198",
  110: "\u2194",
  111: "\u2195",
  112: "\u25B2",
  113: "\u25BC",
  114: "\u25B3",
  115: "\u25BD",
  116: "\u25C0",
  117: "\u25B6",
  118: "\u25C1",
  119: "\u25B7",
  120: "\u25E3",
  121: "\u25E2",
  122: "\u25E4",
  123: "\u25E5",
  124: "\u25C4",
  125: "\u25BA",
  126: "\u25B2",
  128: "\u25BA",
  129: "\u25B2",
  130: "\u25BC",
  131: "\u25C0",
  132: "\u25B6",
  133: "\u25C0",
  134: "\u25B6",
  135: "\u25B2",
  136: "\u25BC",
  137: "\u2190",
  138: "\u2192",
  139: "\u2191",
  140: "\u2193",
  141: "\u2190",
  142: "\u2192",
  143: "\u2191",
  144: "\u2193",
  145: "\u2B05",
  146: "\u27A1",
  147: "\u2B06",
  148: "\u2B07",
  149: "\u2B05",
  150: "\u27A1",
  151: "\u2B06",
  152: "\u2B07",
  153: "\u2190",
  154: "\u2192",
  155: "\u2191",
  156: "\u2193",
  157: "\u2190",
  158: "\u2192",
  159: "\u2191",
  160: "\u2193",
  161: "\u2190",
  162: "\u2192",
  163: "\u2191",
  164: "\u2193",
  165: "\u2190",
  166: "\u2192",
  167: "\u2190",
  168: "\u2192",
  169: "\u2B05",
  170: "\u27A1",
  171: "\u2B05",
  172: "\u27A1",
  173: "\u27A1",
  174: "\u27A1",
  175: "\u27A1",
  176: "\u27A1",
  177: "\u2B05",
  178: "\u27A1",
  179: "\u261C",
  180: "\u261E",
  181: "\u21E6",
  182: "\u21E8",
  183: "\u21E7",
  184: "\u21E9",
  185: "\u21A2",
  186: "\u21A3",
  187: "\u2191",
  188: "\u2193",
  189: "\u2190",
  190: "\u2192",
  191: "\u2191",
  192: "\u2193",
  193: "\u2B05",
  194: "\u27A1",
  195: "\u2B06",
  196: "\u2B07",
  197: "\u2B05",
  198: "\u27A1",
  199: "\u2B06",
  200: "\u2B07",
  201: "\u21B2",
  202: "\u21B3",
  203: "\u21B0",
  204: "\u21B1",
  205: "\u2B11",
  206: "\u2B0F",
  207: "\u2B10",
  208: "\u2B0E",
  209: "\u21E6",
  210: "\u21E8",
  211: "\u21E7",
  212: "\u21E9",
  213: "\u21D6",
  214: "\u21D7",
  215: "\u21D9",
  216: "\u21D8",
  217: "\u21E6",
  218: "\u21E8",
  219: "\u21E7",
  220: "\u21E9",
  221: "\u21D6",
  222: "\u21D7",
  223: "\u21D9",
  224: "\u21D8",
  225: "\u2B05",
  226: "\u27A1",
  227: "\u2B06",
  228: "\u2B07",
  229: "\u2B09",
  230: "\u2B08",
  231: "\u2B0B",
  232: "\u2B0A",
  233: "\u25C0",
  234: "\u25B6",
  235: "\u25B2",
  236: "\u25BC",
  237: "\u25C1",
  238: "\u25B7",
  239: "\u25B3",
  240: "\u25BD"
};
var WEBDINGS = {
  33: "\u{1F577}",
  34: "\u{1F578}",
  35: "\u{1F6AB}",
  36: "\u{1F576}",
  37: "\u{1F3C6}",
  38: "\u{1F396}",
  39: "\u{1F587}",
  40: "\u{1F5E8}",
  41: "\u{1F4AC}",
  42: "\u{1F4AC}",
  43: "\u{1F4AC}",
  44: "\u{1F336}",
  45: "\u{1F397}",
  46: "\u25A6",
  47: "/",
  48: "\u2581",
  49: "\u25A2",
  50: "\u2750",
  51: "\u23F4",
  52: "\u23F5",
  53: "\u23F6",
  54: "\u23F7",
  55: "\u23EA",
  56: "\u23E9",
  57: "\u23EE",
  58: "\u23ED",
  59: "\u23F8",
  60: "\u25A0",
  61: "\u2022",
  62: "A",
  63: "\u{1F5F3}",
  64: "\u{1F6E0}",
  65: "\u{1F3D7}",
  66: "\u{1F3D8}",
  67: "\u{1F3D9}",
  68: "\u{1F3DA}",
  69: "\u{1F3DC}",
  70: "\u{1F3ED}",
  71: "\u{1F3DB}",
  72: "\u{1F3E0}",
  73: "\u{1F3D6}",
  74: "\u{1F3DD}",
  75: "\u{1F6E3}",
  76: "\u{1F50D}",
  77: "\u{1F3D4}",
  78: "\u{1F441}",
  79: "\u{1F442}",
  80: "\u{1F3DE}",
  81: "\u{1F3D5}",
  82: "\u{1F6E4}",
  83: "\u{1F3DF}",
  84: "\u{1F6F3}",
  85: "\u{1F4E3}",
  86: "\u{1F4E2}",
  87: "\u{1F508}",
  88: "\u{1F508}",
  89: "\u2665",
  90: "\u{1F490}",
  91: "\u{1F4AD}",
  92: "\\",
  93: "\u{1F4AD}",
  94: "\u{1F4AC}",
  95: "\u{1F4AC}",
  96: "\u21BB",
  97: "\u2714",
  98: "\u{1F6B2}",
  99: "\u25A1",
  100: "\u{1F6E1}",
  101: "\u{1F4E6}",
  102: "\u{1F692}",
  103: "\u25A0",
  104: "\u{1F691}",
  105: "\u2139",
  106: "\u{1F6E9}",
  107: "\u{1F6F0}",
  108: "\u2735",
  109: "\u{1F574}",
  110: "\u25CF",
  111: "\u{1F6E5}",
  112: "\u{1F694}",
  113: "\u21BB",
  114: "\u2715",
  115: "\u2753",
  116: "\u{1F682}",
  117: "\u{1F687}",
  118: "\u{1F68D}",
  119: "\u26F3",
  120: "\u2298",
  121: "\u2296",
  122: "\u{1F6AD}",
  123: "\u{1F4AC}",
  124: "|",
  125: "\u{1F5EF}",
  126: "\u26A1",
  128: "\u{1F6B9}",
  129: "\u{1F6BA}",
  130: "\u2642",
  131: "\u2640",
  132: "\u{1F6BC}",
  133: "\u{1F47D}",
  134: "\u{1F3CB}",
  135: "\u26F7",
  136: "\u{1F3C2}",
  137: "\u{1F3CC}",
  138: "\u{1F3CA}",
  139: "\u{1F3C4}",
  140: "\u{1F3CD}",
  141: "\u{1F3CE}",
  142: "\u{1F698}",
  143: "\u{1F4C8}",
  144: "\u{1F6E2}",
  145: "\u{1F4B0}",
  146: "\u{1F3F7}",
  147: "\u{1F4B3}",
  148: "\u{1F46A}",
  149: "\u{1F5E1}",
  150: "\u{1F444}",
  151: "\u{1F5E3}",
  152: "\u272F",
  153: "\u2709",
  154: "\u2709",
  155: "\u2709",
  156: "\u2709",
  157: "\u{1F4C4}",
  158: "\u{1F4C4}",
  159: "\u{1F4C4}",
  160: "\u{1F575}",
  161: "\u{1F570}",
  162: "\u25A6",
  163: "\u2612",
  164: "\u{1F4CB}",
  165: "\u{1F5D2}",
  166: "\u{1F5D3}",
  167: "\u{1F4D6}",
  168: "\u{1F4DA}",
  169: "\u{1F5DE}",
  170: "\u{1F4C4}",
  171: "\u{1F5C3}",
  172: "\u{1F5C2}",
  173: "\u{1F5BC}",
  174: "\u{1F3AD}",
  175: "\u266B",
  176: "\u{1F3B9}",
  177: "\u{1F399}",
  178: "\u{1F3A7}",
  179: "\u{1F4BF}",
  180: "\u{1F39E}",
  181: "\u{1F4F7}",
  182: "\u{1F39F}",
  183: "\u{1F3AC}",
  184: "\u{1F4FD}",
  185: "\u{1F4F9}",
  186: "\u{1F4FB}",
  187: "\u{1F4FB}",
  188: "\u{1F39A}",
  189: "\u{1F39B}",
  190: "\u{1F4FA}",
  191: "\u{1F4BB}",
  192: "\u{1F5A5}",
  193: "\u2328",
  194: "\u{1F5A5}",
  195: "\u{1F579}",
  196: "\u{1F3AE}",
  197: "\u2706",
  198: "\u2706",
  199: "\u{1F4DF}",
  200: "\u{1F4F1}",
  201: "\u260E",
  202: "\u{1F5A8}",
  203: "\u{1F9EE}",
  204: "\u{1F4C1}",
  205: "\u{1F4BE}",
  206: "\u{1F5DC}",
  207: "\u{1F512}",
  208: "\u{1F513}",
  209: "\u{1F5DD}",
  210: "\u{1F4E5}",
  211: "\u{1F4E4}",
  212: "\u{1F573}",
  213: "\u263C",
  214: "\u{1F324}",
  215: "\u{1F325}",
  216: "\u{1F326}",
  217: "\u2601",
  218: "\u{1F327}",
  219: "\u{1F328}",
  220: "\u{1F329}",
  221: "\u{1F32A}",
  222: "\u{1F32C}",
  223: "\u{1F32B}",
  224: "\u{1F31C}",
  225: "\u{1F321}",
  226: "\u{1F6CB}",
  227: "\u{1F6CF}",
  228: "\u{1F37D}",
  229: "\u{1F378}",
  230: "\u{1F6CE}",
  231: "\u{1F6CD}",
  232: "\u24C5",
  233: "\u267F",
  234: "\u25B3",
  235: "\u{1F4CC}",
  236: "\u{1F393}",
  237: "\u2736",
  238: "\u2736",
  239: "\u2736",
  240: "\u2736",
  241: "\u2708",
  242: "\u{1F43F}",
  243: "\u{1F426}",
  244: "\u{1F41F}",
  245: "\u{1F415}",
  246: "\u{1F408}",
  247: "\u{1F680}",
  248: "\u{1F680}",
  249: "\u{1F680}",
  250: "\u{1F680}",
  251: "\u{1F5FA}",
  252: "\u{1F30D}",
  253: "\u{1F30F}",
  254: "\u{1F30E}",
  255: "\u{1F54A}"
};
var SYMBOL_FONT_MAPS = {
  symbol: SYMBOL,
  wingdings: WINGDINGS,
  "wingdings 2": WINGDINGS_2,
  "wingdings 3": WINGDINGS_3,
  webdings: WEBDINGS
};
function isSymbolFont(font) {
  return !!font && font.trim().toLowerCase() in SYMBOL_FONT_MAPS;
}
function decodeSymbolChar(font, code) {
  const map = SYMBOL_FONT_MAPS[font.trim().toLowerCase()];
  if (!map) return null;
  const low = code >= 61440 && code <= 61695 ? code - 61440 : code;
  if (low === 32) return " ";
  return map[low] ?? null;
}
var TEXT_GLYPH_RE = /^[^\p{Emoji_Presentation}\u{10000}-\u{10FFFF}]$/u;
function symbolPuaChar(charHex) {
  const code = parseInt(charHex, 16);
  return Number.isFinite(code) ? String.fromCodePoint((code & 255) + 61440) : null;
}
function symbolGlyph(font, charHex) {
  const code = parseInt(charHex, 16);
  if (!Number.isFinite(code)) return null;
  return decodeSymbolChar(font, code) ?? symbolPuaChar(charHex);
}
function toSymbolPua(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    out += code > 32 && code <= 255 ? String.fromCodePoint(61440 + code) : ch;
  }
  return out;
}
function decodeSymbolText(font, text, opts) {
  if (!isSymbolFont(font)) return null;
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code <= 32 || code === 160) {
      out += ch;
      continue;
    }
    const mapped = decodeSymbolChar(font, code);
    if (mapped === null) return null;
    if (opts?.textGlyphsOnly) {
      const ascii = mapped.codePointAt(0) < 128;
      if (!TEXT_GLYPH_RE.test(mapped) || ascii && mapped !== String.fromCharCode(code & 255))
        return null;
    }
    out += mapped;
  }
  return out;
}

// vendor/genoffice/docx/zotero-doc-props.ts
var CUSTOM_PROPERTIES_PATH = "docProps/custom.xml";
var CUSTOM_PROPERTIES_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
var CUSTOM_PROPERTIES_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
var ZOTERO_PREF_NAME = /^ZOTERO_PREF(?:_(\d+))?$/;
var PROPERTY_RE = /<(?:[A-Za-z_][\w.-]*:)?property\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?property\s*>/g;
function codePointText(match, code) {
  return code >= 0 && code <= 1114111 ? String.fromCodePoint(code) : match;
}
function decodeXmlText(value) {
  return value.replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePointText(match, parseInt(hex, 16))).replace(/&#(\d+);/g, (match, decimal) => codePointText(match, parseInt(decimal, 10))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function attrValue(xml, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(xml);
  return match ? decodeXmlText(match[1] ?? match[2] ?? "") : null;
}
function propertyText(xml) {
  const match = /<(?:[A-Za-z_][\w.-]*:)?lpwstr\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?lpwstr\s*>/.exec(xml);
  return decodeXmlText(match?.[1] ?? "");
}
function parseZoteroDocumentDataXml(xml) {
  const chunks = [];
  let legacy = "";
  for (const property of xml.match(PROPERTY_RE) ?? []) {
    const name = attrValue(property, "name");
    const match = name ? ZOTERO_PREF_NAME.exec(name) : null;
    if (!match) continue;
    const value = propertyText(property);
    if (match[1]) chunks.push({ index: Number(match[1]), value });
    else legacy = value;
  }
  if (chunks.length === 0) return legacy;
  return chunks.sort((a, b) => a.index - b.index).map((chunk) => chunk.value).join("");
}
async function readZoteroDocumentData(zip) {
  const file = zip.file(CUSTOM_PROPERTIES_PATH);
  return file ? parseZoteroDocumentDataXml(await file.async("string")) : "";
}
function patchZoteroDocumentDataXml(xml, data) {
  const original = xml ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';
  let maxPid = 1;
  for (const property of original.match(PROPERTY_RE) ?? []) {
    const pid = Number(attrValue(property, "pid"));
    if (Number.isSafeInteger(pid)) maxPid = Math.max(maxPid, pid);
  }
  const withoutOld = original.replace(PROPERTY_RE, (property) => {
    const name = attrValue(property, "name");
    return name && ZOTERO_PREF_NAME.test(name) ? "" : property;
  });
  const chunks = [];
  for (let offset = 0; offset < data.length; ) {
    let end = Math.min(offset + 255, data.length);
    if (end < data.length && /[\ud800-\udbff]/.test(data[end - 1])) end--;
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  const properties = chunks.map((value, index) => {
    const name = `ZOTERO_PREF_${index + 1}`;
    return `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${++maxPid}" name="${escapeXmlAttr(name)}"><vt:lpwstr>${escapeXmlText(value)}</vt:lpwstr></property>`;
  }).join("");
  const selfClosing = /<((?:[A-Za-z_][\w.-]*:)?Properties)\b([^>]*?)\/>/;
  const empty = selfClosing.exec(withoutOld);
  if (empty) {
    return withoutOld.replace(
      selfClosing,
      () => `<${empty[1]}${empty[2]}>${properties}</${empty[1]}>`
    );
  }
  return withoutOld.replace(
    /<\/(?:[A-Za-z_][\w.-]*:)?Properties\s*>/,
    (close) => `${properties}${close}`
  );
}

// vendor/genoffice/docx/list-markers.ts
var BULLET_GLYPHS = {
  "\uF0B7": "\u2022",
  "\uF0A7": "\u25AA",
  "\uF0D8": "\u27A2",
  "\uF076": "\u2756",
  "\uF0FC": "\u2713",
  o: "\u25E6"
};
var DEFAULT_BULLETS = ["\u2022", "\u25E6", "\u25AA", "\u2022", "\u25E6", "\u25AA", "\u2022", "\u25E6", "\u25AA"];
function toLetters(value) {
  const n = (value - 1) % 26 + 1;
  const repeat = Math.floor((value - 1) / 26) + 1;
  return String.fromCharCode(64 + n).repeat(repeat);
}
function toGreek(value, base) {
  if (value < 1) return String(value);
  const n = (value - 1) % 24 + 1;
  const repeat = Math.floor((value - 1) / 24) + 1;
  return String.fromCharCode(base + n - 1 + (n >= 18 ? 1 : 0)).repeat(repeat);
}
var ROMAN = [
  [1e3, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"]
];
function toRoman(value) {
  let n = Math.max(1, value);
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
var CN_DIGITS = ["\u96F6", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D"];
var CN_UNITS = ["", "\u5341", "\u767E", "\u5343"];
var CN_LEGAL_SIMPLIFIED = [
  "\u96F6",
  "\u58F9",
  "\u8D30",
  "\u53C1",
  "\u8086",
  "\u4F0D",
  "\u9646",
  "\u67D2",
  "\u634C",
  "\u7396"
];
var CN_LEGAL_TRADITIONAL = [
  "\u96F6",
  "\u58F9",
  "\u8CB3",
  "\u53C3",
  "\u8086",
  "\u4F0D",
  "\u9678",
  "\u67D2",
  "\u634C",
  "\u7396"
];
var CN_LEGAL_UNITS = ["", "\u62FE", "\u4F70", "\u4EDF"];
function toCjkCounting(value, digits, units, dropLeadingOne) {
  if (value <= 0 || value > 9999) return String(value);
  if (value < 10) return digits[value];
  const zero = digits[0];
  const parts = String(value).split("").map(Number);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const d = parts[i];
    const unit = units[parts.length - 1 - i];
    if (d === 0) {
      if (!out.endsWith(zero) && i < parts.length - 1) out += zero;
    } else {
      out += digits[d] + unit;
    }
  }
  out = out.replace(new RegExp(`${zero}+$`), "");
  return dropLeadingOne ? out.replace(new RegExp(`^${digits[1]}${units[1]}`), units[1]) : out;
}
function toChinese(value) {
  return toCjkCounting(value, CN_DIGITS, CN_UNITS, true);
}
function digitWise(value, digits) {
  if (value < 0) return String(value);
  const table = Array.from(digits);
  return String(value).split("").map((d) => table[Number(d)]).join("");
}
function fromAlphabet(value, alphabet, fallback = String(value)) {
  const letters = Array.from(alphabet);
  return value >= 1 && value <= letters.length ? letters[value - 1] : fallback;
}
function enclosed(value, base, count = 20) {
  return value >= 1 && value <= count ? String.fromCodePoint(base + value - 1) : String(value);
}
var FW_DIGITS = "\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19";
var IDEOGRAPH_DIGITS = "\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D";
var AIUEO_FW = "\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD\u30BF\u30C1\u30C4\u30C6\u30C8\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D2\u30D5\u30D8\u30DB\u30DE\u30DF\u30E0\u30E1\u30E2\u30E4\u30E6\u30E8\u30E9\u30EA\u30EB\u30EC\u30ED\u30EF\u30F2\u30F3";
var AIUEO_HW = "\uFF71\uFF72\uFF73\uFF74\uFF75\uFF76\uFF77\uFF78\uFF79\uFF7A\uFF7B\uFF7C\uFF7D\uFF7E\uFF7F\uFF80\uFF81\uFF82\uFF83\uFF84\uFF85\uFF86\uFF87\uFF88\uFF89\uFF8A\uFF8B\uFF8C\uFF8D\uFF8E\uFF8F\uFF90\uFF91\uFF92\uFF93\uFF94\uFF95\uFF96\uFF97\uFF98\uFF99\uFF9A\uFF9B\uFF9C\uFF66\uFF9D";
var IROHA_FW = "\u30A4\u30ED\u30CF\u30CB\u30DB\u30D8\u30C8\u30C1\u30EA\u30CC\u30EB\u30F2\u30EF\u30AB\u30E8\u30BF\u30EC\u30BD\u30C4\u30CD\u30CA\u30E9\u30E0\u30A6\u30F0\u30CE\u30AA\u30AF\u30E4\u30DE\u30B1\u30D5\u30B3\u30A8\u30C6\u30A2\u30B5\u30AD\u30E6\u30E1\u30DF\u30B7\u30F1\u30D2\u30E2\u30BB\u30B9";
var GANADA = "\uAC00\uB098\uB2E4\uB77C\uB9C8\uBC14\uC0AC\uC544\uC790\uCC28\uCE74\uD0C0\uD30C\uD558";
var CHOSUNG = "\u3131\u3134\u3137\u3139\u3141\u3142\u3145\u3147\u3148\u314A\u314B\u314C\u314D\u314E";
var RUSSIAN_LOWER = "\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u043A\u043B\u043C\u043D\u043E\u043F\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044D\u044E\u044F";
var HEAVENLY_STEMS = "\u7532\u4E59\u4E19\u4E01\u620A\u5DF1\u5E9A\u8F9B\u58EC\u7678";
var EARTHLY_BRANCHES = "\u5B50\u4E11\u5BC5\u536F\u8FB0\u5DF3\u5348\u672A\u7533\u9149\u620C\u4EA5";
var ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];
var TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
var ORDINAL_IRREGULAR = {
  One: "First",
  Two: "Second",
  Three: "Third",
  Five: "Fifth",
  Eight: "Eighth",
  Nine: "Ninth",
  Twelve: "Twelfth"
};
function cardinalWords(value) {
  if (value < 1 || value > 999999) return String(value);
  if (value < 20) return ONES[value];
  if (value < 100) return TENS[Math.floor(value / 10)] + (value % 10 ? `-${ONES[value % 10]}` : "");
  if (value < 1e3)
    return `${ONES[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${cardinalWords(value % 100)}` : ""}`;
  return `${cardinalWords(Math.floor(value / 1e3))} Thousand${value % 1e3 ? ` ${cardinalWords(value % 1e3)}` : ""}`;
}
function ordinalWords(value) {
  const words = cardinalWords(value);
  if (!/[A-Za-z]$/.test(words)) return words;
  return words.replace(/[A-Za-z]+$/, (last) => {
    if (ORDINAL_IRREGULAR[last]) return ORDINAL_IRREGULAR[last];
    if (last.endsWith("y")) return `${last.slice(0, -1)}ieth`;
    return `${last}th`;
  });
}
function ordinalSuffix(value) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
}
function customEnumItems(format) {
  const items = format.split(",").map((s) => s.trim());
  while (items.length > 0 && /^(\.{3}|…)?$/.test(items[items.length - 1])) items.pop();
  return items.length >= 2 && items.every(Boolean) ? items : null;
}
function formatNumber(rawValue, numFmt, customFormat) {
  const value = Number.isFinite(rawValue) ? Math.min(Math.floor(rawValue), 999999) : 0;
  if (numFmt === "custom") {
    const items = customFormat ? customEnumItems(customFormat) : null;
    return items && value >= 1 ? items[(value - 1) % items.length] : String(value);
  }
  switch (numFmt) {
    case "decimalZero":
      return value < 10 && value >= 0 ? `0${value}` : String(value);
    case "lowerLetter":
      return toLetters(value).toLowerCase();
    case "upperLetter":
      return toLetters(value);
    case "lowerRoman":
      return toRoman(value).toLowerCase();
    case "upperRoman":
      return toRoman(value);
    case "lowerGreek":
      return toGreek(value, 945);
    case "upperGreek":
      return toGreek(value, 913);
    case "chineseCounting":
    case "chineseCountingThousand":
    case "japaneseCounting":
    case "taiwaneseCounting":
    case "taiwaneseCountingThousand":
      return toChinese(value);
    case "chineseLegalSimplified":
      return toCjkCounting(value, CN_LEGAL_SIMPLIFIED, CN_LEGAL_UNITS, false);
    case "ideographLegalTraditional":
      return toCjkCounting(value, CN_LEGAL_TRADITIONAL, CN_LEGAL_UNITS, false);
    case "ideographDigital":
    case "japaneseDigitalTenThousand":
    case "taiwaneseDigital":
      return digitWise(value, IDEOGRAPH_DIGITS);
    case "koreanDigital":
      return digitWise(value, "\uC601\uC77C\uC774\uC0BC\uC0AC\uC624\uC721\uCE60\uD314\uAD6C");
    case "koreanDigital2":
      return digitWise(value, IDEOGRAPH_DIGITS);
    case "decimalFullWidth":
    case "decimalFullWidth2":
      return digitWise(value, FW_DIGITS);
    case "thaiNumbers":
      return digitWise(value, "\u0E50\u0E51\u0E52\u0E53\u0E54\u0E55\u0E56\u0E57\u0E58\u0E59");
    case "hindiNumbers":
      return digitWise(value, "\u0966\u0967\u0968\u0969\u096A\u096B\u096C\u096D\u096E\u096F");
    case "decimalEnclosedCircle":
    case "decimalEnclosedCircleChinese":
      return enclosed(value, 9312);
    case "decimalEnclosedParen":
      return enclosed(value, 9332);
    case "decimalEnclosedFullstop":
      return enclosed(value, 9352);
    case "ideographEnclosedCircle":
      return enclosed(value, 12928, 10);
    case "ideographTraditional":
      return fromAlphabet(value, HEAVENLY_STEMS);
    case "ideographZodiac":
      return fromAlphabet(value, EARTHLY_BRANCHES);
    case "aiueo":
      return fromAlphabet(value, AIUEO_HW);
    case "aiueoFullWidth":
      return fromAlphabet(value, AIUEO_FW);
    case "irohaFullWidth":
      return fromAlphabet(value, IROHA_FW);
    case "ganada":
      return fromAlphabet(value, GANADA);
    case "chosung":
      return fromAlphabet(value, CHOSUNG);
    case "russianLower":
      return fromAlphabet(value, RUSSIAN_LOWER);
    case "russianUpper":
      return fromAlphabet(value, RUSSIAN_LOWER.toUpperCase());
    case "ordinal":
      return ordinalSuffix(value);
    case "cardinalText":
      return cardinalWords(value);
    case "ordinalText":
      return ordinalWords(value);
    case "numberInDash":
      return `- ${value} -`;
    case "none":
      return "";
    default:
      return String(value);
  }
}
var ARABIC_FORMATS = /* @__PURE__ */ new Set(["decimal", "decimalZero"]);
function bulletInfo(text, level) {
  const font = level.font?.trim();
  if (!font || !isSymbolFont(font)) return { text };
  return { text, symbolChar: toSymbolPua(level.lvlText), symbolFont: font };
}
function computeListMarkerInfos(items, defs) {
  const counters = /* @__PURE__ */ new Map();
  const overrideApplied = /* @__PURE__ */ new Set();
  return items.map((item) => {
    const def = item.numId !== null ? defs.get(item.numId) : void 0;
    if (!def) return null;
    const lvl = Math.max(0, item.ilvl);
    const level = def.levels[lvl];
    if (!level) return null;
    if (level.numFmt === "bullet") {
      if (level.picBulletId !== void 0) {
        return level.picBulletSrc ? { text: "", picBulletSrc: level.picBulletSrc } : { text: DEFAULT_BULLETS[0] };
      }
      const decoded = level.font ? decodeSymbolText(level.font, level.lvlText) : null;
      const textFont = level.font?.trim();
      if (textFont && !isSymbolFont(textFont) && /^[^\s\uf000-\uf0ff]+$/.test(level.lvlText))
        return { text: level.lvlText, font: textFont };
      const glyph = decoded ?? BULLET_GLYPHS[level.lvlText] ?? level.lvlText;
      if (!glyph || /[-]/.test(glyph) || decoded === null && isSymbolFont(level.font))
        return bulletInfo(DEFAULT_BULLETS[lvl % 9], level);
      return bulletInfo(glyph, level);
    }
    const live = counters.get(def.abstractNumId) ?? [];
    const c = item.deleted ? [...live] : live;
    if (!item.deleted) counters.set(def.abstractNumId, c);
    const applied = item.deleted ? new Set(overrideApplied) : overrideApplied;
    for (let a = 0; a < lvl; a++) {
      if (c[a] !== void 0) continue;
      const aKey = `${def.numId}:${a}`;
      if (def.startOverrides[a] !== void 0 && !applied.has(aKey)) {
        applied.add(aKey);
        c[a] = def.startOverrides[a];
      } else c[a] = def.levels[a]?.start ?? 1;
    }
    const overrideKey = `${def.numId}:${lvl}`;
    if (def.startOverrides[lvl] !== void 0 && !applied.has(overrideKey)) {
      applied.add(overrideKey);
      c[lvl] = def.startOverrides[lvl];
    } else {
      c[lvl] = (c[lvl] ?? level.start - 1) + 1;
    }
    c.length = lvl + 1;
    const marker = level.lvlText.replace(/%(\d)/g, (_, d) => {
      const refLvl = Number(d) - 1;
      const refDef = def.levels[refLvl];
      const value = c[refLvl] ?? refDef?.start ?? 1;
      const fmt = refDef?.numFmt ?? "decimal";
      if (level.isLgl && !ARABIC_FORMATS.has(fmt)) return String(value);
      return formatNumber(value, fmt, refDef?.customFormat);
    });
    if (!marker && level.numFmt !== "none") return null;
    return { text: marker, value: c[lvl] };
  });
}
function computeListMarkers(items, defs) {
  return computeListMarkerInfos(items, defs).map((m) => m?.text ?? null);
}

// vendor/genoffice/docx/parse-package.ts
async function resolveMainDocumentPath(zip) {
  if (zip.file("word/document.xml")) return "word/document.xml";
  const rels = await parseRels(zip, "_rels/.rels");
  for (const rel of rels.values()) {
    if (!/\/officeDocument$/.test(rel.type) || rel.targetMode === "External") continue;
    const target = resolveRelationshipTargetPath("", rel.target);
    if (target && zip.file(target)) return target;
  }
  return null;
}
function resolveRelationshipTargetPath(sourcePath, target) {
  const withoutFragment = target.split("#", 1)[0];
  if (!withoutFragment || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(withoutFragment)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return null;
  }
  const sourceSlash = sourcePath.lastIndexOf("/");
  const base = sourceSlash >= 0 ? sourcePath.slice(0, sourceSlash + 1) : "";
  const normalized = decoded.replace(/\\/g, "/");
  const path = normalized.startsWith("/") ? normalized.slice(1) : `${base}${normalized}`;
  const parts = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/") || null;
}
async function parseRels(zip, path) {
  const rels = /* @__PURE__ */ new Map();
  const file = zip.file(path);
  if (!file) return rels;
  const relsXml = (await file.async("string")).replace(
    /<!DOCTYPE(?:[^>"'\x5B\x5D]|\[[\s\S]*?\]|"[^"]*"|'[^']*')*>/i,
    ""
  );
  const parsed = xmlParser.parse(relsXml);
  const root = parsed.find((n) => nameOf(n) === "Relationships");
  if (!root) return rels;
  for (const relNode of findChildren(root, "Relationship")) {
    const attrs = attrsOf(relNode);
    if (!attrs["Id"]) continue;
    rels.set(attrs["Id"], {
      target: attrs["Target"] ?? "",
      type: attrs["Type"] ?? "",
      targetMode: attrs["TargetMode"]
    });
  }
  return rels;
}
function resultTextOf(node) {
  let out = "";
  for (const child of childrenOf(node)) {
    if ("#text" in child) continue;
    const name = nameOf(child);
    if (name === "w:t") out += textOf(child);
    else if (name !== "w:instrText" && name !== "w:delInstrText" && name !== "w:delText")
      out += resultTextOf(child);
  }
  return out;
}
async function parseComments(zip) {
  const file = zip.file("word/comments.xml");
  if (!file) return [];
  const parsed = xmlParser.parse(await file.async("string"));
  const root = parsed.find((n) => nameOf(n) === "w:comments");
  if (!root) return [];
  const out = [];
  for (const node of findChildren(root, "w:comment")) {
    const attrs = attrsOf(node);
    if (!attrs["w:id"]) continue;
    const paras = findChildren(node, "w:p");
    const paraId = paras.length > 0 ? attrsOf(paras[paras.length - 1])["w14:paraId"] : void 0;
    out.push({
      id: attrs["w:id"],
      author: attrs["w:author"] ?? "",
      initials: attrs["w:initials"],
      date: attrs["w:date"],
      text: paras.map(resultTextOf).join("\n"),
      ...paraId ? { paraId } : {}
    });
  }
  const extFile = zip.file("word/commentsExtended.xml");
  if (extFile) {
    const extXml = await extFile.async("string");
    const byParaId = new Map(out.filter((c) => c.paraId).map((c) => [c.paraId, c]));
    for (const m of extXml.match(/<w15:commentEx [^>]*\/>/g) ?? []) {
      const paraId = /w15:paraId="([^"]+)"/.exec(m)?.[1];
      const parentParaId = /w15:paraIdParent="([^"]+)"/.exec(m)?.[1];
      const done = /w15:done="(?:1|true)"/.test(m);
      const c = paraId ? byParaId.get(paraId) : void 0;
      if (!c) continue;
      if (done) c.done = true;
      if (parentParaId) {
        const parent = byParaId.get(parentParaId);
        if (parent) c.parentId = parent.id;
      }
    }
  }
  return out;
}
async function parseProtection(zip) {
  const file = zip.file("word/settings.xml");
  if (!file) return null;
  const xml = await file.async("string");
  const tag2 = /<w:documentProtection\b[^>]*?(?:\/>|>)/.exec(xml)?.[0];
  if (!tag2) return null;
  const editMatch = /w:edit=(?:"([^"]+)"|'([^']+)')/.exec(tag2);
  const edit = editMatch?.[1] ?? editMatch?.[2];
  if (!edit || edit === "none") return null;
  const enforcementMatch = /w:enforcement=(?:"([^"]+)"|'([^']+)')/.exec(tag2);
  const enforcement = enforcementMatch?.[1] ?? enforcementMatch?.[2];
  const hashMatch = /w:hash=(?:"([^"]+)"|'([^']+)')/.exec(tag2);
  const hash = hashMatch?.[1] ?? hashMatch?.[2];
  const saltMatch = /w:salt=(?:"([^"]+)"|'([^']+)')/.exec(tag2);
  const salt = saltMatch?.[1] ?? saltMatch?.[2];
  const spinMatch = /w:cryptSpinCount=(?:"(\d+)"|'(\d+)')/.exec(tag2);
  const spin = spinMatch?.[1] ?? spinMatch?.[2];
  const sidMatch = /w:cryptAlgorithmSid=(?:"(\d+)"|'(\d+)')/.exec(tag2);
  const sid = sidMatch?.[1] ?? sidMatch?.[2];
  return {
    edit,
    enforced: enforcement === "1" || enforcement === "true" || enforcement === "on",
    ...hash ? { hash } : {},
    ...salt ? { salt } : {},
    ...spin ? { spinCount: parseInt(spin, 10) } : {},
    ...sid ? { algorithmSid: parseInt(sid, 10) } : {}
  };
}
async function parseWriteProtection(zip) {
  const file = zip.file("word/settings.xml");
  if (!file) return null;
  const tag2 = /<w:writeProtection\b[^>]*?(?:\/>|>)/.exec(await file.async("string"))?.[0];
  if (!tag2) return null;
  const recommended = /w:recommended=(?:"(?:1|true|on)"|'(?:1|true|on)')/.test(tag2);
  const hashMatch = /w:hash=(?:"([^"]+)"|'([^']+)')/.exec(tag2);
  const hash = hashMatch?.[1] ?? hashMatch?.[2];
  const saltMatch = /w:salt=(?:"([^"]+)"|'([^']+)')/.exec(tag2);
  const salt = saltMatch?.[1] ?? saltMatch?.[2];
  const spinMatch = /w:cryptSpinCount=(?:"(\d+)"|'(\d+)')/.exec(tag2);
  const spin = spinMatch?.[1] ?? spinMatch?.[2];
  const sidMatch = /w:cryptAlgorithmSid=(?:"(\d+)"|'(\d+)')/.exec(tag2);
  const sid = sidMatch?.[1] ?? sidMatch?.[2];
  if (!recommended && !hash) return null;
  return {
    ...recommended ? { recommended } : {},
    ...hash ? { hash } : {},
    ...salt ? { salt } : {},
    ...spin ? { spinCount: parseInt(spin, 10) } : {},
    ...sid ? { algorithmSid: parseInt(sid, 10) } : {}
  };
}
async function parseRemovePersonalInfo(zip) {
  const file = zip.file("word/settings.xml");
  if (!file) return false;
  const xml = await file.async("string");
  const prefixes = /* @__PURE__ */ new Set();
  const namespace = /\bxmlns(?::([A-Za-z_][\w.-]*))?\s*=\s*(["'])([^"']*)\2/g;
  let declaration;
  while ((declaration = namespace.exec(xml)) !== null) {
    if (declaration[3] === "http://schemas.openxmlformats.org/wordprocessingml/2006/main" || declaration[3] === "http://purl.oclc.org/ooxml/wordprocessingml/main") {
      prefixes.add(declaration[1] ?? "");
    }
  }
  const escapedPrefixes = [...prefixes].filter(Boolean).map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const prefix of prefixes) {
    const qName = prefix ? `${prefix}:removePersonalInformation` : "removePersonalInformation";
    const escapedName = qName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tag2 = new RegExp(`<${escapedName}\\b[^>]*(?:\\/\\s*>|>\\s*<\\/${escapedName}\\s*>)`).exec(
      xml
    )?.[0];
    if (!tag2) continue;
    const valPrefix = escapedPrefixes.length > 0 ? `(?:${escapedPrefixes.join("|")}):` : "";
    const val2 = new RegExp(`(?:^|\\s)(?:${valPrefix})?val\\s*=\\s*(["'])(0|false)\\1`, "i");
    return !val2.test(tag2);
  }
  return false;
}
function numFmtOfLevel(lvlNode) {
  const direct = findChild(lvlNode, "w:numFmt");
  if (direct) return { numFmt: attrsOf(direct)["w:val"] };
  const alt = childrenOf(lvlNode).find((c) => nameOf(c)?.endsWith(":AlternateContent"));
  if (!alt) return {};
  const pick = (local) => childrenOf(alt).find((c) => nameOf(c)?.endsWith(`:${local}`));
  const choice = attrsOf(findChild(pick("Choice") ?? {}, "w:numFmt") ?? {});
  const format = choice["w:format"];
  if (choice["w:val"] === "custom" && format && customEnumItems(format))
    return { numFmt: "custom", customFormat: format };
  if (choice["w:val"] && choice["w:val"] !== "custom") return { numFmt: choice["w:val"] };
  return { numFmt: attrsOf(findChild(pick("Fallback") ?? {}, "w:numFmt") ?? {})["w:val"] };
}
function parseNumberingLevel(lvlNode) {
  const start = parseInt(attrsOf(findChild(lvlNode, "w:start") ?? {})["w:val"] ?? "0", 10);
  const { numFmt, customFormat } = numFmtOfLevel(lvlNode);
  const level = {
    numFmt: numFmt ?? "decimal",
    lvlText: decodeNumericCharRefs(attrsOf(findChild(lvlNode, "w:lvlText") ?? {})["w:val"] ?? ""),
    start: Number.isFinite(start) ? start : 0
  };
  if (customFormat) level.customFormat = customFormat;
  const suff = attrsOf(findChild(lvlNode, "w:suff") ?? {})["w:val"];
  if (suff === "space" || suff === "nothing" || suff === "tab") level.suff = suff;
  const isLgl = findChild(lvlNode, "w:isLgl");
  if (isLgl && !["0", "false", "off"].includes(attrsOf(isLgl)["w:val"] ?? "")) level.isLgl = true;
  const lvlJc = attrsOf(findChild(lvlNode, "w:lvlJc") ?? {})["w:val"];
  if (lvlJc === "right" || lvlJc === "end") level.lvlJc = "right";
  else if (lvlJc === "center") level.lvlJc = "center";
  const pStyle = attrsOf(findChild(lvlNode, "w:pStyle") ?? {})["w:val"];
  if (pStyle) level.pStyle = pStyle;
  const lvlRestart = parseInt(attrsOf(findChild(lvlNode, "w:lvlRestart") ?? {})["w:val"] ?? "", 10);
  if (Number.isFinite(lvlRestart)) level.lvlRestart = lvlRestart;
  const lvlPPr = findChild(lvlNode, "w:pPr");
  const tabs = lvlPPr ? findChild(lvlPPr, "w:tabs") : void 0;
  const tabPos = tabs ? parseInt(attrsOf(findChild(tabs, "w:tab") ?? {})["w:pos"] ?? "", 10) : NaN;
  if (Number.isFinite(tabPos)) level.tabStop = tabPos;
  const ind = lvlPPr ? findChild(lvlPPr, "w:ind") : void 0;
  if (ind) {
    const attrs = attrsOf(ind);
    const left = parseInt(attrs["w:left"] ?? attrs["w:start"] ?? "", 10);
    if (left >= 0) level.indentLeft = left;
    const hanging = parseInt(attrs["w:hanging"] ?? "", 10);
    if (hanging > 0) level.hanging = hanging;
    const firstLine = parseInt(attrs["w:firstLine"] ?? "", 10);
    if (!level.hanging && firstLine >= 0) level.firstLine = firstLine;
  }
  const lvlRPr = findChild(lvlNode, "w:rPr");
  const sz = lvlRPr ? parseInt(attrsOf(findChild(lvlRPr, "w:sz") ?? {})["w:val"] ?? "", 10) : NaN;
  if (sz > 0) level.szHalfPoints = sz;
  const color = lvlRPr ? attrsOf(findChild(lvlRPr, "w:color") ?? {})["w:val"] : void 0;
  if (color && /^[0-9a-f]{6}$/i.test(color)) level.color = color.toUpperCase();
  const flag = (name) => {
    const el = lvlRPr ? findChild(lvlRPr, name) : void 0;
    return !!el && !["0", "false", "off"].includes(attrsOf(el)["w:val"] ?? "");
  };
  if (flag("w:b")) level.bold = true;
  if (flag("w:i")) level.italic = true;
  const fonts = lvlRPr ? attrsOf(findChild(lvlRPr, "w:rFonts") ?? {}) : {};
  const font = fonts["w:ascii"] ?? fonts["w:hAnsi"] ?? fonts["w:eastAsia"];
  if (font) level.font = font;
  const picId = parseInt(attrsOf(findChild(lvlNode, "w:lvlPicBulletId") ?? {})["w:val"] ?? "", 10);
  if (Number.isFinite(picId)) level.picBulletId = picId;
  return level;
}
function picBulletRId(node) {
  for (const child of childrenOf(node)) {
    if ("#text" in child) continue;
    const name = nameOf(child);
    if (name === "v:imagedata") return attrsOf(child)["r:id"];
    if (name === "a:blip") return attrsOf(child)["r:embed"];
    const nested = picBulletRId(child);
    if (nested) return nested;
  }
  return void 0;
}
async function parseNumbering(zip) {
  const formats = /* @__PURE__ */ new Map();
  const defs = /* @__PURE__ */ new Map();
  const picBullets = /* @__PURE__ */ new Map();
  const file = zip.file("word/numbering.xml");
  if (!file) return { formats, defs, picBullets };
  const parsed = xmlParser.parse(await file.async("string"));
  const root = parsed.find((n) => nameOf(n) === "w:numbering");
  if (!root) return { formats, defs, picBullets };
  for (const pic of findChildren(root, "w:numPicBullet")) {
    const id = parseInt(attrsOf(pic)["w:numPicBulletId"] ?? "", 10);
    const rId = picBulletRId(pic);
    if (Number.isFinite(id) && rId) picBullets.set(id, rId);
  }
  const absLevels = /* @__PURE__ */ new Map();
  const numStyleLinks = /* @__PURE__ */ new Map();
  const styleLinkAbs = /* @__PURE__ */ new Map();
  for (const abs of findChildren(root, "w:abstractNum")) {
    const absId = attrsOf(abs)["w:abstractNumId"];
    if (!absId) continue;
    const levels = {};
    for (const lvl of findChildren(abs, "w:lvl")) {
      const ilvl = parseInt(attrsOf(lvl)["w:ilvl"] ?? "", 10);
      if (Number.isFinite(ilvl)) levels[ilvl] = parseNumberingLevel(lvl);
    }
    absLevels.set(absId, levels);
    const numStyleLink = attrsOf(findChild(abs, "w:numStyleLink") ?? {})["w:val"];
    if (numStyleLink) numStyleLinks.set(absId, numStyleLink);
    const styleLink = attrsOf(findChild(abs, "w:styleLink") ?? {})["w:val"];
    if (styleLink) styleLinkAbs.set(styleLink, absId);
  }
  for (const absId of numStyleLinks.keys()) {
    const seen = /* @__PURE__ */ new Set([absId]);
    let target = absId;
    for (; ; ) {
      const styleId = numStyleLinks.get(target);
      const next = styleId !== void 0 ? styleLinkAbs.get(styleId) : void 0;
      if (next === void 0 || seen.has(next)) break;
      seen.add(next);
      target = next;
    }
    if (target !== absId) {
      absLevels.set(absId, { ...absLevels.get(target), ...absLevels.get(absId) });
    }
  }
  for (const num2 of findChildren(root, "w:num")) {
    const numId = attrsOf(num2)["w:numId"];
    const absId = attrsOf(findChild(num2, "w:abstractNumId") ?? {})["w:val"];
    if (!numId || !absId) continue;
    const levels = { ...absLevels.get(absId) ?? {} };
    const startOverrides = {};
    for (const over of findChildren(num2, "w:lvlOverride")) {
      const ilvl = parseInt(attrsOf(over)["w:ilvl"] ?? "", 10);
      if (!Number.isFinite(ilvl)) continue;
      const startVal = attrsOf(findChild(over, "w:startOverride") ?? {})["w:val"];
      if (startVal !== void 0) {
        const n = parseInt(startVal, 10);
        if (Number.isFinite(n)) startOverrides[ilvl] = n;
      }
      const lvl = findChild(over, "w:lvl");
      if (lvl) levels[ilvl] = parseNumberingLevel(lvl);
    }
    defs.set(numId, { numId, abstractNumId: absId, levels, startOverrides });
    formats.set(numId, levels[0]?.numFmt === "bullet" ? "bullet" : "ordered");
  }
  return { formats, defs, picBullets };
}

// vendor/genoffice/docx/font-table.ts
var FONT_TABLE_PART_PATH = "word/fontTable.xml";
function parseFontTable(xml) {
  let parsed;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return [];
  }
  const root = parsed.find((n) => nameOf(n) === "w:fonts");
  if (!root) return [];
  const out = [];
  for (const node of childrenOf(root)) {
    if (nameOf(node) !== "w:font") continue;
    const name = attrsOf(node)["w:name"];
    if (!name) continue;
    const val2 = (tag2) => attrsOf(findChild(node, tag2) ?? {})["w:val"] || void 0;
    const entry = { name };
    const altName = val2("w:altName");
    if (altName) entry.altName = altName;
    const panose = val2("w:panose1");
    if (panose) entry.panose = panose;
    const family = val2("w:family");
    if (family) entry.family = family;
    const pitch = val2("w:pitch");
    if (pitch) entry.pitch = pitch;
    const embedded = parseEmbedSlots(node);
    if (embedded) entry.embedded = embedded;
    out.push(entry);
  }
  return out;
}
var EMBED_SLOTS = [
  ["w:embedRegular", "regular"],
  ["w:embedBold", "bold"],
  ["w:embedItalic", "italic"],
  ["w:embedBoldItalic", "boldItalic"]
];
function parseEmbedSlots(font) {
  let out;
  for (const [tag2, slot2] of EMBED_SLOTS) {
    const attrs = attrsOf(findChild(font, tag2) ?? {});
    const rId = attrs["r:id"];
    if (!rId) continue;
    const ref = { rId };
    if (attrs["w:fontKey"]) ref.fontKey = attrs["w:fontKey"];
    (out ??= {})[slot2] = ref;
  }
  return out;
}
var SFNT_MAGICS = /* @__PURE__ */ new Set([65536, 1330926671, 1953658213]);
function isSfnt(bytes) {
  if (bytes.length < 12) return false;
  const magic = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
  return SFNT_MAGICS.has(magic);
}
function sfntLineMetrics(bytes) {
  if (!isSfnt(bytes)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = dv.getUint16(4);
  let unitsPerEm = 0;
  let hhea = -1;
  for (let t = 0; t < numTables; t++) {
    const rec = 12 + 16 * t;
    if (rec + 16 > bytes.length) return null;
    const tag2 = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
    const off = dv.getUint32(rec + 8);
    const len = dv.getUint32(rec + 12);
    if (tag2 === "head" && len >= 20 && off + 20 <= bytes.length) unitsPerEm = dv.getUint16(off + 18);
    if (tag2 === "hhea" && len >= 10 && off + 10 <= bytes.length) hhea = off;
  }
  if (unitsPerEm === 0 || hhea < 0) return null;
  return {
    ascent: dv.getInt16(hhea + 4) / unitsPerEm,
    descent: -dv.getInt16(hhea + 6) / unitsPerEm,
    lineGap: dv.getInt16(hhea + 8) / unitsPerEm
  };
}
function deobfuscateOdttf(bytes, fontKey) {
  const hex = fontKey?.replace(/[^0-9a-f]/gi, "") ?? "";
  if (hex.length !== 32 || /^0+$/.test(hex) || isSfnt(bytes)) return bytes;
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const out = bytes.slice();
  const n = Math.min(32, out.length);
  for (let i = 0; i < n; i++) out[i] ^= key[15 - i % 16];
  return out;
}
var FONT_TABLE_RELS_PATH = "word/_rels/fontTable.xml.rels";
async function readEmbeddedFonts(zip, fontTable) {
  if (!fontTable.some((e) => e.embedded)) return [];
  const rels = await parseRels(zip, FONT_TABLE_RELS_PATH);
  const out = [];
  for (const entry of fontTable) {
    for (const [slot2, ref] of Object.entries(entry.embedded ?? {})) {
      const rel = rels.get(ref.rId);
      if (!rel || rel.targetMode === "External") continue;
      const path = resolveRelationshipTargetPath(FONT_TABLE_PART_PATH, rel.target);
      if (!path) continue;
      const file = zip.file(path);
      if (!file) continue;
      const data = deobfuscateOdttf(await file.async("uint8array"), ref.fontKey);
      if (!isSfnt(data)) continue;
      const lineMetrics = sfntLineMetrics(data);
      out.push({
        family: entry.name,
        bold: slot2 === "bold" || slot2 === "boldItalic",
        italic: slot2 === "italic" || slot2 === "boldItalic",
        data,
        ...lineMetrics ? { lineMetrics } : {}
      });
    }
  }
  return out;
}

// vendor/genoffice/docx/types.ts
var TOTAL_PAGES_MARK = "\uE000";
var PAGE_MARK = "\uE001";

// vendor/genoffice/docx/zip-load.ts
import JSZip2 from "jszip";

// vendor/genoffice/docx/ooxml-normalize.ts
var T = "http://schemas.openxmlformats.org/";
var S = "http://purl.oclc.org/ooxml/";
var MS = "http://schemas.microsoft.com/office/";
var STRICT_TO_TRANSITIONAL = /* @__PURE__ */ new Map([
  [`${S}wordprocessingml/main`, `${T}wordprocessingml/2006/main`],
  [`${S}officeDocument/relationships`, `${T}officeDocument/2006/relationships`],
  [`${S}officeDocument/math`, `${T}officeDocument/2006/math`],
  [`${S}officeDocument/extendedProperties`, `${T}officeDocument/2006/extended-properties`],
  [`${S}officeDocument/customProperties`, `${T}officeDocument/2006/custom-properties`],
  [`${S}officeDocument/docPropsVTypes`, `${T}officeDocument/2006/docPropsVTypes`],
  [`${S}officeDocument/bibliography`, `${T}officeDocument/2006/bibliography`],
  [`${S}officeDocument/characteristics`, `${T}officeDocument/2006/characteristics`],
  [`${S}officeDocument/customXml`, `${T}officeDocument/2006/customXml`],
  [`${S}schemaLibrary/main`, `${T}schemaLibrary/2006/main`],
  [`${S}drawingml/main`, `${T}drawingml/2006/main`],
  [`${S}drawingml/wordprocessingDrawing`, `${T}drawingml/2006/wordprocessingDrawing`],
  [`${S}drawingml/spreadsheetDrawing`, `${T}drawingml/2006/spreadsheetDrawing`],
  [`${S}drawingml/picture`, `${T}drawingml/2006/picture`],
  [`${S}drawingml/chart`, `${T}drawingml/2006/chart`],
  [`${S}drawingml/chartDrawing`, `${T}drawingml/2006/chartDrawing`],
  [`${S}drawingml/diagram`, `${T}drawingml/2006/diagram`],
  [`${S}drawingml/lockedCanvas`, `${T}drawingml/2006/lockedCanvas`],
  [`${S}drawingml/compatibility`, `${T}drawingml/2006/compatibility`]
]);
var STRICT_REL_BASE = `${S}officeDocument/relationships/`;
var TRANSITIONAL_REL_BASE = `${T}officeDocument/2006/relationships/`;
var REL_TAIL = {
  extendedProperties: "extended-properties",
  customProperties: "custom-properties"
};
var W_URI = `${T}wordprocessingml/2006/main`;
var A_URI = `${T}drawingml/2006/main`;
var WP_URI = `${T}drawingml/2006/wordprocessingDrawing`;
var WPS_URI = `${MS}word/2010/wordprocessingShape`;
var MC_URI = `${T}markup-compatibility/2006`;
var CANONICAL_PREFIX_BY_URI = /* @__PURE__ */ new Map([
  [W_URI, "w"],
  [`${T}officeDocument/2006/relationships`, "r"],
  [`${T}officeDocument/2006/math`, "m"],
  [A_URI, "a"],
  [WP_URI, "wp"],
  [`${T}drawingml/2006/picture`, "pic"],
  [`${T}drawingml/2006/chart`, "c"],
  [`${T}drawingml/2006/diagram`, "dgm"],
  [`${T}drawingml/2006/lockedCanvas`, "lc"],
  [MC_URI, "mc"],
  [WPS_URI, "wps"],
  [`${MS}word/2010/wordprocessingGroup`, "wpg"],
  [`${MS}word/2010/wordprocessingCanvas`, "wpc"],
  [`${MS}word/2010/wordml`, "w14"],
  [`${MS}word/2012/wordml`, "w15"],
  ["urn:schemas-microsoft-com:vml", "v"],
  ["urn:schemas-microsoft-com:office:office", "o"],
  ["urn:schemas-microsoft-com:office:word", "w10"]
]);
var PT_PER_UNIT = {
  pt: 1,
  in: 72,
  pc: 12,
  pi: 12,
  cm: 72 / 2.54,
  mm: 72 / 25.4
};
var MEASURE_RE = /^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|pc|pi)$/;
var TWIPS = 20;
var HALF_POINTS = 2;
var EIGHTH_POINTS = 8;
var POINTS = 1;
var MARGIN_OR_BORDER = { w: TWIPS, sz: EIGHTH_POINTS, space: POINTS };
var MEASURE_ATTRS = /* @__PURE__ */ new Map([
  ["pgSz", { w: TWIPS, h: TWIPS }],
  [
    "pgMar",
    {
      top: TWIPS,
      right: TWIPS,
      bottom: TWIPS,
      left: TWIPS,
      header: TWIPS,
      footer: TWIPS,
      gutter: TWIPS
    }
  ],
  [
    "ind",
    { left: TWIPS, right: TWIPS, start: TWIPS, end: TWIPS, firstLine: TWIPS, hanging: TWIPS }
  ],
  ["spacing", { before: TWIPS, after: TWIPS, line: TWIPS, val: TWIPS }],
  ["tab", { pos: TWIPS }],
  ["defaultTabStop", { val: TWIPS }],
  ["cols", { space: TWIPS }],
  ["col", { w: TWIPS, space: TWIPS }],
  ["tblInd", { w: TWIPS }],
  ["tblW", { w: TWIPS }],
  ["tcW", { w: TWIPS }],
  ["tblCellSpacing", { w: TWIPS }],
  ["object", { dxaOrig: TWIPS, dyaOrig: TWIPS }],
  ["trHeight", { val: TWIPS }],
  ["framePr", { w: TWIPS, h: TWIPS, x: TWIPS, y: TWIPS, hSpace: TWIPS, vSpace: TWIPS }],
  [
    "tblpPr",
    {
      leftFromText: TWIPS,
      rightFromText: TWIPS,
      topFromText: TWIPS,
      bottomFromText: TWIPS,
      tblpX: TWIPS,
      tblpY: TWIPS
    }
  ],
  ["sz", { val: HALF_POINTS }],
  ["szCs", { val: HALF_POINTS }],
  ["kern", { val: HALF_POINTS }],
  ["position", { val: HALF_POINTS }],
  ["hps", { val: HALF_POINTS }],
  ["hpsRaise", { val: HALF_POINTS }],
  ["hpsBaseText", { val: HALF_POINTS }],
  // cell margins (w) and borders (sz/space) share these element names
  ["top", MARGIN_OR_BORDER],
  ["bottom", MARGIN_OR_BORDER],
  ["left", MARGIN_OR_BORDER],
  ["right", MARGIN_OR_BORDER],
  ["start", MARGIN_OR_BORDER],
  ["end", MARGIN_OR_BORDER],
  ["between", MARGIN_OR_BORDER],
  ["bar", MARGIN_OR_BORDER],
  ["insideH", MARGIN_OR_BORDER],
  ["insideV", MARGIN_OR_BORDER],
  ["tl2br", MARGIN_OR_BORDER],
  ["tr2bl", MARGIN_OR_BORDER]
]);
function convertMeasure(value, factor) {
  const m = MEASURE_RE.exec(value);
  if (!m) return value;
  const converted = parseFloat(m[1]) * PT_PER_UNIT[m[2]] * factor;
  if (!Number.isFinite(converted)) return value;
  return String(Math.round(converted));
}
function mapUriValue(value) {
  const direct = STRICT_TO_TRANSITIONAL.get(value);
  if (direct) return direct;
  if (value.startsWith(STRICT_REL_BASE)) {
    const tail = value.slice(STRICT_REL_BASE.length);
    return TRANSITIONAL_REL_BASE + (REL_TAIL[tail] ?? tail);
  }
  return value;
}
var XMLNS_DECL_RE = /xmlns(?::([A-Za-z_][\w.-]*))?\s*=\s*(["'])([^"']*)\2/g;
function needsOoxmlNormalization(xml) {
  if (xml.includes(S)) return true;
  XMLNS_DECL_RE.lastIndex = 0;
  let m;
  while ((m = XMLNS_DECL_RE.exec(xml)) !== null) {
    const canonical = CANONICAL_PREFIX_BY_URI.get(m[3]);
    if (canonical !== void 0 && canonical !== (m[1] ?? "")) return true;
  }
  return false;
}
var TAG_NAME_RE = /^<\/?\s*([^\s/>]+)/;
var ATTR_RE2 = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function splitQName(name) {
  const i = name.indexOf(":");
  return i < 0 ? ["", name] : [name.slice(0, i), name.slice(i + 1)];
}
function normalizeOoxmlXml(xml) {
  const bindings = [/* @__PURE__ */ new Map()];
  const renames = [/* @__PURE__ */ new Map()];
  const outBindings = [/* @__PURE__ */ new Map()];
  const frames = [];
  let wspDepth = 0;
  const lookup = (stack, key) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const v = stack[i].get(key);
      if (v !== void 0) return v;
    }
    return void 0;
  };
  const renamePrefix = (prefix) => lookup(renames, prefix) ?? prefix;
  let out = "";
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) break;
    out += xml.slice(cursor, start);
    const specialEnd = xml.startsWith("<!--", start) ? "-->" : xml.startsWith("<![CDATA[", start) ? "]]>" : xml.startsWith("<?", start) ? "?>" : xml.startsWith("<!", start) ? ">" : null;
    if (specialEnd !== null) {
      const at = xml.indexOf(specialEnd, start + 2);
      const end2 = at < 0 ? xml.length : at + specialEnd.length;
      out += xml.slice(start, end2);
      cursor = end2;
      continue;
    }
    let quote = "";
    let end = start + 1;
    for (; end < xml.length; end += 1) {
      const ch = xml[end];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
    }
    if (end >= xml.length) {
      out += xml.slice(start);
      cursor = xml.length;
      continue;
    }
    const tag2 = xml.slice(start, end + 1);
    cursor = end + 1;
    if (tag2.startsWith("</")) {
      const frame = frames.pop();
      if (frame) {
        out += `</${frame.name}>`;
        if (frame.scoped) {
          bindings.pop();
          renames.pop();
          outBindings.pop();
        }
        if (frame.wspScope) wspDepth -= 1;
      } else {
        out += tag2;
      }
      continue;
    }
    const selfClosing = /\/\s*>$/.test(tag2);
    const name = TAG_NAME_RE.exec(tag2)?.[1];
    if (!name) {
      out += tag2;
      continue;
    }
    const attrs = [];
    ATTR_RE2.lastIndex = TAG_NAME_RE.exec(tag2)[0].length;
    let am;
    while ((am = ATTR_RE2.exec(tag2)) !== null) {
      attrs.push({ name: am[1], value: am[2] ?? am[3] ?? "" });
    }
    const newBindings = /* @__PURE__ */ new Map();
    const declByPrefix = /* @__PURE__ */ new Map();
    for (const attr of attrs) {
      if (attr.name !== "xmlns" && !attr.name.startsWith("xmlns:")) continue;
      attr.value = mapUriValue(attr.value);
      const declPrefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
      newBindings.set(declPrefix, attr.value);
      declByPrefix.set(declPrefix, attr);
    }
    let scoped = false;
    if (newBindings.size > 0) {
      scoped = true;
      bindings.push(newBindings);
      const newRenames = /* @__PURE__ */ new Map();
      renames.push(newRenames);
      const newOut = /* @__PURE__ */ new Map();
      outBindings.push(newOut);
      const drop = /* @__PURE__ */ new Set();
      const inject = [];
      for (const [prefix2, uri] of newBindings) {
        const canonical = CANONICAL_PREFIX_BY_URI.get(uri);
        if (canonical === void 0 || canonical === prefix2) newOut.set(prefix2, uri);
      }
      for (const [prefix2, uri] of newBindings) {
        const canonical = CANONICAL_PREFIX_BY_URI.get(uri);
        if (canonical === void 0 || canonical === prefix2) continue;
        const bound = lookup(outBindings, canonical);
        if (bound !== void 0 && bound !== uri) {
          newOut.set(prefix2, uri);
          continue;
        }
        newRenames.set(prefix2, canonical);
        const decl = declByPrefix.get(prefix2);
        if (bound === uri) {
          if (prefix2 !== "") drop.add(decl);
        } else if (prefix2 === "") {
          inject.push({ name: `xmlns:${canonical}`, value: uri });
        } else {
          decl.name = `xmlns:${canonical}`;
        }
        newOut.set(canonical, uri);
        if (prefix2 === "") newOut.set("", uri);
      }
      if (drop.size > 0 || inject.length > 0) {
        attrs.splice(0, attrs.length, ...attrs.filter((a) => !drop.has(a)), ...inject);
      }
    }
    const [prefix, local] = splitQName(name);
    const elementUri = lookup(bindings, prefix);
    let targetPrefix = renamePrefix(prefix);
    if (wspDepth > 0 && elementUri === WP_URI) {
      targetPrefix = "wps";
      if (lookup(outBindings, "wps") !== WPS_URI) {
        attrs.push({ name: "xmlns:wps", value: WPS_URI });
        if (!scoped) {
          scoped = true;
          bindings.push(/* @__PURE__ */ new Map());
          renames.push(/* @__PURE__ */ new Map());
          outBindings.push(/* @__PURE__ */ new Map());
        }
        outBindings[outBindings.length - 1].set("wps", WPS_URI);
      }
    }
    const newName = targetPrefix === "" ? local : `${targetPrefix}:${local}`;
    const inWNs = elementUri === W_URI;
    const factors = inWNs ? MEASURE_ATTRS.get(local) : void 0;
    const kept = [];
    for (const attr of attrs) {
      if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) {
        kept.push(attr);
        continue;
      }
      const [ap, al] = splitQName(attr.name);
      if (inWNs && local === "document" && al === "conformance") continue;
      if (ap !== "" && ap !== "xml") {
        const np = renamePrefix(ap);
        if (np !== ap) attr.name = `${np}:${al}`;
      }
      const mceList = (al === "Ignorable" || al === "MustUnderstand") && lookup(bindings, ap) === MC_URI ? true : al === "Requires" && ap === "" && elementUri === MC_URI;
      if (mceList) {
        attr.value = attr.value.split(/\s+/).map((p) => renamePrefix(p)).join(" ");
      } else {
        attr.value = mapUriValue(attr.value);
        const factor = factors?.[al];
        if (factor !== void 0 && (ap === "" || lookup(bindings, ap) === W_URI)) {
          attr.value = convertMeasure(attr.value, factor);
        }
      }
      kept.push(attr);
    }
    const attrText = kept.map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
    out += `<${newName}${attrText}${selfClosing ? "/>" : ">"}`;
    const wspScope = !selfClosing && local === "graphicData" && elementUri === A_URI ? attrs.some((a) => a.name === "uri" && a.value === WPS_URI) : false;
    if (wspScope) wspDepth += 1;
    if (selfClosing) {
      if (scoped) {
        bindings.pop();
        renames.pop();
        outBindings.pop();
      }
    } else {
      frames.push({ name: newName, scoped, wspScope });
    }
  }
  out += xml.slice(cursor);
  return out;
}

// vendor/genoffice/docx/zip-load.ts
var EOCD_SIG2 = 101010256;
var CENTRAL_SIG2 = 33639248;
var UNICODE_PATH_ID = 28789;
function neutralizeUnicodePathFields(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD_SIG2) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return bytes;
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 65535 || cdOffset === 4294967295) return bytes;
  let out = null;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIG2) return out ?? bytes;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let q = p + 46 + nameLen;
    const extraEnd = Math.min(q + extraLen, bytes.length);
    while (q + 4 <= extraEnd) {
      const fieldId = view.getUint16(q, true);
      const fieldLen = view.getUint16(q + 2, true);
      if (fieldId === UNICODE_PATH_ID) {
        out ??= new Uint8Array(bytes);
        out[q] = 255;
        out[q + 1] = 255;
      }
      q += 4 + fieldLen;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out ?? bytes;
}
function assertZipWithinLimits(zip) {
  const files = Object.values(zip.files).filter((f) => !f.dir);
  assertDeclaredSizesWithinLimits(
    files.map((file) => ({
      name: file.name,
      usize: file._data?.uncompressedSize ?? 0
    }))
  );
}
var NORMALIZE_GATE_PARTS = ["word/document.xml", "word/_rels/document.xml.rels", "_rels/.rels"];
async function normalizeOoxmlParts(zip) {
  let needed = false;
  for (const path of NORMALIZE_GATE_PARTS) {
    const file = zip.file(path);
    if (file && needsOoxmlNormalization(await file.async("string"))) {
      needed = true;
      break;
    }
  }
  if (!needed) return;
  for (const file of Object.values(zip.files)) {
    if (file.dir || !/\.(xml|rels)$/i.test(file.name)) continue;
    const xml = await file.async("string");
    if (needsOoxmlNormalization(xml)) zip.file(file.name, normalizeOoxmlXml(xml));
  }
}
async function loadDocxZip(bytes) {
  const prepared = neutralizeUnicodePathFields(bytes);
  await assertZipInflatesWithinLimits(prepared);
  const zip = await JSZip2.loadAsync(prepared);
  assertZipWithinLimits(zip);
  for (const file of Object.values(zip.files)) {
    if (!file.dir && /\.(xml|rels)$/i.test(file.name) && /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(await file.async("string")))
      throw new Error("DOCX with DTD/entity declarations is not supported");
  }
  await normalizeOoxmlParts(zip);
  return zip;
}

// vendor/genoffice/docx/alt-chunk.ts
var htmlConverter = null;
function hasAltChunkHtmlConverter() {
  return htmlConverter !== null;
}
var ALT_CHUNK_REL = /\/aFChunk$/;
var MAX_CHUNK_BYTES = 64 * 1024 * 1024;
function altChunkKind(path, contentType, head) {
  if (head.length >= 4 && head[0] === 80 && head[1] === 75 && head[2] === 3 && head[3] === 4) {
    return "docx";
  }
  const ct = contentType?.split(";")[0].trim().toLowerCase();
  if (ct === "text/html" || ct === "application/xhtml+xml") return "html";
  if (ct === "message/rfc822" || ct === "multipart/related") return "mht";
  if (ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "htm" || ext === "html" || ext === "xhtml") return "html";
  if (ext === "mht" || ext === "mhtml" || ext === "eml") return "mht";
  if (ext === "docx" || ext === "docm" || ext === "dotx") return "docx";
  const text = latin1(head);
  if (/^(MIME-Version|From|Subject|Content-Type):/i.test(text.trimStart())) return "mht";
  if (/<!doctype\s+html|<html[\s>]/i.test(text)) return "html";
  return null;
}
function latin1(bytes, limit = bytes.length) {
  let s = "";
  const n = Math.min(bytes.length, limit);
  for (let i = 0; i < n; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, n)));
  }
  return s;
}
function decodeWithCharset(bytes, charset) {
  const label = (charset ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  for (const candidate of [label, "utf-8"]) {
    if (!candidate) continue;
    try {
      return new TextDecoder(candidate, { fatal: candidate === "utf-8" }).decode(bytes);
    } catch {
    }
  }
  return new TextDecoder("windows-1252").decode(bytes);
}
function decodeHtmlBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const head = latin1(bytes, 4096);
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)/i.exec(head)?.[1];
  return decodeWithCharset(bytes, meta);
}
function parseMimeHeaders(raw) {
  const headers = /* @__PURE__ */ new Map();
  for (const line of raw.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}
function headerParam(value, name) {
  if (!value) return void 0;
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  return m ? m[1] ?? m[2] : void 0;
}
function splitHeadersBody(bytes) {
  const text = latin1(bytes, 65536);
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return { headers: parseMimeHeaders(text), body: new Uint8Array(0) };
  return {
    headers: parseMimeHeaders(text.slice(0, m.index)),
    body: bytes.subarray(m.index + m[0].length)
  };
}
function indexOfBytes(hay, needle, from) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
function splitMultipart(body, boundary) {
  const parts = [];
  const marker = new TextEncoder().encode(`--${boundary}`);
  let pos = indexOfBytes(body, marker, 0);
  while (pos !== -1) {
    let start = pos + marker.length;
    if (body[start] === 45 && body[start + 1] === 45) break;
    if (body[start] === 13) start++;
    if (body[start] === 10) start++;
    const next = indexOfBytes(body, marker, start);
    let end = next === -1 ? body.length : next;
    if (body[end - 1] === 10) end--;
    if (body[end - 1] === 13) end--;
    parts.push(splitHeadersBody(body.subarray(start, Math.max(start, end))));
    pos = next;
  }
  return parts;
}
function decodeQuotedPrintable(text) {
  const src = text.replace(/=\r?\n/g, "");
  let len = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 61 && i + 2 < src.length) {
      const a = src.charCodeAt(i + 1);
      const b = src.charCodeAt(i + 2);
      if ((a >= 48 && a <= 57 || a >= 65 && a <= 70 || a >= 97 && a <= 102) && (b >= 48 && b <= 57 || b >= 65 && b <= 70 || b >= 97 && b <= 102)) {
        i += 2;
      }
    }
    len++;
  }
  const out = new Uint8Array(len);
  let w = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 61 && i + 2 < src.length) {
      const hex = src.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out[w++] = parseInt(hex, 16);
        i += 2;
        continue;
      }
    }
    out[w++] = c & 255;
  }
  return out;
}
function decodeBase64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeTransfer(part) {
  const enc = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  if (enc === "quoted-printable") return decodeQuotedPrintable(latin1(part.body));
  if (enc === "base64") return decodeBase64(latin1(part.body));
  return part.body;
}
function decodeMhtToHtml(bytes) {
  const top = splitHeadersBody(bytes);
  const type = top.headers.get("content-type") ?? "";
  const boundary = headerParam(type, "boundary");
  const parts = boundary ? splitMultipart(top.body, boundary) : [top];
  const htmlPart = parts.find(
    (p) => /^text\/html/i.test((p.headers.get("content-type") ?? "").trim())
  );
  if (!htmlPart) return null;
  const htmlBytes = decodeTransfer(htmlPart);
  const charset = headerParam(htmlPart.headers.get("content-type"), "charset");
  const html = charset ? decodeWithCharset(htmlBytes, charset) : decodeHtmlBytes(htmlBytes);
  const baseLocation = htmlPart.headers.get("content-location") ?? "";
  const inline = /* @__PURE__ */ new Map();
  for (const part of parts) {
    if (part === htmlPart) continue;
    const ct = (part.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) continue;
    const dataUrl = `data:${ct};base64,${btoa(latin1(decodeTransfer(part)))}`;
    const location = part.headers.get("content-location");
    if (location) {
      inline.set(location.toLowerCase(), dataUrl);
      if (baseLocation) {
        const base = baseLocation.replace(/[^/]*$/, "");
        if (location.startsWith(base))
          inline.set(location.slice(base.length).toLowerCase(), dataUrl);
      }
    }
    const cid = part.headers.get("content-id")?.replace(/^<|>$/g, "");
    if (cid) inline.set(`cid:${cid}`.toLowerCase(), dataUrl);
  }
  if (inline.size === 0) return html;
  return html.replace(
    /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
    (m, attr, dq, sq, uq) => {
      const dataUrl = inline.get((dq ?? sq ?? uq ?? "").toLowerCase());
      if (!dataUrl) return m;
      const q = sq !== void 0 ? "'" : '"';
      return `${attr}=${q}${dataUrl}${q}`;
    }
  );
}
function altChunkPartPath(rels, rId, sourcePath = "word/document.xml") {
  const rel = rels.get(rId);
  if (!rel || rel.targetMode === "External" || !ALT_CHUNK_REL.test(rel.type)) return null;
  return resolveRelationshipTargetPath(sourcePath, rel.target);
}
async function altChunkToDocx(zip, rels, rId, contentTypeOf, sourcePath = "word/document.xml") {
  const path = altChunkPartPath(rels, rId, sourcePath);
  const file = path ? zip.file(path) : null;
  if (!path || !file) return null;
  const bytes = await file.async("uint8array");
  if (bytes.length === 0 || bytes.length > MAX_CHUNK_BYTES) return null;
  const kind = altChunkKind(path, await contentTypeOf(path), bytes.subarray(0, 4096));
  if (kind === "docx") return bytes;
  if (!kind || !htmlConverter) return null;
  const html = kind === "mht" ? decodeMhtToHtml(bytes) : decodeHtmlBytes(bytes);
  if (!html || !html.trim()) return null;
  return htmlConverter(html);
}

// vendor/genoffice/docx/parse-vml.ts
function vmlLengthPx(value) {
  if (!value) return void 0;
  const m = /^\s*(-?[\d.]+)(pt|px|in|mm|cm)?\s*$/.exec(value);
  if (!m) return void 0;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return void 0;
  switch (m[2] ?? "pt") {
    case "px":
      return v;
    case "in":
      return v * 96;
    case "mm":
      return v / 25.4 * 96;
    case "cm":
      return v / 2.54 * 96;
    default:
      return v * 96 / 72;
  }
}
function vmlStyleProp(style, key) {
  return new RegExp(`(?:^|;)\\s*${key}:([^;]+)`).exec(style)?.[1]?.trim();
}
function vmlStyleDimPx(style, key) {
  const px = vmlLengthPx(vmlStyleProp(style, key));
  return px != null && px > 0 ? Math.round(px) : void 0;
}
function vmlRotationDeg(style) {
  const m = /^(-?[\d.]+)(fd)?$/.exec(vmlStyleProp(style, "rotation") ?? "");
  if (!m) return void 0;
  let deg = parseFloat(m[1]);
  if (m[2]) deg /= 65536;
  if (!Number.isFinite(deg)) return void 0;
  deg = Math.round((deg % 360 + 360) % 360 * 100) / 100;
  return deg > 0 ? deg : void 0;
}
function anchorRelH(rel) {
  switch (rel) {
    case "page":
      return "page";
    case "leftMargin":
    case "insideMargin":
    case "left-margin-area":
    case "inner-margin-area":
      return "leftMargin";
    case "rightMargin":
    case "outsideMargin":
    case "right-margin-area":
    case "outer-margin-area":
      return "rightMargin";
    default:
      return "margin";
  }
}
function anchorRelV(rel) {
  switch (rel) {
    case "page":
      return "page";
    case "paragraph":
    case "line":
    case "text":
      return "paragraph";
    case "topMargin":
    case "insideMargin":
    case "top-margin-area":
    case "inner-margin-area":
      return "topMargin";
    case "bottomMargin":
    case "outsideMargin":
    case "bottom-margin-area":
    case "outer-margin-area":
      return "bottomMargin";
    default:
      return "margin";
  }
}
function vmlFloatAnchor(style, out) {
  out.posHRel = anchorRelH(vmlStyleProp(style, "mso-position-horizontal-relative"));
  out.posVRel = anchorRelV(vmlStyleProp(style, "mso-position-vertical-relative"));
  const posH = vmlStyleProp(style, "mso-position-horizontal");
  const posV = vmlStyleProp(style, "mso-position-vertical");
  if (posH === "left" || posH === "center" || posH === "right") out.posH = posH;
  else out.posXPx = Math.round(vmlLengthPx(vmlStyleProp(style, "margin-left")) ?? 0);
  if (posV === "top" || posV === "center" || posV === "bottom") out.posV = posV;
  else out.posYPx = Math.round(vmlLengthPx(vmlStyleProp(style, "margin-top")) ?? 0);
}
function vmlFraction(value) {
  const m = /^\s*(-?[\d.]+)(f)?\s*$/.exec(value ?? "");
  if (!m) return void 0;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return void 0;
  return m[2] ? v / 65536 : v;
}
var VML_NAMED_COLORS = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  silver: "C0C0C0",
  gray: "808080",
  grey: "808080",
  maroon: "800000",
  olive: "808000",
  navy: "000080",
  purple: "800080",
  teal: "008080",
  fuchsia: "FF00FF",
  lime: "00FF00",
  aqua: "00FFFF",
  cyan: "00FFFF",
  orange: "FFA500"
};
function vmlColorHex(value) {
  if (!value) return void 0;
  const v = value.trim();
  const m6 = /^#?([0-9a-fA-F]{6})/.exec(v);
  if (m6) return m6[1];
  const m3 = /^#([0-9a-fA-F]{3})(?![0-9a-fA-F])/.exec(v);
  if (m3) {
    return m3[1].split("").map((c) => c + c).join("");
  }
  return VML_NAMED_COLORS[v.split(/[\s[]/, 1)[0].toLowerCase()];
}
var VML_WORDART_RE = /<v:textpath[^>]*\bstring="/;
var VML_PICT_RID_RE = /<v:imagedata[^>]*\br:id="/;
function vmlGroupScale(group, parentScale = null) {
  const a = attrsOf(group);
  const style = a["style"] ?? "";
  const wPx = vmlShapeDimPx(style, "width", parentScale);
  const hPx = vmlShapeDimPx(style, "height", parentScale);
  const cs = /^\s*(-?\d+)[,\s]+(-?\d+)/.exec(a["coordsize"] ?? "");
  const cw = cs ? parseInt(cs[1], 10) : NaN;
  const ch = cs ? parseInt(cs[2], 10) : NaN;
  if (!wPx || !hPx || !(cw > 0) || !(ch > 0)) return null;
  return { sx: wPx / cw, sy: hPx / ch };
}
function vmlCoordPx(style, key, scale, origin) {
  const m = new RegExp(`(?:^|;)\\s*${key}:(-?[\\d.]+)(pt|px|in|mm|cm)?(?=;|$)`).exec(style);
  const base = key === "left" ? origin.x : origin.y;
  if (!m) return base;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return base;
  if (m[2]) {
    const px = m[2] === "px" ? v : m[2] === "in" ? v * 96 : m[2] === "mm" ? v / 25.4 * 96 : m[2] === "cm" ? v / 2.54 * 96 : v * 96 / 72;
    return base + px;
  }
  return base + v * (key === "left" ? scale.sx : scale.sy);
}
function vmlPathToNormD(path, cw, ch) {
  if (!(cw > 0) || !(ch > 0)) return void 0;
  const norm = (v, c) => Math.round(v / c * 1e4) / 1e4;
  const parts = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  const readPairs = () => {
    const m = /^[-\d.,\s]+/.exec(path.slice(i));
    if (!m) return null;
    i += m[0].length;
    const nums = m[0].trim().split(/[,\s]/).map((tok) => tok === "" ? 0 : parseFloat(tok));
    if (nums.some((v) => !Number.isFinite(v))) return null;
    return nums.length > 0 && nums.length % 2 === 0 ? nums : null;
  };
  while (i < path.length) {
    const c = path[i];
    if (c === " " || c === ",") {
      i++;
      continue;
    }
    if (path.startsWith("nf", i) || path.startsWith("ns", i)) {
      i += 2;
      continue;
    }
    if (c === "e") {
      i++;
      continue;
    }
    if (c === "x") {
      parts.push("Z");
      i++;
      continue;
    }
    if (c === "m" || c === "l" || c === "t" || c === "r") {
      i++;
      const nums = readPairs();
      if (!nums) return void 0;
      const rel = c === "t" || c === "r";
      const move = c === "m" || c === "t";
      for (let k = 0; k < nums.length; k += 2) {
        cx = rel ? cx + nums[k] : nums[k];
        cy = rel ? cy + nums[k + 1] : nums[k + 1];
        parts.push(`${k === 0 && move ? "M" : "L"} ${norm(cx, cw)} ${norm(cy, ch)}`);
      }
      continue;
    }
    return void 0;
  }
  return parts.length > 1 ? parts.join(" ") : void 0;
}
function vmlShapeDimPx(style, key, scale) {
  const m = new RegExp(`(?:^|;)\\s*${key}:([0-9.]+)(pt|px|in|mm|cm)?`).exec(style);
  if (!m) return void 0;
  if (m[2] || !scale) return vmlStyleDimPx(style, key);
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return void 0;
  return Math.round(v * (key === "width" ? scale.sx : scale.sy));
}
function vmlWordArtBox(shape) {
  const tp = findChild(shape, "v:textpath");
  if (!tp) return null;
  const text = attrsOf(tp)["string"];
  if (!text || text.trim() === "") return null;
  const shapeAttrs = attrsOf(shape);
  const style = shapeAttrs["style"] ?? "";
  const box = {
    paras: [],
    readOnly: true,
    insetTopPx: 0,
    insetRightPx: 0,
    insetBottomPx: 0,
    insetLeftPx: 0
  };
  const w = vmlStyleDimPx(style, "width");
  if (w) box.widthPx = w;
  const h = vmlStyleDimPx(style, "height");
  if (h) box.heightPx = h;
  if (/position:\s*absolute/.test(style)) {
    box.floating = true;
    const marginPx = (key) => {
      const pt2 = parseFloat(new RegExp(`(?:^|;)\\s*${key}:(-?[\\d.]+)pt`).exec(style)?.[1] ?? "");
      return Number.isFinite(pt2) ? pt2 / 72 * 96 : 0;
    };
    box.offsetXEmu = Math.round(marginPx("margin-left") * EMU_PER_PX2);
    box.offsetYEmu = Math.round(marginPx("margin-top") * EMU_PER_PX2);
  }
  const tpStyle = attrsOf(tp)["style"] ?? "";
  const family = /font-family:\s*"?([^;"]+)"?/.exec(tpStyle)?.[1]?.trim();
  const sizePt = parseFloat(/font-size:\s*([\d.]+)pt/.exec(tpStyle)?.[1] ?? "");
  const fillNode = findChild(shape, "v:fill");
  const fillAttrs = fillNode ? attrsOf(fillNode) : {};
  const fill = shapeAttrs["filled"] === "f" ? void 0 : vmlColorHex(shapeAttrs["fillcolor"]) ?? vmlColorHex(fillAttrs["color"]) ?? vmlColorHex(fillAttrs["color2"]);
  if (shapeAttrs["stroked"] !== "f") {
    const strokeColor = vmlColorHex(shapeAttrs["strokecolor"]) ?? "000000";
    const weightPt = parseFloat(
      /^([\d.]+)(?:pt)?$/.exec(shapeAttrs["strokeweight"] ?? "")?.[1] ?? ""
    );
    box.textOutline = {
      colorHex: strokeColor,
      widthPx: Number.isFinite(weightPt) && weightPt > 0 ? Math.round(weightPt / 72 * 96 * 100) / 100 : 1
    };
  }
  const heightPt = h ? h / 96 * 72 : NaN;
  const run2 = { text };
  let pt = Number.isFinite(sizePt) && sizePt > 0 ? sizePt : heightPt > 0 ? heightPt / 1.4 : NaN;
  const widthPt = w ? w / 96 * 72 : NaN;
  if (Number.isFinite(pt) && widthPt > 0 && text.length > 0) {
    pt = Math.max(6, Math.min(pt, widthPt / (0.62 * text.length)));
  }
  if (Number.isFinite(pt) && pt > 0) run2.sizeHalfPoints = Math.round(pt * 2);
  box.nowrap = true;
  if (family) run2.fontAscii = family;
  if (fill) run2.color = fill;
  if (/font-weight:\s*bold/.test(tpStyle)) run2.bold = true;
  if (/font-style:\s*italic/.test(tpStyle)) run2.italic = true;
  box.paras.push({ runs: [run2], align: "center" });
  return box;
}
function vmlPictShape(pict) {
  const body = pict.replace(/<v:shapetype\b[\s\S]*?<\/v:shapetype>/g, "");
  return /<v:(oval|rect|roundrect|shape)\b([^>]*?)(\/?)>([\s\S]*?<\/v:\1>)?/.exec(body);
}
function vmlShapeTypeTable(xml) {
  const out = /* @__PURE__ */ new Map();
  for (const m of xml.matchAll(/<v:shapetype\b([^>]*)>/g)) {
    const a = parseTagAttrs(m[1]);
    if (a["id"]) out.set(a["id"], a);
  }
  return out;
}
var VML_SPT_PATHS = {
  "1": "m,l,21600r21600,l21600,xe",
  "4": "m10800,l,10800,10800,21600,21600,10800xe",
  "5": "m10800,l,21600r21600,xe",
  "6": "m,l,21600r21600,xe",
  "110": "m10800,l,10800,10800,21600,21600,10800xe",
  "202": "m,l,21600r21600,l21600,xe"
};
function parseTagAttrs(tag2) {
  const out = {};
  for (const m of tag2.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
function vmlShapeSvg(pict, shapeTypes) {
  if (/<v:(group|imagedata|textpath|textbox)\b|<w:txbxContent/.test(pict)) return null;
  const m = vmlPictShape(pict);
  if (!m) return null;
  const [, rawKind, attrText] = m;
  const own = parseTagAttrs(attrText);
  const typeId = /^#(.+)$/.exec(own["type"] ?? "")?.[1];
  const typeAttrs = typeId && (vmlShapeTypeTable(pict).get(typeId) ?? shapeTypes?.get(typeId)) || {};
  const a = { ...typeAttrs, ...own };
  const style = own["style"] ?? "";
  if (/visibility:\s*hidden/.test(style)) return null;
  const w = vmlStyleDimPx(style, "width");
  const h = vmlStyleDimPx(style, "height");
  if (!w || !h) return null;
  const children = m[4] ?? "";
  const fillNode = parseTagAttrs(/<v:fill\b([^>]*)>/.exec(children)?.[1] ?? "");
  const strokeNode = parseTagAttrs(/<v:stroke\b([^>]*)>/.exec(children)?.[1] ?? "");
  const off = (v) => v === "f" || v === "false" || v === "0";
  const filled = !off(a["filled"]) && !off(fillNode["on"]);
  const color1 = vmlColorHex(a["fillcolor"]) ?? "FFFFFF";
  const color2 = vmlColorHex(fillNode["color2"]);
  const fillType = fillNode["type"];
  if (fillType && fillType !== "solid" && fillType !== "gradient") return null;
  const gradient = filled && fillType === "gradient" && color2 ? vmlGradient(fillNode) : null;
  let defs = "";
  let fill = "none";
  if (filled && gradient) {
    const stops = gradient.stops.map(([o, c]) => `<stop offset="${o}" stop-color="#${c === 1 ? color1 : color2}"/>`).join("");
    defs = `<defs><linearGradient id="g" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">${stops}</linearGradient></defs>`;
    fill = "url(#g)";
  } else if (filled) fill = `#${color1}`;
  const opacity = vmlFraction(fillNode["opacity"]);
  const stroked = !off(a["stroked"]) && !off(strokeNode["on"]);
  const sw = stroked ? vmlLengthPx(a["strokeweight"]) ?? 1 : 0;
  const paint = ` fill="${fill}"` + (opacity != null && opacity < 1 ? ` fill-opacity="${opacity}"` : "") + (stroked ? ` stroke="#${vmlColorHex(a["strokecolor"]) ?? "000000"}" stroke-width="${sw}"` : "");
  const spt = own["path"] ? void 0 : a["o:spt"];
  const kind = rawKind === "shape" && spt === "3" ? "oval" : rawKind === "shape" && spt === "2" ? "roundrect" : rawKind;
  const ix = sw / 2;
  const iw = Math.max(0, w - sw);
  const ih = Math.max(0, h - sw);
  let body;
  if (kind === "oval") {
    body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${iw / 2}" ry="${ih / 2}"${paint}/>`;
  } else if (kind === "rect" || kind === "roundrect") {
    const arc = kind === "roundrect" ? vmlFraction(a["arcsize"]) ?? 0.2 : 0;
    const r = Math.round(arc * (Math.min(iw, ih) / 2) * 100) / 100;
    body = `<rect x="${ix}" y="${ix}" width="${iw}" height="${ih}"${r > 0 ? ` rx="${r}"` : ""}${paint}/>`;
  } else {
    const path = a["path"] ?? VML_SPT_PATHS[a["o:spt"] ?? ""];
    const cs = /^\s*(-?\d+)[,\s]+(-?\d+)/.exec(a["coordsize"] ?? "21600,21600");
    const d = path && cs ? vmlPathToNormD(path, parseInt(cs[1], 10), parseInt(cs[2], 10)) : void 0;
    if (!d) return null;
    let axis = 0;
    const placed = d.split(" ").map((tok) => {
      const n = Number(tok);
      if (!Number.isFinite(n)) {
        axis = 0;
        return tok;
      }
      const v = axis++ % 2 === 0 ? ix + n * iw : ix + n * ih;
      return String(Math.round(v * 100) / 100);
    }).join(" ");
    body = `<path d="${placed}"${paint}/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`;
  return {
    dataUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    widthPx: w,
    heightPx: h,
    style
  };
}
function vmlGradient(fillNode) {
  const angle = parseFloat(fillNode["angle"] ?? "0") || 0;
  const focus = vmlFraction(fillNode["focus"]?.replace("%", "")) ?? 0;
  const f = Math.abs(focus) > 1 ? focus / 100 : focus;
  const rad = (90 - angle) * Math.PI / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const r = (v) => Math.round(v * 1e3) / 1e3;
  const line = { x1: r(0.5 - dx), y1: r(0.5 - dy), x2: r(0.5 + dx), y2: r(0.5 + dy) };
  const axial = Math.abs(f) >= 0.25 && Math.abs(f) <= 0.75;
  if (axial) {
    const stops2 = f > 0 ? [
      [0, 1],
      [0.5, 2],
      [1, 1]
    ] : [
      [0, 2],
      [0.5, 1],
      [1, 2]
    ];
    return { ...line, stops: stops2 };
  }
  let swap = angle < 0;
  if (Math.abs(f) > 0.5) swap = !swap;
  const stops = swap ? [
    [0, 1],
    [1, 2]
  ] : [
    [0, 2],
    [1, 1]
  ];
  return { ...line, stops };
}

// vendor/genoffice/docx/watermark.ts
var WATERMARK_NS = ' xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';
function readWatermarkText(headerXml) {
  if (!headerXml.includes("<v:textpath")) return null;
  const m = /<v:textpath[^>]*\bstring="([^"]*)"/.exec(headerXml);
  if (!m) return null;
  const text = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return text || null;
}
function readWatermarkShape(pictXml) {
  const text = readWatermarkText(pictXml);
  if (!text) return null;
  const body = pictXml.replace(/<v:shapetype\b[\s\S]*?<\/v:shapetype>/g, "");
  const shapeTag = /<v:shape\b[^>]*>/.exec(body)?.[0];
  if (!shapeTag) return null;
  const attr = (tag2, key) => new RegExp(`\\s${key}="([^"]*)"`).exec(tag2)?.[1];
  const style = attr(shapeTag, "style") ?? "";
  const widthPx = vmlStyleDimPx(style, "width");
  const heightPx = vmlStyleDimPx(style, "height");
  if (!widthPx || !heightPx) return null;
  const fillTag = /<v:fill\b[^>]*>/.exec(body)?.[0];
  const tpTag = /<v:textpath\b[^>]*\bstring="[^>]*>/.exec(body)?.[0] ?? "";
  const tpStyle = (attr(tpTag, "style") ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const family = vmlStyleProp(tpStyle, "font-family")?.replace(/^"|"$/g, "");
  const img = {
    dataUrl: "",
    widthPx,
    heightPx,
    floating: true,
    wordArt: {
      text,
      colorHex: attr(shapeTag, "filled") === "f" ? "FFFFFF" : vmlColorHex(attr(shapeTag, "fillcolor")) ?? "000000",
      opacity: Math.max(
        0,
        Math.min(1, (fillTag ? vmlFraction(attr(fillTag, "opacity")) : void 0) ?? 1)
      ),
      ...family ? { fontFamily: family } : {},
      .../font-weight:\s*bold/.test(tpStyle) ? { bold: true } : {},
      .../font-style:\s*italic/.test(tpStyle) ? { italic: true } : {}
    }
  };
  if (/z-index:\s*-/.test(style)) img.behind = true;
  const rot = vmlRotationDeg(style);
  if (rot != null) img.rotationDeg = rot;
  vmlFloatAnchor(style, img);
  return img;
}
function isPictureWatermark(wm) {
  return typeof wm === "object" && "image" in wm;
}
var PICTURE_WATERMARK_ID = /<v:shape\b[^>]*\bid="(?:WordPictureWatermark|PowerPlusWaterMarkObject)/;
function isWatermarkChild(child) {
  if (child.name !== "w:p" && child.name !== "w:sdt") return false;
  if (child.xml.includes("<v:textpath")) return true;
  return child.xml.includes("<v:imagedata") && (PICTURE_WATERMARK_ID.test(child.xml) || child.xml.includes('<w:docPartGallery w:val="Watermarks"/>'));
}
function isPictureWatermarkShape(xml) {
  return PICTURE_WATERMARK_ID.test(xml);
}
var PT_PER_UNIT2 = {
  pt: 1,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  px: 0.75
};
function vmlStyleDimPt(style, key) {
  const m = new RegExp(`(?:^|;)\\s*${key}:\\s*(-?[\\d.]+)(pt|in|cm|mm|px)?`).exec(style);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (PT_PER_UNIT2[m[2] ?? "pt"] ?? 1) * 100) / 100;
}
function readPictureWatermark(headerXml) {
  for (const m of headerXml.matchAll(/<v:shape\b[^>]*>[\s\S]*?<\/v:shape>/g)) {
    const shape = m[0];
    if (!PICTURE_WATERMARK_ID.test(shape) && !isWatermarkChild({ name: "w:p", xml: shape }))
      continue;
    const rId = /<v:imagedata[^>]*\br:id\s*=\s*(["'])([^"']+)\1/.exec(shape)?.[2];
    if (!rId) continue;
    const style = /\sstyle="([^"]*)"/.exec(shape)?.[1] ?? "";
    return {
      rId,
      widthPt: vmlStyleDimPt(style, "width"),
      heightPt: vmlStyleDimPt(style, "height"),
      washout: /\sgain="/.test(shape)
    };
  }
  return null;
}
function pictureWatermarkBoxPt(spec, marginBox) {
  const naturalW = spec.image.widthPx * 72 / 96;
  const naturalH = spec.image.heightPx * 72 / 96;
  let factor;
  if (spec.scale !== void 0) factor = spec.scale / 100;
  else {
    const box = marginBox ?? { widthPt: 468, heightPt: 648 };
    factor = Math.min(box.widthPt / naturalW, box.heightPt / naturalH);
  }
  return {
    widthPt: Math.max(1, Math.round(naturalW * factor * 100) / 100),
    heightPt: Math.max(1, Math.round(naturalH * factor * 100) / 100)
  };
}
function pictureWatermarkParagraphXml(spec, rId, marginBox) {
  const box = pictureWatermarkBoxPt(spec, marginBox);
  const washout = spec.washout !== false ? ' gain="19661f" blacklevel="22938f"' : "";
  const shapetype = '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
  const shape = `<v:shape id="WordPictureWatermark1" o:spid="_x0000_s2050" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${box.widthPt}pt;height:${box.heightPt}pt;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f"><v:imagedata r:id="${escapeXmlAttr(rId)}" o:title="watermark"${washout}/></v:shape>`;
  return `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Watermarks"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:pict>${shapetype}${shape}</w:pict></w:r></w:p></w:sdtContent></w:sdt>`;
}
function watermarkParagraphXml(spec) {
  const wm = typeof spec === "string" ? { text: spec } : spec;
  const diagonal = wm.diagonal !== false;
  const box = diagonal ? "width:412.4pt;height:247.45pt;rotation:315;" : "width:527.85pt;height:131.95pt;";
  const opacity = Math.max(0, Math.min(1, wm.opacity ?? 0.5));
  const fill = wm.colorHex ? `#${wm.colorHex.replace(/^#/, "")}` : "silver";
  const font = escapeXmlAttr(wm.fontFamily ?? "DengXian");
  const tpStyle = `font-family:&quot;${font}&quot;;font-size:1pt` + (wm.bold ? ";font-weight:bold" : "") + (wm.italic ? ";font-style:italic" : "");
  const shape = `<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;left:0;text-align:left;margin-left:0;margin-top:0;${box}z-index:-251656192;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="${escapeXmlAttr(fill)}" stroked="f"><v:fill opacity="${opacity}"/><v:textpath style="${tpStyle}" string="${escapeXmlAttr(wm.text)}"/></v:shape>`;
  const shapetype = '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';
  return `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Watermarks"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:pict>${shapetype}${shape}</w:pict></w:r></w:p></w:sdtContent></w:sdt>`;
}

// vendor/genoffice/docx/parse-block-passes.ts
function applyProtectedLeadingBreaks(blocks) {
  for (const b of blocks) {
    if (b.type !== "image" || b.format?.pageBreakBefore) continue;
    const xml = b.originalXml;
    if (!xml) continue;
    const drawing = xml.search(/<w:drawing[\s>]|<w:pict[\s>]|<w:object[\s>]/);
    const head = xml.slice(0, drawing === -1 ? xml.length : drawing);
    const br = head.search(/<w:br\s[^>]*w:type=(["'])page\1/);
    if (br === -1) continue;
    const textBefore = [...head.slice(0, br).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    if (textBefore.trim() === "") b.format = { ...b.format, pageBreakBefore: true };
  }
}
var SINGLE_SPACING_HANGUL_KANA_FONTS = /* @__PURE__ */ new Set([
  "malgungothic",
  "malgungothicsemilight",
  "\uB9D1\uC740\uACE0\uB515",
  "nanumgothic",
  "\uB098\uB214\uACE0\uB515",
  "applesdgothicneo",
  "mspgothic",
  "\uFF4D\uFF53\uFF50\u30B4\u30B7\u30C3\u30AF"
]);
function keepsHangulKanaSingle(font) {
  return !!font && SINGLE_SPACING_HANGUL_KANA_FONTS.has(font.toLowerCase().replace(/[\s\u3000]+/g, ""));
}
function isHangulOrKana(cp) {
  return cp >= 4352 && cp <= 4607 || cp >= 12352 && cp <= 12543 || cp >= 12592 && cp <= 12687 || cp >= 12784 && cp <= 12799 || cp >= 44032 && cp <= 55215;
}
function doubledGlyphFraction(text, hangulKanaSingle) {
  let wide = 0;
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const hangulKana = isHangulOrKana(cp);
    const isWide = hangulKana || cp >= 11904 && cp <= 40959 || cp >= 63744 && cp <= 64255 || cp >= 65280 && cp <= 65376 || cp >= 131072;
    if (isWide && !(hangulKana && hangulKanaSingle)) wide++;
    n++;
  }
  return n > 0 ? wide / n : 0;
}
function applyBalancedDbcsSpacing(runGroups, defaultFont) {
  for (const runs of runGroups) {
    if (!runs) continue;
    for (const r of runs) {
      if (!r.charSpacingTwips || !r.text) continue;
      const frac = doubledGlyphFraction(
        r.text,
        keepsHangulKanaSingle(r.eastAsiaFont ?? defaultFont)
      );
      if (frac > 0) r.charSpacingTwips = Math.round(r.charSpacingTwips * (1 + frac) * 10) / 10;
    }
  }
}
function blockRunGroups(blocks) {
  const groups = [];
  const fromBoxes = (boxes) => {
    for (const box of boxes ?? []) for (const para of box.paras) groups.push(para.runs);
  };
  const fromTable = (table) => {
    if (!table) return;
    for (const row of table.rows) {
      for (const cell of row) {
        for (const para of cell.richParas ?? []) groups.push(para.runs);
        fromBoxes(cell.anchoredBoxes);
        for (const nested of cell.nestedTables ?? []) fromTable(nested);
      }
    }
  };
  for (const b of blocks) {
    groups.push(b.runs);
    groups.push(b.strayRuns);
    fromTable(b.table ?? void 0);
    fromBoxes(b.textboxes);
  }
  return groups;
}
function normalizeImageZOrders(blocks) {
  const anchored = [];
  for (const b of blocks) {
    if (b.imageZOrder !== void 0) {
      anchored.push({
        get: () => b.imageZOrder,
        set: (rank) => {
          if (rank === 0) delete b.imageZOrder;
          else b.imageZOrder = rank;
          b.imageZOrderNormalized = true;
        }
      });
    }
    for (const box of b.textboxes ?? []) {
      if (box.z !== void 0) {
        anchored.push({
          get: () => box.z,
          // display-only: the box's XML keeps its raw relativeHeight
          set: (rank) => box.z = rank
        });
      }
    }
  }
  if (!anchored.some((e) => Math.abs(e.get()) > 1e4)) return;
  anchored.map((e, i) => ({ e, i })).sort((x, y) => x.e.get() - y.e.get() || x.i - y.i).forEach(({ e }, rank) => e.set(rank));
}
function floatTableColumnSpan(block, sect) {
  const model = block.type === "table" ? block.table : void 0;
  const pos = model?.floatPos;
  if (!pos || !model?.colWidthsTwips?.length) return void 0;
  if (/\bw:tblpXSpec=/.test(block.originalXml ?? "")) return void 0;
  const width = model.colWidthsTwips.reduce((sum, w) => sum + w, 0);
  const gap = pos.distanceTwips ?? {};
  const x = pos.horzAnchor === "page" || !pos.horzAnchor ? pos.xTwips - sect.marginLeft : pos.xTwips;
  return { leftTwips: x - (gap.left ?? 0), rightTwips: x + width + (gap.right ?? 0) };
}
var isEmptyParagraph = (b) => b.type === "paragraph" && (b.runs ?? []).every((r) => r.text.trim() === "" && !r.image);
function bandWrappedBoxesBeforeTables(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const boxes = blocks[i].textboxes;
    if (!boxes?.length || !boxes.every((b) => b.floating)) continue;
    let j = i + 1;
    while (j < blocks.length && isEmptyParagraph(blocks[j])) j++;
    if (blocks[j]?.type !== "table") continue;
    for (const b of boxes) {
      if (!b.wrapSides || b.bandBottomPx !== void 0 || b.pagePinned || b.pageRelV) continue;
      if (b.heightPx === void 0) continue;
      const top = Math.round((b.offsetYEmu ?? 0) / EMU_PER_PX2);
      if (top + b.heightPx <= 0) continue;
      b.bandTopPx = top;
      b.bandBottomPx = top + b.heightPx;
      b.bandBeside = true;
    }
  }
}

// vendor/genoffice/docx/eq-field.ts
var MAX_DEPTH = 64;
var CHAR_SWITCHES = /* @__PURE__ */ new Set(["lc", "rc", "bc", "fc", "vc"]);
function run(text) {
  if (text === "") return { omml: "", text: "" };
  return {
    omml: `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">${escapeXmlText(text)}</m:t></m:r>`,
    text
  };
}
function join(pieces, sep = "") {
  return {
    omml: pieces.map((p) => p.omml).join(sep === "" ? "" : run(sep).omml),
    text: pieces.map((p) => p.text).join(sep)
  };
}
function slot(name, piece) {
  return `<m:${name}>${piece.omml}</m:${name}>`;
}
function val(name, v) {
  return `<m:${name} m:val="${escapeXmlAttr(v)}"/>`;
}
function parseSeq(p, inArgs) {
  const pieces = [];
  let text = "";
  let depth = 0;
  const flush = () => {
    if (text !== "") pieces.push(run(text));
    text = "";
  };
  while (p.i < p.src.length) {
    const ch = p.src[p.i];
    if (ch === "\\") {
      const next = p.src[p.i + 1] ?? "";
      if (/[A-Za-z]/.test(next)) {
        flush();
        const cmd = parseCommand(p);
        if (!cmd) return null;
        pieces.push(cmd);
        continue;
      }
      text += next;
      p.i += 2;
      continue;
    }
    if (inArgs) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
    }
    text += ch;
    p.i++;
  }
  flush();
  return pieces;
}
function parseArgs(p) {
  while (p.src[p.i] === " ") p.i++;
  if (p.src[p.i] !== "(") return null;
  p.i++;
  const args = [];
  for (; ; ) {
    const seq = parseSeq(p, true);
    if (!seq) return null;
    args.push(join(seq));
    const ch = p.src[p.i];
    if (ch === ",") {
      p.i++;
      continue;
    }
    if (ch === ")") {
      p.i++;
      return args;
    }
    return null;
  }
}
function parseCommand(p) {
  if (p.depth >= MAX_DEPTH) return null;
  p.depth++;
  try {
    return parseCommandInner(p);
  } finally {
    p.depth--;
  }
}
function parseCommandInner(p) {
  const cmd = p.src[p.i + 1].toLowerCase();
  p.i += 2;
  const switches = [];
  for (; ; ) {
    while (p.src[p.i] === " ") p.i++;
    const m = /^\\([A-Za-z]{2})(-?\d*)/.exec(p.src.slice(p.i));
    if (!m) break;
    const name = m[1].toLowerCase();
    p.i += m[0].length;
    let arg = m[2];
    if (CHAR_SWITCHES.has(name)) {
      if (p.src[p.i] !== "\\") return null;
      arg = p.src[p.i + 1] ?? "";
      p.i += 2;
    }
    switches.push({ name, arg });
  }
  const args = parseArgs(p);
  if (!args) return null;
  const has = (name) => switches.some((s) => s.name === name);
  const argOf = (name) => switches.find((s) => s.name === name)?.arg;
  switch (cmd) {
    case "a": {
      const rawCols = parseInt(argOf("co") ?? "1", 10);
      const cols = Number.isFinite(rawCols) ? Math.min(Math.max(1, rawCols), 64) : 1;
      const jc = has("al") ? "left" : has("ar") ? "right" : "center";
      const rows = [];
      const lines = [];
      for (let r = 0; r < args.length; r += cols) {
        const cells = args.slice(r, r + cols);
        while (cells.length < cols) cells.push(run(""));
        rows.push(`<m:mr>${cells.map((c) => slot("e", c)).join("")}</m:mr>`);
        lines.push(cells.map((c) => c.text).join(" "));
      }
      return {
        omml: "<m:m><m:mPr><m:mcs><m:mc><m:mcPr>" + val("count", String(cols)) + val("mcJc", jc) + `</m:mcPr></m:mc></m:mcs></m:mPr>${rows.join("")}</m:m>`,
        text: lines.join("\n")
      };
    }
    case "b": {
      const both = argOf("bc");
      const beg = both ?? argOf("lc") ?? "(";
      const end = both ? closingOf(both) : argOf("rc") ?? ")";
      const body = join(args, ",");
      return {
        omml: `<m:d><m:dPr>${val("begChr", beg)}${val("endChr", end)}</m:dPr>${slot("e", body)}</m:d>`,
        text: `${beg}${body.text}${end}`
      };
    }
    case "f": {
      const [num2 = run(""), den = run("")] = args;
      return {
        omml: `<m:f>${slot("num", num2)}${slot("den", den)}</m:f>`,
        text: `${num2.text}/${den.text}`
      };
    }
    case "i": {
      const chr = argOf("fc") ?? argOf("vc") ?? (has("su") ? "\u2211" : has("pr") ? "\u220F" : "\u222B");
      const [lo = run(""), hi = run(""), body = run("")] = args;
      const limLoc = has("in") || chr === "\u222B" ? "subSup" : "undOvr";
      return {
        omml: `<m:nary><m:naryPr>${val("chr", chr)}${val("limLoc", limLoc)}` + (lo.text === "" ? val("subHide", "1") : "") + (hi.text === "" ? val("supHide", "1") : "") + `</m:naryPr>${slot("sub", lo)}${slot("sup", hi)}${slot("e", body)}</m:nary>`,
        text: `${chr}${lo.text}${hi.text} ${body.text}`
      };
    }
    case "l":
      return join(args, ",");
    case "o":
      return join(args);
    case "r": {
      if (args.length >= 2) {
        const [deg, body2] = args;
        return {
          omml: `<m:rad>${slot("deg", deg)}${slot("e", body2)}</m:rad>`,
          text: `${deg.text}\u221A(${body2.text})`
        };
      }
      const body = args[0] ?? run("");
      return {
        omml: `<m:rad><m:radPr>${val("degHide", "1")}</m:radPr><m:deg/>${slot("e", body)}</m:rad>`,
        text: `\u221A(${body.text})`
      };
    }
    case "s": {
      if (args.length === 1 && (has("up") || has("do"))) {
        const tag2 = has("up") ? "sSup" : "sSub";
        const script = has("up") ? "sup" : "sub";
        return {
          omml: `<m:${tag2}><m:e/>${slot(script, args[0])}</m:${tag2}>`,
          text: args[0].text
        };
      }
      return {
        omml: `<m:eqArr>${args.map((a) => slot("e", a)).join("")}</m:eqArr>`,
        text: args.map((a) => a.text).join("\n")
      };
    }
    case "x": {
      const sides = { to: "hideTop", bo: "hideBot", le: "hideLeft", ri: "hideRight" };
      const named = Object.keys(sides).filter((k) => has(k));
      const hidden = named.length ? Object.entries(sides).filter(([k]) => !named.includes(k)).map(([, tag2]) => val(tag2, "1")).join("") : "";
      const body = join(args, ",");
      return {
        omml: `<m:borderBox><m:borderBoxPr>${hidden}</m:borderBoxPr>${slot("e", body)}</m:borderBox>`,
        text: body.text
      };
    }
    default:
      return null;
  }
}
function closingOf(open) {
  return { "(": ")", "[": "]", "{": "}", "<": ">", "\u27E8": "\u27E9" }[open] ?? open;
}
function eqFieldToOmml(instr) {
  const m = /^\s*EQ\b\s*([\s\S]*?)\s*$/i.exec(instr);
  if (!m) return null;
  const p = { src: m[1].replace(/\\\*\s*[A-Za-z]+/g, "").trim(), i: 0, depth: 0 };
  const seq = parseSeq(p, false);
  if (!seq || p.i < p.src.length) return null;
  const body = join(seq);
  if (body.omml === "") return null;
  return { omml: `<m:oMath>${body.omml}</m:oMath>`, text: body.text };
}
var FLD_CHAR_RE = /<w:fldChar[^>]*w:fldCharType=(?:"(begin|separate|end)"|'(begin|separate|end)')/g;
function inlineEqFieldResults(xml) {
  if (!/<w:instrText[^>]*>\s*EQ\b/i.test(xml)) return xml;
  let out = "";
  let cursor = 0;
  let depth = 0;
  let spanStart = -1;
  let m;
  FLD_CHAR_RE.lastIndex = 0;
  while ((m = FLD_CHAR_RE.exec(xml)) !== null) {
    const kind = m[1] ?? m[2];
    if (kind === "begin") {
      if (depth === 0) spanStart = runStartBefore(xml, m.index);
      depth++;
    } else if (kind === "end") {
      depth = Math.max(0, depth - 1);
      if (depth !== 0 || spanStart < 0) continue;
      const spanEnd = xml.indexOf("</w:r>", m.index) + "</w:r>".length;
      const span = xml.slice(spanStart, spanEnd);
      const instr = decodeEntities(
        Array.from(span.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g), (x) => x[1]).join(
          ""
        )
      );
      const eq = eqFieldToOmml(instr);
      if (eq) {
        const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(span)?.[0] ?? "";
        out += xml.slice(cursor, spanStart) + `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(eq.text)}</w:t></w:r>`;
        cursor = spanEnd;
      }
      spanStart = -1;
    }
  }
  return out + xml.slice(cursor);
}
function runStartBefore(xml, index) {
  const a = xml.lastIndexOf("<w:r>", index);
  const b = xml.lastIndexOf("<w:r ", index);
  return Math.max(a, b);
}

// vendor/genoffice/docx/parse-fields.ts
function tocLevelOf(styleId, styles) {
  const m = /^TOC ?([1-9])$/i.exec(styleId) ?? /^toc ?([1-9])$/i.exec(styles?.get(styleId)?.name ?? "");
  if (m) return parseInt(m[1], 10);
  if (/^TableofFigures$/i.test(styleId) || /^table of figures$/i.test(styles?.get(styleId)?.name ?? ""))
    return 1;
  return null;
}
var TAB_LEADERS = ["none", "dot", "hyphen", "underscore", "heavy", "middleDot"];
function tocLeaderOf(pPr, style) {
  const tabsXml = /<w:tabs>[\s\S]*?<\/w:tabs>/.exec(pPr)?.[0];
  if (tabsXml) {
    const rights = Array.from(tabsXml.matchAll(/<w:tab\s[^>]*\/>/g), (m) => m[0]).filter(
      (t) => /\sw:val=(?:"right"|'right')/.test(t)
    );
    const last = rights[rights.length - 1];
    if (last) {
      const v = /\sw:leader=(?:"([^"]+)"|'([^']+)')/.exec(last)?.slice(1, 3).find(Boolean) ?? "none";
      return TAB_LEADERS.includes(v) ? v : "none";
    }
  }
  const stop = style?.display?.tabStops?.filter((t) => t.val === "right").pop();
  return stop ? stop.leader ?? "none" : void 0;
}
function leadingRunFont(rPr, text) {
  const fonts = /<w:rFonts [^/>]*/.exec(rPr)?.[0];
  if (!fonts) return void 0;
  const ea = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text) ? /w:eastAsia="([^"]+)"/.exec(fonts)?.[1] : void 0;
  return ea ?? /w:ascii="([^"]+)"/.exec(fonts)?.[1] ?? /w:hAnsi="([^"]+)"/.exec(fonts)?.[1];
}
var DEL_WRAPPER_RE = /<w:del(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:del>/g;
function tagAttr(xml, tag2, name) {
  return new RegExp(`<${tag2}\\b[^>]*\\s${name}=(["'])([^"']*)\\1`).exec(xml)?.[2];
}
function directParaGeometry(pPr) {
  const twips = (tag2, name) => {
    const v = parseInt(tagAttr(pPr, tag2, name) ?? "", 10);
    return Number.isNaN(v) ? void 0 : v;
  };
  const before = twips("w:spacing", "w:before");
  const after = twips("w:spacing", "w:after");
  const left = twips("w:ind", "w:(?:left|start)");
  return {
    ...before !== void 0 ? { spaceBeforeTwips: before } : {},
    ...after !== void 0 ? { spaceAfterTwips: after } : {},
    ...left !== void 0 ? { indentLeftTwips: left } : {}
  };
}
function lineRuleOf(pPr) {
  const v = tagAttr(pPr, "w:spacing", "w:lineRule");
  return v === "atLeast" || v === "exact" ? v : "auto";
}
function unstyledTocEntry(xml, pPr) {
  return /<w:instrText[^>]*>\s*PAGEREF\s/.test(xml) && /<w:tabs>[\s\S]*?<w:tab\s[^>]*w:val=(?:"right"|'right')/.test(pPr);
}
function fieldDisplayOf(xml, styles) {
  const styleId = tagAttr(xml, "w:pStyle", "w:val") ?? "";
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] ?? "";
  const geometry = directParaGeometry(pPr);
  const styledLevel = tocLevelOf(styleId, styles);
  const tocLevel = styledLevel ?? (unstyledTocEntry(xml, pPr) ? 1 : null);
  if (styledLevel !== null) delete geometry.indentLeftTwips;
  if (tocLevel !== null) {
    const live = xml.replace(DEL_WRAPPER_RE, "");
    const deleted = !/<w:t(?:\s|>)/.test(live) && /<w:delText(?:\s|>)/.test(xml);
    const segs = [""];
    const re = /<w:(?:t|delText)(?:\s[^>]*)?>([\s\S]*?)<[/]w:(?:t|delText)>|<w:tab\s*[/]>|<w:tab>\s*<[/]w:tab>/g;
    let m;
    while ((m = re.exec(deleted ? xml : live)) !== null) {
      if (m[1] === void 0) segs.push("");
      else segs[segs.length - 1] += m[1];
    }
    const right = segs.length > 1 ? segs.pop() : "";
    let num2;
    if (segs.length > 1) {
      const first = decodeEntities(segs[0]).trim();
      if (/^\S{1,15}$/.test(first)) {
        num2 = first;
        segs.shift();
      }
    }
    const left = segs.map((s) => decodeEntities(s).trim()).filter(Boolean).join(" ");
    const anchor = /<w:hyperlink [^>]*w:anchor="([^"]+)"/.exec(xml)?.[1];
    const leader = tocLeaderOf(pPr, styles?.get(styleId));
    const line = lineTwipsOf(tagAttr(pPr, "w:spacing", "w:line"));
    const lineRule = lineRuleOf(pPr);
    let sz = 0;
    let font;
    let bold = false;
    let runStyleId;
    const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
    let run2;
    while ((run2 = runRe.exec(xml)) !== null) {
      if (!/<w:(?:t|delText)(?:\s|>)/.test(run2[1]) || run2[1].includes("<w:instrText")) continue;
      const v = parseInt(tagAttr(run2[1], "w:sz", "w:val") ?? "", 10);
      if (v > sz) sz = v;
      if (font === void 0) {
        const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(run2[1])?.[0] ?? "";
        runStyleId = /<w:rStyle w:val="([^"]+)"/.exec(rPr)?.[1];
        const text = Array.from(
          run2[1].matchAll(/<w:(?:t|delText)(?:\s[^>]*)?>([\s\S]*?)<\/w:(?:t|delText)>/g),
          (m2) => m2[1]
        ).join("");
        font = leadingRunFont(rPr, text) ?? "";
        bold = onOffTagIn(rPr, "w:b") === true;
      }
    }
    return {
      kind: "tocLine",
      left,
      right: decodeEntities(right).trim(),
      level: tocLevel,
      ...num2 ? { num: num2 } : {},
      ...anchor ? { anchor } : {},
      ...deleted ? { deleted } : {},
      ...deleted && /<w:del\b[^>]*\/>/.test(pPr) ? { markDeleted: true } : {},
      ...sz > 0 ? { szHalfPoints: sz } : {},
      ...font ? { fontFamily: font } : {},
      ...bold ? { bold } : {},
      ...runStyleId ? { runStyleId } : {},
      ...leader ? { leader } : {},
      ...line > 0 && lineRule ? {
        lineRule,
        lineRawTwips: line,
        ...lineRule === "auto" ? { lineSpacing: Math.round(line / 240 * 100) / 100 } : {}
      } : {},
      ...geometry
    };
  }
  xml = inlineEqFieldResults(xml);
  const visible = plainText(xml).trim();
  if (visible === "" && /<w:br\s[^>]*w:type="page"/.test(xml)) {
    return { kind: "pageBreak" };
  }
  if (visible !== "") {
    let font;
    const szWeights = /* @__PURE__ */ new Map();
    const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
    let run2;
    while ((run2 = runRe.exec(xml)) !== null) {
      if (!/<w:t(?:\s|>)/.test(run2[1]) || run2[1].includes("<w:instrText")) continue;
      const text = decodeEntities(
        Array.from(run2[1].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g), (m) => m[1]).join("")
      );
      const v = parseInt(tagAttr(run2[1], "w:sz", "w:val") ?? "", 10);
      const key = v > 0 ? v : 0;
      szWeights.set(key, (szWeights.get(key) ?? 0) + Math.max(text.length, 1));
      if (!font) {
        const fonts = /<w:rFonts [^/>]*/.exec(run2[1])?.[0] ?? "";
        font = /w:eastAsia="([^"]+)"/.exec(fonts)?.[1] ?? /w:ascii="([^"]+)"/.exec(fonts)?.[1];
      }
    }
    let sz = 0;
    let szWeight = -1;
    for (const [v, w] of szWeights) {
      if (w > szWeight || w === szWeight && v > sz) {
        sz = v;
        szWeight = w;
      }
    }
    const jc = /<w:jc w:val="([^"]+)"/.exec(pPr)?.[1];
    const align = jc === "left" || jc === "start" ? "left" : jc === "right" || jc === "end" ? "right" : jc === "center" ? "center" : jc === "both" || jc === "distribute" || /kashida$|^thaiDistribute$/i.test(jc ?? "") ? "justify" : void 0;
    const line = lineTwipsOf(tagAttr(pPr, "w:spacing", "w:line"));
    const lineRule = lineRuleOf(pPr);
    return {
      kind: "text",
      left: visible,
      ...sz > 0 ? { szHalfPoints: sz } : {},
      ...font ? { fontFamily: font } : {},
      ...align ? { align } : {},
      ...line > 0 && lineRule ? {
        lineRule,
        lineRawTwips: line,
        ...lineRule === "auto" ? { lineSpacing: Math.round(line / 240 * 100) / 100 } : {}
      } : {},
      ...geometry
    };
  }
  return void 0;
}
function applyTocEntryNumbers(blocks, numbering) {
  if (numbering.size === 0) return;
  const items = [];
  const tocAt = /* @__PURE__ */ new Map();
  for (const block of blocks) {
    if (block.list?.numId) {
      items.push({ numId: block.list.numId, ilvl: block.list.ilvl });
      continue;
    }
    const fd = block.fieldDisplay;
    if (block.type !== "passthrough" || fd?.kind !== "tocLine" || !block.originalXml) continue;
    const numPr = /<w:numPr>[\s\S]*?<\/w:numPr>/.exec(block.originalXml)?.[0];
    if (!numPr) continue;
    const numId = /<w:numId w:val="([^"]+)"/.exec(numPr)?.[1];
    if (!numId) continue;
    const ilvl = parseInt(/<w:ilvl w:val="(\d+)"/.exec(numPr)?.[1] ?? "0", 10);
    tocAt.set(items.length, fd);
    items.push({ numId, ilvl });
  }
  if (tocAt.size === 0) return;
  const markers = computeListMarkers(items, numbering);
  for (const [i, fd] of tocAt) {
    const marker = markers[i];
    if (marker && !/^[•◦▪➢❖✓]$/.test(marker)) fd.num = marker;
  }
}
function fieldStackAfter(xml, stack) {
  const next = [...stack];
  const re = /<w:fldChar\b[^>]*\bw:fldCharType=(?:"(begin|separate|end)"|'(begin|separate|end)')/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const kind = m[1] ?? m[2];
    if (kind === "begin") next.push(false);
    else if (kind === "separate") {
      if (next.length > 0) next[next.length - 1] = true;
    } else next.pop();
  }
  return next;
}
function markInsideFieldCode(stack) {
  return stack.length > 0 && !stack[stack.length - 1];
}
var FIELD_LABELS = {
  TOC: "Auto TOC (updates when opened in Word)",
  PAGE: "Page number field",
  NUMPAGES: "Page count field",
  PAGEREF: "Page reference field",
  REF: "Cross-reference field",
  SEQ: "Caption number field",
  HYPERLINK: "Hyperlink field",
  DATE: "Date field",
  TIME: "Time field",
  INCLUDEPICTURE: "Linked picture field",
  STYLEREF: "Style reference field"
};
function fieldLabel(xml) {
  const instr = /<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/.exec(xml)?.[1] ?? /<w:fldSimple[^>]*w:instr="([^"]*)"/.exec(xml)?.[1] ?? "";
  const keyword = instr.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (keyword && FIELD_LABELS[keyword]) return FIELD_LABELS[keyword];
  if (keyword) return `Field (${keyword})`;
  const hasEnd = xml.includes('fldCharType="end"') || xml.includes("fldCharType='end'");
  const hasBegin = xml.includes('fldCharType="begin"') || xml.includes("fldCharType='begin'");
  if (hasEnd && !hasBegin) {
    return xml.includes('w:type="page"') ? "Field end marker + page break" : "Field end marker";
  }
  return "Field (TOC/page number/etc.)";
}

// vendor/genoffice/docx/parse-drawing-geometry.ts
var LINE_PRSTS_RE = /<a:prstGeom[^>]*prst="(?:line|straightConnector1|bentConnector[234]|curvedConnector[234])"/;
var LINE_PRSTS = /* @__PURE__ */ new Set([
  "line",
  "straightConnector1",
  "bentConnector2",
  "bentConnector3",
  "bentConnector4",
  "curvedConnector2",
  "curvedConnector3",
  "curvedConnector4"
]);
function lineBoxOf(shape, theme) {
  const spPr = findChild(shape, "wps:spPr");
  if (!spPr) return null;
  const prst = attrsOf(findChild(spPr, "a:prstGeom") ?? {})["prst"];
  if (!prst || !LINE_PRSTS.has(prst)) return null;
  const box = { paras: [], readOnly: true };
  const ln = findChild(spPr, "a:ln");
  const border = (ln ? attrsOf(findChild(findChild(ln, "a:solidFill") ?? {}, "a:srgbClr") ?? {})["val"] : void 0) ?? // theme-styled connectors (Word gallery): stroke from wps:style a:lnRef
  colorNodeHex(findChild(findChild(shape, "wps:style") ?? {}, "a:lnRef"), theme);
  box.borderColor = border ?? "000000";
  const arrowEnd = (name) => {
    const type = attrsOf(findChild(ln ?? {}, name) ?? {})["type"];
    return !!type && type !== "none";
  };
  const head = arrowEnd("a:headEnd");
  const tail = arrowEnd("a:tailEnd");
  box.prst = prst.startsWith("bentConnector") ? "lineBent" : prst.startsWith("curvedConnector") ? "lineCurved" : head && tail ? "lineArrowDouble" : head || tail ? "lineArrow" : "line";
  const xfrm = findChild(spPr, "a:xfrm");
  const xfrmAttrs = attrsOf(xfrm ?? {});
  const ext = findChild(xfrm ?? {}, "a:ext");
  const cx = ext ? parseInt(attrsOf(ext)["cx"] ?? "", 10) : NaN;
  const cy = ext ? parseInt(attrsOf(ext)["cy"] ?? "", 10) : NaN;
  if (Number.isFinite(cx) && cx > 0) box.widthPx = Math.round(cx / EMU_PER_PX2);
  const straight = box.prst === "line" || box.prst === "lineArrow" || box.prst === "lineArrowDouble";
  if (straight) {
    if (xfrmAttrs["flipH"] === "1" || xfrmAttrs["flipH"] === "true") box.flipH = true;
    if (xfrmAttrs["flipV"] === "1" || xfrmAttrs["flipV"] === "true") box.flipV = true;
  }
  if (Number.isFinite(cy) && cy > 0) {
    box.heightPx = Math.round(cy / EMU_PER_PX2);
    box.minHeightPx = box.heightPx;
    if (straight && (box.heightPx > 12 || box.flipH || box.flipV)) box.lineDiag = true;
  } else {
    box.heightPx = 12;
  }
  if (head && !tail && box.prst === "lineArrow") {
    const fh = !box.flipH;
    const fv = !box.flipV;
    delete box.flipH;
    delete box.flipV;
    if (fh) box.flipH = true;
    if (fv) box.flipV = true;
  }
  box.insetTopPx = 0;
  box.insetRightPx = 0;
  box.insetBottomPx = 0;
  box.insetLeftPx = 0;
  return box;
}
var SCHEME_CLR_SLOTS = {
  tx1: "dk1",
  bg1: "lt1",
  tx2: "dk2",
  bg2: "lt2",
  dk1: "dk1",
  lt1: "lt1",
  dk2: "dk2",
  lt2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink"
};
var PRST_CLR_HEX = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  gray: "808080"
};
function gradStopRgb(gs, theme) {
  const srgb = attrsOf(findChild(gs, "a:srgbClr") ?? {})["val"];
  let base = srgb;
  if (!base) {
    const sys = findChild(gs, "a:sysClr");
    if (sys) {
      const a = attrsOf(sys);
      base = a["lastClr"] ?? (a["val"] === "windowText" ? "000000" : "FFFFFF");
    }
  }
  if (!base) {
    const prst = findChild(gs, "a:prstClr");
    if (prst) base = PRST_CLR_HEX[attrsOf(prst)["val"] ?? ""];
  }
  const scheme = base ? void 0 : findChild(gs, "a:schemeClr");
  if (!base && scheme) {
    const slot2 = SCHEME_CLR_SLOTS[attrsOf(scheme)["val"] ?? ""];
    if (!slot2) return null;
    base = theme?.[slot2] ?? DEFAULT_THEME_COLORS[slot2];
  }
  if (!base || !/^[0-9A-Fa-f]{6}$/.test(base)) return null;
  let rgb = [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16));
  if (scheme) {
    const pct = (name) => {
      const v = parseInt(attrsOf(findChild(scheme, name) ?? {})["val"] ?? "", 10);
      return Number.isFinite(v) ? Math.min(1e5, Math.max(0, v)) / 1e5 : null;
    };
    const lumMod = pct("a:lumMod");
    if (lumMod !== null) rgb = rgb.map((c) => c * lumMod);
    const lumOff = pct("a:lumOff");
    if (lumOff !== null) rgb = rgb.map((c) => c + 255 * lumOff);
    const shade = pct("a:shade");
    if (shade !== null) rgb = rgb.map((c) => c * shade);
    const tint = pct("a:tint");
    if (tint !== null) rgb = rgb.map((c) => c * tint + 255 * (1 - tint));
  }
  return rgb;
}
function colorNodeHex(node, theme) {
  if (!node) return void 0;
  const rgb = gradStopRgb(node, theme);
  if (!rgb) return void 0;
  return rgb.map(
    (c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0").toUpperCase()
  ).join("");
}
function drawingOpenAt(xml, from) {
  const re = /<w:drawing[\s>]/g;
  re.lastIndex = from;
  return re.exec(xml)?.index ?? -1;
}
function topLevelDrawings(xml) {
  const out = [];
  let i = 0;
  for (; ; ) {
    const start = drawingOpenAt(xml, i);
    if (start === -1) break;
    let depth = 0;
    let j = start;
    for (; ; ) {
      const open = drawingOpenAt(xml, j + 1);
      const close = xml.indexOf("</w:drawing>", j + 1);
      if (close === -1) return out;
      if (open !== -1 && open < close) {
        depth++;
        j = open;
      } else if (depth > 0) {
        depth--;
        j = close;
      } else {
        out.push(xml.slice(start, close + "</w:drawing>".length));
        i = close + "</w:drawing>".length;
        break;
      }
    }
  }
  return out;
}
function drawingAnchorMeta(frag) {
  const anchorTag = /<wp:anchor[^>]*>/.exec(frag)?.[0];
  if (!anchorTag) return {};
  const meta = { anchored: true };
  const posOf = (dir) => {
    const m = new RegExp(`<wp:position${dir}[^>]*>\\s*<wp:posOffset>(-?\\d+)</wp:posOffset>`).exec(
      frag
    );
    const v = m ? parseInt(m[1], 10) : NaN;
    return Number.isFinite(v) ? v : void 0;
  };
  meta.offsetXEmu = posOf("H");
  meta.offsetYEmu = posOf("V");
  for (const side of ["L", "R"]) {
    const v = parseInt(
      new RegExp(`\\bdist${side}\\s*=\\s*["'](\\d+)["']`).exec(anchorTag)?.[1] ?? "",
      10
    );
    if (Number.isFinite(v)) meta[`dist${side}Emu`] = v;
  }
  for (const dir of ["H", "V"]) {
    const m = new RegExp(`<wp:position${dir}\\b([^>]*)>([\\s\\S]*?)</wp:position${dir}>`).exec(frag);
    if (!m) continue;
    const rel = /relativeFrom\s*=\s*["'](\w+)["']/.exec(m[1])?.[1];
    const align = /<wp:align>(\w+)<\/wp:align>/.exec(m[2])?.[1];
    const pct = parseInt(
      new RegExp(`<wp14:pctPos${dir}Offset[^>]*>(-?\\d+)<`).exec(m[2])?.[1] ?? "",
      10
    );
    if (dir === "H") {
      meta.relH = rel;
      meta.alignH = align;
      if (Number.isFinite(pct)) meta.pctH = pct;
    } else {
      meta.relV = rel;
      meta.alignV = align;
      if (Number.isFinite(pct)) meta.pctV = pct;
    }
  }
  const extentTag = /<wp:extent[^>]*\/?>/.exec(frag)?.[0] ?? "";
  const extentX = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
  const extentY = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
  if (Number.isFinite(extentX)) meta.extentXEmu = extentX;
  if (Number.isFinite(extentY)) meta.extentYEmu = extentY;
  const graphicAt = frag.indexOf("<a:graphic");
  const ownXml = graphicAt === -1 ? frag : frag.slice(0, graphicAt);
  const behind = /behindDoc\s*=\s*["'](?:1|true)["']/.test(anchorTag);
  const ownWrapped = /<wp:wrap(?:Square|Tight|Through|TopAndBottom)\b/.test(ownXml);
  if (frag.includes("<wp:wrapNone") || behind && !ownWrapped) meta.noWrap = true;
  if (behind) meta.behind = true;
  const relHeight = Number(/relativeHeight\s*=\s*["'](\d+)["']/.exec(anchorTag)?.[1] ?? NaN);
  if (Number.isFinite(relHeight) && relHeight - 251658240 !== 0) meta.z = relHeight - 251658240;
  if (ownXml.includes("<wp:wrapTopAndBottom")) meta.topBottom = true;
  return meta;
}
var EMU_PER_TWIP = 635;
var MIN_WRAP_SLIVER_EMU = 36 * 9525;
var DEFAULT_WRAP_DIST_EMU = 114300;
function resolveAnchorPagePos(meta, sect) {
  if (!sect) return null;
  const relH = meta.relH === "column" && sect.columns <= 1 && meta.pctH === void 0 ? "margin" : meta.relH;
  if (relH !== "page" && relH !== "margin") return null;
  if (meta.pctH === void 0 && meta.alignH === void 0) return null;
  const pageW = sect.pageWidth * EMU_PER_TWIP;
  const pageH = sect.pageHeight * EMU_PER_TWIP;
  const marL = sect.marginLeft * EMU_PER_TWIP;
  const marR = sect.marginRight * EMU_PER_TWIP;
  const marT = sect.marginTop * EMU_PER_TWIP;
  const w = meta.extentXEmu ?? 0;
  const refW = relH === "page" ? pageW : pageW - marL - marR;
  const relX = meta.pctH !== void 0 ? Math.round(refW * meta.pctH / 1e5) : meta.alignH === "center" ? Math.round((refW - w) / 2) : meta.alignH === "right" || meta.alignH === "outside" ? refW - w : 0;
  const pageX = relH === "page" ? relX : marL + relX;
  const pos = {
    xEmu: pageX - marL,
    outsideColumn: pageX + w <= marL || pageX >= pageW - marR
  };
  if ((meta.relV === "page" || meta.relV === "margin") && (meta.pctV !== void 0 || meta.alignV !== void 0)) {
    const marB = sect.marginBottom * EMU_PER_TWIP;
    const h = meta.extentYEmu ?? 0;
    const refH = meta.relV === "page" ? pageH : pageH - marT - marB;
    const relY = meta.pctV !== void 0 ? Math.round(refH * meta.pctV / 1e5) : meta.alignV === "center" ? Math.round((refH - h) / 2) : meta.alignV === "bottom" || meta.alignV === "outside" ? refH - h : 0;
    pos.yEmu = (meta.relV === "page" ? relY : marT + relY) - marT;
  }
  return pos;
}
function gradFillApproxHex(spPr, theme) {
  const gsLst = findChild(findChild(spPr, "a:gradFill") ?? {}, "a:gsLst");
  if (!gsLst) return void 0;
  const stops = childrenOf(gsLst).filter((n) => nameOf(n) === "a:gs").map((gs) => gradStopRgb(gs, theme)).filter((rgb) => rgb !== null);
  if (stops.length === 0) return void 0;
  return [0, 1, 2].map((i) => stops.reduce((sum, rgb) => sum + rgb[i], 0) / stops.length).map(
    (c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0").toUpperCase()
  ).join("");
}
function rgbHex2(rgb) {
  return rgb.map(
    (c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0").toUpperCase()
  ).join("");
}
function w14ColorRgb(node, theme) {
  const colorNode = findChild(node, "w14:srgbClr") ?? findChild(node, "w14:schemeClr");
  if (!colorNode) return null;
  const isScheme = nameOf(colorNode) === "w14:schemeClr";
  let base = attrsOf(colorNode)["w14:val"];
  if (isScheme) {
    const slot2 = SCHEME_CLR_SLOTS[base ?? ""];
    if (!slot2) return null;
    base = theme?.[slot2] ?? DEFAULT_THEME_COLORS[slot2];
  }
  if (!base || !/^[0-9A-Fa-f]{6}$/.test(base)) return null;
  let rgb = [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16));
  const pct = (name) => {
    const v = parseInt(attrsOf(findChild(colorNode, name) ?? {})["w14:val"] ?? "", 10);
    return Number.isFinite(v) && v >= 0 ? v / 1e5 : null;
  };
  const lumMod = pct("w14:lumMod");
  if (lumMod !== null) rgb = rgb.map((c) => c * lumMod);
  const lumOff = pct("w14:lumOff");
  if (lumOff !== null) rgb = rgb.map((c) => c + 255 * lumOff);
  const shade = pct("w14:shade");
  if (shade !== null) rgb = rgb.map((c) => c * shade);
  const tint = pct("w14:tint");
  if (tint !== null) rgb = rgb.map((c) => c * tint + 255 * (1 - tint));
  const satMod = pct("w14:satMod");
  if (satMod !== null && satMod !== 1) rgb = saturationModulate(rgb, satMod);
  return rgb;
}
function saturationModulate(rgb, mod) {
  const [r, g, b] = rgb.map((c) => Math.min(255, Math.max(0, c)) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return rgb;
  let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  s = Math.min(1, s * mod);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((c) => c * 255);
}
function w14TextFillHex(rPr, theme) {
  const tf = findChild(rPr, "w14:textFill");
  if (!tf) return void 0;
  const solid = findChild(tf, "w14:solidFill");
  if (solid) {
    const rgb = w14ColorRgb(solid, theme);
    return rgb ? rgbHex2(rgb) : void 0;
  }
  const gsLst = findChild(findChild(tf, "w14:gradFill") ?? {}, "w14:gsLst");
  if (!gsLst) return void 0;
  const stops = childrenOf(gsLst).filter((n) => nameOf(n) === "w14:gs").map((gs) => w14ColorRgb(gs, theme)).filter((rgb) => rgb !== null);
  if (stops.length === 0) return void 0;
  return rgbHex2([0, 1, 2].map((i) => stops.reduce((sum, rgb) => sum + rgb[i], 0) / stops.length));
}
function w14TextOutlineOf(rPr, theme) {
  const outline = findChild(rPr, "w14:textOutline");
  if (!outline) return void 0;
  const solid = findChild(outline, "w14:solidFill");
  if (!solid) return void 0;
  const rgb = w14ColorRgb(solid, theme);
  if (!rgb) return void 0;
  const widthEmu = parseInt(attrsOf(outline)["w14:w"] ?? "", 10);
  if (!(widthEmu > 0)) return void 0;
  const colorNode = findChild(solid, "w14:srgbClr") ?? findChild(solid, "w14:schemeClr");
  const alphaRaw = parseInt(
    attrsOf(findChild(colorNode ?? {}, "w14:alpha") ?? {})["w14:val"] ?? "",
    10
  );
  const alpha = alphaRaw >= 0 && alphaRaw < 1e5 ? alphaRaw / 1e5 : void 0;
  return {
    color: rgbHex2(rgb),
    widthPt: Math.round(widthEmu / 12700 * 100) / 100,
    ...alpha !== void 0 ? { alpha } : {}
  };
}
function w14GlowOf(rPr, theme) {
  const glow = findChild(rPr, "w14:glow");
  if (!glow) return void 0;
  const rgb = w14ColorRgb(glow, theme);
  const radEmu = parseInt(attrsOf(glow)["w14:rad"] ?? "", 10);
  if (!rgb || !(radEmu > 0)) return void 0;
  const colorNode = findChild(glow, "w14:srgbClr") ?? findChild(glow, "w14:schemeClr");
  const alphaRaw = parseInt(
    attrsOf(findChild(colorNode ?? {}, "w14:alpha") ?? {})["w14:val"] ?? "",
    10
  );
  const alpha = alphaRaw >= 0 && alphaRaw < 1e5 ? alphaRaw / 1e5 : void 0;
  return {
    color: rgbHex2(rgb),
    radiusPt: Math.round(radEmu / 12700 * 100) / 100,
    ...alpha !== void 0 ? { alpha } : {}
  };
}
var IDENTITY_CTM = { sx: 1, sy: 1, tx: 0, ty: 0 };
function composeGroupCtm(group, outer) {
  const xfrm = findChild(findChild(group, "wpg:grpSpPr") ?? {}, "a:xfrm");
  if (!xfrm) return null;
  const num2 = (node, key, dflt) => {
    const v = parseInt(attrsOf(node ?? {})[key] ?? "", 10);
    return Number.isFinite(v) ? v : dflt;
  };
  const ox = num2(findChild(xfrm, "a:off"), "x", 0);
  const oy = num2(findChild(xfrm, "a:off"), "y", 0);
  const ex = num2(findChild(xfrm, "a:ext"), "cx", 0);
  const ey = num2(findChild(xfrm, "a:ext"), "cy", 0);
  const chOffX = num2(findChild(xfrm, "a:chOff"), "x", 0);
  const chOffY = num2(findChild(xfrm, "a:chOff"), "y", 0);
  const chExtX = num2(findChild(xfrm, "a:chExt"), "cx", 0);
  const chExtY = num2(findChild(xfrm, "a:chExt"), "cy", 0);
  const sx = ex > 0 && chExtX > 0 ? ex / chExtX : 1;
  const sy = ey > 0 && chExtY > 0 ? ey / chExtY : 1;
  return {
    sx: outer.sx * sx,
    sy: outer.sy * sy,
    tx: outer.tx + outer.sx * (ox - chOffX * sx),
    ty: outer.ty + outer.sy * (oy - chOffY * sy)
  };
}

// vendor/genoffice/docx/parse-props.ts
function staysVanished(xml) {
  if (/<w:vanish\s[^>]*w:val=(?:"(?:0|false|none|off)"|'(?:0|false|none|off)')/i.test(xml))
    return false;
  return !/<w:(?:drawing|pict|object|sectPr|bookmarkStart|commentRangeStart|commentRangeEnd|numPr)[\s/>]/.test(
    xml
  );
}
var LAYOUT_RUN_CONTENT = /^w:(?:br|cr|tab|sym|footnoteReference|endnoteReference)$/;
function hasLayoutRunContent(node, pattern = LAYOUT_RUN_CONTENT) {
  for (const child of childrenOf(node)) {
    const name = nameOf(child);
    if (name === "w:pPr" || name === "w:rPr") continue;
    if (name !== void 0 && pattern.test(name)) return true;
    if (hasLayoutRunContent(child, pattern)) return true;
  }
  return false;
}
var LAYOUT_RUN_CONTENT_BESIDES_BREAKS = /^w:(?:cr|tab|sym|footnoteReference|endnoteReference)$/;
function crossParaCommentMarkers(xml) {
  const ids = (re) => [...xml.matchAll(re)].map((m) => m[1]);
  const starts = ids(/<w:commentRangeStart\b[^>]*\bw:id\s*=\s*["']([^"']+)["']/g);
  const ends = ids(/<w:commentRangeEnd\b[^>]*\bw:id\s*=\s*["']([^"']+)["']/g);
  const onlyStarts = starts.filter((id) => !ends.includes(id));
  const onlyEnds = ends.filter((id) => !starts.includes(id));
  return {
    commentStarts: onlyStarts.length ? onlyStarts : void 0,
    commentEnds: onlyEnds.length ? onlyEnds : void 0
  };
}
function bookmarkNamesOf(xml) {
  const names = [];
  const hidden = [];
  for (const m of xml.matchAll(/<w:bookmarkStart [^>]*w:name=(?:"([^"]+)"|'([^']+)')/g)) {
    const name = decodeEntities(m[1] ?? m[2] ?? "");
    const list = name.startsWith("_") ? hidden : names;
    if (!list.includes(name)) list.push(name);
  }
  return {
    bookmarks: names.length > 0 ? names : void 0,
    hiddenBookmarks: hidden.length > 0 ? hidden : void 0
  };
}
function rawPPrOf(xml) {
  const openEnd = xml.indexOf(">") + 1;
  if (openEnd === 0) return void 0;
  const start = openEnd + (/^\s*/.exec(xml.slice(openEnd))?.[0].length ?? 0);
  if (!xml.startsWith("<w:pPr", start)) return void 0;
  const re = /<w:pPr(?=[\s/>])|<\/w:pPr>/g;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(xml)) !== null) {
    if (match[0] === "</w:pPr>") {
      depth--;
      if (depth === 0) return xml.slice(start, match.index + match[0].length);
    } else {
      const gt = xml.indexOf(">", match.index);
      if (xml[gt - 1] === "/") {
        if (depth === 0) return xml.slice(start, gt + 1);
        continue;
      }
      depth++;
    }
  }
  return void 0;
}
function isThinRule(xml) {
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
  if (!m) return false;
  const cx = parseInt(m[1], 10);
  const cy = parseInt(m[2], 10);
  return cy <= 13e4 && (cy > 0 || cx > 0);
}
function ruleDisplayOf(xml) {
  const out = {};
  const ln = /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(xml)?.[0];
  if (ln) {
    const color = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(ln)?.[1];
    if (color) out.ruleColorHex = color.toUpperCase();
    const w = parseInt(/<a:ln\b[^>]*\bw="(\d+)"/.exec(ln)?.[1] ?? "", 10);
    if (Number.isFinite(w) && w > 0) out.ruleThicknessPx = Math.max(1, Math.round(w / EMU_PER_PX2));
  }
  const cx = parseInt(/<wp:extent cx="(\d+)"/.exec(xml)?.[1] ?? "", 10);
  if (Number.isFinite(cx) && cx > 0) out.ruleWidthPx = Math.round(cx / EMU_PER_PX2);
  return out;
}
function isInvisibleEmptyShape(xml) {
  if (!xml.includes("<wps:wsp") || xml.includes("<a:blip") || plainText(xml).trim() !== "") {
    return false;
  }
  let parsed;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return false;
  }
  const shapes = [];
  collectNodes(parsed, "wps:wsp", shapes);
  if (shapes.length === 0) return false;
  return shapes.every((shape) => {
    const spPr = findChild(shape, "wps:spPr");
    if (!spPr || !findChild(spPr, "a:noFill")) return false;
    const ln = findChild(spPr, "a:ln");
    if (!ln || !findChild(ln, "a:noFill")) return false;
    const effects = findChild(spPr, "a:effectLst");
    return !effects || childrenOf(effects).length === 0;
  });
}
function isInvisibleVmlPict(xml) {
  if (!/<v:(?:shapetype|shape|rect|roundrect|oval|line|polyline)\b/.test(xml)) return false;
  if (xml.includes("<v:imagedata") || xml.includes("<w:txbxContent")) return false;
  const shapes = xml.match(/<v:(?:shape|rect|roundrect|oval|line|polyline)\b[^>]*>/g) ?? [];
  return shapes.every((tag2) => {
    const style = /style="([^"]*)"/.exec(tag2)?.[1] ?? "";
    if (/visibility:\s*hidden/.test(style)) return true;
    const fill = /fillcolor="([^"]+)"/.exec(tag2)?.[1]?.trim().toLowerCase();
    const unstroked = /\bstroked="(?:f|false|0)"/.test(tag2);
    return unstroked && (fill === "white" || fill === "#ffffff" || fill === "#fff");
  });
}
function stripTextboxes(xml) {
  return xml.includes("<w:txbxContent") ? xml.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, "") : xml;
}
function hostPageBreak(xml) {
  return /<w:br\s[^>]*w:type="page"/.test(stripTextboxes(xml));
}
function txbxHasStructuredContent(content) {
  return childrenOf(content).some((c) => {
    const n = nameOf(c);
    return n === "w:tbl" || n === "w:sdt";
  });
}
function collectNodes(nodes, name, out) {
  for (const node of nodes) {
    if (nameOf(node) === name) out.push(node);
    collectNodes(childrenOf(node), name, out);
  }
}
function collectTopNodes(nodes, name, out) {
  for (const node of nodes) {
    if (nameOf(node) === name) {
      out.push(node);
      continue;
    }
    collectTopNodes(childrenOf(node), name, out);
  }
}
var JC_ALIGN = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  // kashida/Thai justification variants: plain justify for non-Arabic/Thai text
  lowKashida: "justify",
  mediumKashida: "justify",
  highKashida: "justify",
  thaiDistribute: "justify",
  distribute: "distribute"
};
function autoSpaceOf(pPr) {
  const de = onOffOf(pPr, "w:autoSpaceDE");
  const dn = onOffOf(pPr, "w:autoSpaceDN");
  if (de === false && dn === false) return false;
  if (de === true || dn === true) return true;
  return void 0;
}
function tabStopsOf(pPr) {
  const tabsEl = findChild(pPr, "w:tabs");
  if (!tabsEl) return void 0;
  const stops = [];
  for (const tab of findChildren(tabsEl, "w:tab")) {
    const attrs = attrsOf(tab);
    const pos = parseInt(attrs["w:pos"] ?? "", 10);
    const val2 = attrs["w:val"] ?? "left";
    if (!Number.isFinite(pos)) continue;
    const validVals = ["left", "center", "right", "decimal", "bar", "clear"];
    const safeVal = validVals.includes(val2) ? val2 : "left";
    const stop = { pos, val: safeVal };
    const leader = attrs["w:leader"];
    if (leader && leader !== "none") {
      const validLeaders = ["dot", "hyphen", "underscore", "heavy", "middleDot"];
      if (validLeaders.includes(leader)) {
        stop.leader = leader;
      }
    }
    stops.push(stop);
  }
  return stops.length > 0 ? stops : void 0;
}
function ptabDisplayStops(pNode) {
  const out = [];
  const walk = (n) => {
    for (const c of childrenOf(n)) {
      const name = nameOf(c);
      if (name === "w:pPr") continue;
      if (name === "w:ptab") {
        const a = attrsOf(c);
        const align = a["w:alignment"];
        if (align !== "center" && align !== "right") continue;
        const stop = {
          pos: align === "center" ? 50 : 100,
          val: align,
          rel: "margin"
        };
        const leader = a["w:leader"];
        if (leader === "dot" || leader === "hyphen" || leader === "underscore" || leader === "heavy" || leader === "middleDot") {
          stop.leader = leader;
        }
        out.push(stop);
      } else walk(c);
    }
  };
  walk(pNode);
  return out;
}
var SIMPLE_INLINE_FIELD_RE = /^\s*(DATE|TIME|CREATEDATE|SAVEDATE|NUMPAGES|FILENAME|AUTHOR|PAGEREF|PAGE)\b/;
function fieldCharsBalanced(xml) {
  let depth = 0;
  const re = /<w:fldChar\b[^>]*\bw:fldCharType=(?:"(begin|end)"|'(begin|end)')/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if ((m[1] ?? m[2]) === "begin") depth++;
    else if (--depth < 0) return false;
  }
  return depth === 0;
}
var ZOTERO_INLINE_FIELD_RE = /^\s*(?:ADDIN\s+)?(?:ZOTERO_|CSL_)(?:ITEM|BIBL|TEMP)\b/i;
function convertibleHyperlink(instr) {
  const m = /^\s*HYPERLINK\s+"([^"\\]+)"\s*(?:\\o\s+"([^"]*)"\s*)?$/.exec(
    decodeNumericCharRefs(instr)
  );
  if (!m) return null;
  return { href: m[1], ...m[2] ? { tooltip: m[2] } : {} };
}
function onlyOleFields(xml) {
  if (xml.includes("<w:fldSimple")) return false;
  const instrs = xml.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) ?? [];
  if (instrs.length === 0) return false;
  return instrs.every(
    (fragment) => /^\s*(EMBED|LINK)\b/.test(decodeEntities(fragment.replace(/<[^>]+>/g, "")))
  );
}
function onlyXeFields(xml) {
  const simple = [...xml.matchAll(/<w:fldSimple\b([^>]*)>/g)].map(
    (m) => /\bw:instr="([^"]*)"/.exec(m[1])?.[1]
  );
  if (simple.some((instr) => instr === void 0)) return false;
  const instrs = xml.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) ?? [];
  if (instrs.length === 0 && simple.length === 0) return false;
  if (!fieldCharsBalanced(xml)) return false;
  const simpleOk = simple.every((raw) => {
    const text = decodeEntities(raw);
    return /^\s*XE[\s"]/.test(text) || /^\s*REF\s/.test(text) || SIMPLE_INLINE_FIELD_RE.test(text);
  });
  if (!simpleOk) return false;
  let checkboxInstrs = 0;
  const ok = instrs.every((fragment) => {
    const text = decodeEntities(fragment.replace(/<[^>]+>/g, ""));
    if (/^\s*FORMCHECKBOX\s*$/.test(text)) {
      checkboxInstrs++;
      return true;
    }
    return /^\s*XE[\s"]/.test(text) || /^\s*REF\s/.test(text) || ZOTERO_INLINE_FIELD_RE.test(text) || SIMPLE_INLINE_FIELD_RE.test(text) || convertibleHyperlink(text) !== null;
  });
  if (!ok) return false;
  const checkBoxDefs = (xml.match(/<w:checkBox[\s/>]/g) ?? []).length;
  return checkboxInstrs <= checkBoxDefs;
}
function checkboxStateOf(beginRun) {
  if (!beginRun) return null;
  const ffData = findChild(findChild(beginRun, "w:fldChar") ?? {}, "w:ffData");
  const box = ffData ? findChild(ffData, "w:checkBox") : void 0;
  if (!box) return null;
  const state = findChild(box, "w:checked") ?? findChild(box, "w:default");
  if (!state) return { checked: false };
  const val2 = attrsOf(state)["w:val"];
  return { checked: isOn(val2) };
}
function indentTwipsOf(ind) {
  const a = attrsOf(ind);
  const out = {};
  const left = parseInt(a["w:left"] ?? a["w:start"] ?? "", 10);
  if (Number.isFinite(left)) out.left = left;
  const right = parseInt(a["w:right"] ?? a["w:end"] ?? "", 10);
  if (Number.isFinite(right)) out.right = right;
  const firstLine = parseInt(a["w:firstLine"] ?? "", 10);
  const hanging = parseInt(a["w:hanging"] ?? "", 10);
  if (hanging > 0) out.firstLine = -hanging;
  else if (firstLine > 0) out.firstLine = firstLine;
  else if (Number.isFinite(firstLine) || Number.isFinite(hanging)) out.firstLine = 0;
  return out;
}
function charIndentsOf(ind) {
  if (!ind) return void 0;
  const a = attrsOf(ind);
  const num2 = (v) => {
    const n = parseInt(v ?? "", 10);
    return Number.isFinite(n) ? n : void 0;
  };
  const chars = {};
  const left = num2(a["w:leftChars"] ?? a["w:startChars"]);
  if (left !== void 0) chars.left = left;
  const right = num2(a["w:rightChars"] ?? a["w:endChars"]);
  if (right !== void 0) chars.right = right;
  const firstLine = num2(a["w:firstLineChars"]);
  if (firstLine !== void 0 && firstLine >= 0) chars.firstLine = firstLine;
  const hanging = num2(a["w:hangingChars"]);
  if (hanging !== void 0 && hanging >= 0) chars.hanging = hanging;
  return Object.keys(chars).length > 0 ? chars : void 0;
}
function mergeCharIndents(base, over) {
  if (!base) return over;
  if (!over) return base;
  const merged = { ...base };
  if (over.left !== void 0) merged.left = over.left;
  if (over.right !== void 0) merged.right = over.right;
  if (over.firstLine !== void 0 || over.hanging !== void 0) {
    delete merged.firstLine;
    delete merged.hanging;
    if (over.firstLine !== void 0) merged.firstLine = over.firstLine;
    if (over.hanging !== void 0) merged.hanging = over.hanging;
  }
  return merged;
}
function activeCharIndents(chars) {
  if (!chars) return void 0;
  const active = {};
  if (chars.left) active.left = chars.left;
  if (chars.right) active.right = chars.right;
  if (chars.firstLine) active.firstLine = chars.firstLine;
  if (chars.hanging) active.hanging = chars.hanging;
  return Object.keys(active).length > 0 ? active : void 0;
}
function resolveCharIndents(format, chars, units) {
  const f = { ...format ?? {} };
  const twips = (hundredths, unit) => Math.round(hundredths / 100 * unit);
  const twipsHanging = f.indentFirstLine !== void 0 && f.indentFirstLine < 0 ? -f.indentFirstLine : 0;
  const twipsFirst = f.indentFirstLine !== void 0 && f.indentFirstLine > 0 ? f.indentFirstLine : 0;
  const hanging = chars.hanging !== void 0 ? twips(chars.hanging, units.run) : chars.firstLine !== void 0 ? 0 : twipsHanging;
  const firstLine = hanging > 0 ? 0 : chars.firstLine !== void 0 ? twips(chars.firstLine, units.run) : twipsFirst;
  if (chars.left !== void 0 || chars.hanging !== void 0) {
    const uiLeft = chars.left !== void 0 ? twips(chars.left, units.normal) : 0;
    f.indentLeft = uiLeft + hanging;
  }
  if (hanging > 0) f.indentFirstLine = -hanging;
  else if (firstLine > 0) f.indentFirstLine = firstLine;
  else if (f.indentFirstLine) delete f.indentFirstLine;
  if (chars.right !== void 0) f.indentRight = twips(chars.right, units.normal);
  return f;
}
function emptyParaSizeHalfPoints(pNode, pPr, markOnly = false) {
  let sz = pPr ? attrsOf(findChild(findChild(pPr, "w:rPr") ?? {}, "w:sz") ?? {})["w:val"] : void 0;
  if (!sz && !markOnly) {
    for (const r of findChildren(pNode, "w:r")) {
      const v = attrsOf(findChild(findChild(r, "w:rPr") ?? {}, "w:sz") ?? {})["w:val"];
      if (v) sz = v;
    }
  }
  const n = sz ? parseInt(sz, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
function emptyParaMarkFont(pNode, pPr, themeFonts, markOnly = false) {
  const pick = (rPr) => {
    const a = attrsOf(findChild(rPr ?? {}, "w:rFonts") ?? {});
    const rf = themedRFonts(a, themeFonts);
    return rf.ascii ?? rf.hAnsi;
  };
  let font = pPr ? pick(findChild(pPr, "w:rPr")) : void 0;
  if (!font && !markOnly) {
    for (const r of findChildren(pNode, "w:r")) {
      const v = pick(findChild(r, "w:rPr"));
      if (v) font = v;
    }
  }
  return font;
}
var SPACE_ONLY_RE = /^[ \u00a0\u3000]+$/;
function spaceOnlyRuns(runs) {
  return runs.length > 0 && runs.every((r) => SPACE_ONLY_RE.test(r.text));
}
var BREAK_ONLY_RE = /^[\f\v \u00a0\u3000]*$/;
function breakOnlyRuns(runs) {
  return runs.every((r) => BREAK_ONLY_RE.test(r.text)) && runs.some((r) => /[\f\v]/.test(r.text));
}
var IMAGE_RUN_CHILDREN = /* @__PURE__ */ new Set([
  "w:drawing",
  "w:pict",
  "w:object",
  "mc:AlternateContent"
]);
function splitImageRun(rNode) {
  const attrs = rNode[":@"];
  const rPr = findChild(rNode, "w:rPr");
  const parts = [];
  let current = rPr ? [rPr] : [];
  for (const child of childrenOf(rNode)) {
    if (nameOf(child) === "w:rPr") continue;
    current.push(child);
    if (IMAGE_RUN_CHILDREN.has(nameOf(child) ?? "")) {
      parts.push(current);
      current = rPr ? [rPr] : [];
    }
  }
  if (current.length > (rPr ? 1 : 0)) parts.push(current);
  return parts.map((children) => ({ "w:r": children, ...attrs ? { ":@": attrs } : {} }));
}
function splitSymRun(rNode) {
  const kids = childrenOf(rNode).filter((c) => nameOf(c) !== "w:rPr");
  if (kids.length < 2 || !kids.some((c) => nameOf(c) === "w:sym")) return [rNode];
  const attrs = rNode[":@"];
  const rPr = findChild(rNode, "w:rPr");
  const parts = [];
  let current = [];
  for (const child of kids) {
    if (nameOf(child) === "w:sym") {
      if (current.length > 0) parts.push(current);
      parts.push([child]);
      current = [];
    } else current.push(child);
  }
  if (current.length > 0) parts.push(current);
  return parts.map((children) => ({
    "w:r": rPr ? [rPr, ...children] : children,
    ...attrs ? { ":@": attrs } : {}
  }));
}
function rubyFragmentsOf(xml) {
  return xml.match(/<w:ruby>[\s\S]*?<\/w:ruby>/g) ?? [];
}
function rubyPartText(rubyNode, part) {
  const partNode = findChild(rubyNode, part);
  if (!partNode) return "";
  let text = "";
  for (const r of childrenOf(partNode)) {
    if (nameOf(r) !== "w:r") continue;
    for (const c of childrenOf(r)) {
      if (nameOf(c) === "w:t") text += decodeNumericCharRefs(textOf(c));
    }
  }
  return text;
}
var EMPTY_EA_THEME_FONT = "DengXian";
var EMPTY_EA_SLOT_BY_LANG = {
  ja: { major: "Yu Gothic", minor: "Yu Mincho" },
  // Word probe + fontTable: ko-KR empty EA slot substitutes Malgun Gothic
  ko: { major: "Malgun Gothic", minor: "Malgun Gothic" }
};
var EA_LANG_SCRIPT = {
  ko: "Hang",
  ja: "Jpan",
  zh: "Hans",
  "zh-cn": "Hans",
  "zh-sg": "Hans",
  "zh-tw": "Hant",
  "zh-hk": "Hant",
  "zh-mo": "Hant"
};
var BIDI_LANG_SCRIPT = {
  ar: "Arab",
  fa: "Arab",
  ur: "Arab",
  ps: "Arab",
  ug: "Arab",
  he: "Hebr",
  yi: "Hebr",
  th: "Thai",
  syr: "Syrc",
  dv: "Thaa",
  hi: "Deva",
  mr: "Deva",
  ne: "Deva",
  bn: "Beng",
  pa: "Guru",
  gu: "Gujr",
  ta: "Taml",
  te: "Telu",
  kn: "Knda",
  ml: "Mlym",
  si: "Sinh",
  km: "Khmr",
  lo: "Laoo",
  bo: "Tibt",
  my: "Mymr",
  am: "Ethi",
  ti: "Ethi",
  ka: "Geor",
  hy: "Armn",
  mn: "Mong"
};
function emptyCsSlotFont(fonts, csRef) {
  const lang = fonts.bidiLang?.toLowerCase().split("-")[0];
  const script = lang ? BIDI_LANG_SCRIPT[lang] : void 0;
  const table = csRef === "majorBidi" ? fonts.majorScripts : fonts.minorScripts;
  return (script ? table?.[script] : void 0) ?? "Times New Roman";
}
function emptyEaSlotFont(fonts, eaRef) {
  return themeLangEaSlotFont(fonts, eaRef) ?? EMPTY_EA_THEME_FONT;
}
function themeLangEaSlotFont(fonts, eaRef) {
  const full = fonts.eaLang?.toLowerCase();
  if (!full) return void 0;
  const lang = full.split("-")[0];
  const script = EA_LANG_SCRIPT[full] ?? EA_LANG_SCRIPT[lang];
  const table = eaRef === "majorEastAsia" ? fonts.majorScripts : fonts.minorScripts;
  const fromScript = script ? table?.[script] : void 0;
  if (fromScript) return fromScript;
  const byLang = EMPTY_EA_SLOT_BY_LANG[lang];
  return byLang ? eaRef === "majorEastAsia" ? byLang.major : byLang.minor : void 0;
}
function themedRFonts(attrs, fonts) {
  const themeVal = (ref) => {
    if (!ref || !fonts) return void 0;
    switch (ref) {
      case "majorAscii":
      case "majorHAnsi":
        return fonts.major || void 0;
      case "minorAscii":
      case "minorHAnsi":
        return fonts.minor || void 0;
      case "majorEastAsia":
        return fonts.majorEastAsia || void 0;
      case "minorEastAsia":
        return fonts.eastAsia || void 0;
      case "majorBidi":
        return fonts.majorCs || void 0;
      case "minorBidi":
        return fonts.minorCs || void 0;
      default:
        return void 0;
    }
  };
  const eaRef = attrs["w:eastAsiaTheme"];
  const themedEa = themeVal(eaRef);
  const eaSlotEmpty = !themedEa && !!fonts && (eaRef === "majorEastAsia" || eaRef === "minorEastAsia");
  const themedOrEmptySlot = (ref) => {
    const themed = themeVal(ref);
    if (themed || !fonts) return themed;
    if (ref === "majorBidi" || ref === "minorBidi") return emptyCsSlotFont(fonts, ref);
    if (ref === "majorEastAsia" || ref === "minorEastAsia") return emptyEaSlotFont(fonts, ref);
    return void 0;
  };
  const themedAscii = themedOrEmptySlot(attrs["w:asciiTheme"]);
  const themedHAnsi = themedOrEmptySlot(attrs["w:hAnsiTheme"]);
  return {
    ascii: themedAscii ?? attrs["w:ascii"],
    hAnsi: themedHAnsi ?? attrs["w:hAnsi"],
    eastAsia: themedEa ?? (eaSlotEmpty ? emptyEaSlotFont(fonts, eaRef) : attrs["w:eastAsia"]),
    cs: themedOrEmptySlot(attrs["w:cstheme"]) ?? attrs["w:cs"],
    ...eaSlotEmpty ? { eaSlotEmpty } : {},
    themed: {
      ascii: themedAscii !== void 0,
      hAnsi: themedHAnsi !== void 0,
      eastAsia: themedEa !== void 0 || eaSlotEmpty
    }
  };
}
function partXmlSpacePreserve(partXml, rootTag) {
  const open = new RegExp(`<${rootTag}(\\s[^>]*)?>`).exec(partXml)?.[1] ?? "";
  return /\sxml:space=(?:"preserve"|'preserve')/.test(open);
}
function mergeRuns(runs) {
  const merged = [];
  for (const run2 of runs) {
    const prev = merged[merged.length - 1];
    if (prev && sameStyle(prev, run2)) prev.text += run2.text;
    else merged.push({ ...run2 });
  }
  return merged;
}
function sameStyle(a, b) {
  if (a.noteRef || b.noteRef || a.xeTerm !== void 0 || b.xeTerm !== void 0) return false;
  if (a.refField !== void 0 || b.refField !== void 0) return false;
  if (a.instrField !== void 0 || b.instrField !== void 0) return false;
  if (a.sdtCheckboxXml !== void 0 || b.sdtCheckboxXml !== void 0) return false;
  if (a.math || b.math) return false;
  if (a.sym || b.sym) return false;
  if (a.ruby || b.ruby) return false;
  if (a.image || b.image) return false;
  return (a.rawRPr ?? "") === (b.rawRPr ?? "") && a.styleId === b.styleId && !!a.cs === !!b.cs && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike && a.color === b.color && a.sizeHalfPoints === b.sizeHalfPoints && a.font === b.font && a.fontAscii === b.fontAscii && a.csFont === b.csFont && a.highlight === b.highlight && a.vertAlign === b.vertAlign && (a.link?.href ?? "") === (b.link?.href ?? "") && (a.link?.rId ?? "") === (b.link?.rId ?? "") && (a.link?.plain ?? false) === (b.link?.plain ?? false) && (a.commentIds ?? []).join(",") === (b.commentIds ?? []).join(",") && sameRevision(a.ins, b.ins) && sameRevision(a.del, b.del);
}
function sameRevision(a, b) {
  if (!a || !b) return !a === !b;
  return a.author === b.author && a.date === b.date && a.id === b.id;
}
var SHD_PCT_EXACT = { pct12: 12.5, pct37: 37.5, pct62: 62.5, pct87: 87.5 };
function blendHex(fg, bg, ratio) {
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  const mix = (i) => Math.round(ch(fg, i) * ratio + ch(bg, i) * (1 - ratio)).toString(16).padStart(2, "0");
  return (mix(0) + mix(2) + mix(4)).toUpperCase();
}
function shdDisplayFill(shd, theme) {
  if (!shd) return void 0;
  const a = attrsOf(shd);
  const hex = (v) => {
    const s = v ? stripHash(v) : void 0;
    return s && /^[0-9a-fA-F]{6}$/.test(s) ? s : void 0;
  };
  const themed = (slot2, tint, shade) => theme && a[slot2] ? resolveThemeColor(a[slot2], theme, a[tint], a[shade]) ?? void 0 : void 0;
  const fill = themed("w:themeFill", "w:themeFillTint", "w:themeFillShade") ?? (a["w:fill"] === "auto" ? void 0 : hex(a["w:fill"]));
  const val2 = a["w:val"] ?? "clear";
  if (val2 === "clear" || val2 === "nil") return fill;
  const ink = themed("w:themeColor", "w:themeTint", "w:themeShade") ?? (a["w:color"] === "auto" ? void 0 : hex(a["w:color"]));
  if (val2 === "solid") return ink ?? "000000";
  let ratio;
  if (val2.startsWith("pct")) {
    ratio = (SHD_PCT_EXACT[val2] ?? Number(val2.slice(3))) / 100;
    if (!(ratio > 0 && ratio <= 1)) ratio = void 0;
  } else if (/stripe|cross/i.test(val2)) {
    ratio = val2.startsWith("thin") ? 0.25 : 0.5;
  }
  if (ratio === void 0) return fill;
  return blendHex(ink ?? "000000", fill ?? "FFFFFF", ratio);
}
function rowBandSizeOf(tblPr) {
  const n = parseInt(
    attrsOf(findChild(tblPr ?? {}, "w:tblStyleRowBandSize") ?? {})["w:val"] ?? "",
    10
  );
  return n > 0 ? n : void 0;
}
function tableLookOf(tblPr) {
  const look = attrsOf(findChild(tblPr ?? {}, "w:tblLook") ?? {});
  const bits = parseInt(look["w:val"] ?? "", 16);
  const flag = (attr, bit, dflt) => look[attr] !== void 0 ? look[attr] !== "0" && look[attr] !== "false" : Number.isFinite(bits) ? (bits & bit) !== 0 : dflt;
  return {
    firstRow: flag("w:firstRow", 32, true),
    lastRow: flag("w:lastRow", 64, false),
    firstColumn: flag("w:firstColumn", 128, true),
    lastColumn: flag("w:lastColumn", 256, false),
    bandedRows: !flag("w:noHBand", 512, false),
    bandedColumns: !flag("w:noVBand", 1024, true)
  };
}
function borderLinesOf(node, withInside) {
  if (!node) return void 0;
  const ALIAS = {
    "w:top": "top",
    "w:left": "left",
    "w:bottom": "bottom",
    "w:right": "right",
    "w:start": "left",
    "w:end": "right",
    // the diagonals are cell-level only (CT_TblBorders has no tl2br/tr2bl child)
    ...withInside ? { "w:insideH": "insideH", "w:insideV": "insideV" } : { "w:tl2br": "tl2br", "w:tr2bl": "tr2bl" }
  };
  const borders = {};
  for (const [tag2, side] of Object.entries(ALIAS)) {
    const child = findChild(node, tag2);
    if (!child || borders[side]) continue;
    const a = attrsOf(child);
    if (!a["w:val"]) continue;
    borders[side] = {
      style: a["w:val"],
      ...a["w:sz"] ? { szEighths: Number(a["w:sz"]) || void 0 } : {},
      ...a["w:color"] ? { color: stripHash(a["w:color"]) } : {}
    };
  }
  return Object.keys(borders).length > 0 ? borders : void 0;
}
function paraBorderSidesOf(pPr, theme) {
  const pBdrs = findChildren(pPr, "w:pBdr");
  if (pBdrs.length === 0) return void 0;
  const sides = {};
  for (const [side, ch] of [
    ["top", "t"],
    ["bottom", "b"],
    ["left", "l"],
    ["right", "r"]
  ]) {
    let el;
    for (const pBdr of pBdrs) el = findChild(pBdr, `w:${side}`) ?? el;
    if (!el) continue;
    const a = attrsOf(el);
    const val2 = a["w:val"];
    if (val2 === "none" || val2 === "nil") {
      sides[ch] = null;
      continue;
    }
    const line = {};
    const themed = theme && a["w:themeColor"] ? resolveThemeColor(a["w:themeColor"], theme, a["w:themeTint"], a["w:themeShade"]) : void 0;
    if (themed) line.color = themed;
    else if (a["w:color"] && a["w:color"] !== "auto") line.color = stripHash(a["w:color"]);
    const sz = parseInt(a["w:sz"] ?? "", 10);
    if (Number.isFinite(sz) && sz > 0) line.szPt = sz / 8;
    const space = parseInt(a["w:space"] ?? "", 10);
    if (Number.isFinite(space) && space > 0) line.spacePt = space;
    sides[ch] = line;
  }
  return Object.keys(sides).length > 0 ? sides : void 0;
}
function paraBordersOf(sides) {
  const out = {};
  let borders = "";
  let reset = "";
  const lines = {};
  for (const ch of ["t", "b", "l", "r"]) {
    const line = sides[ch];
    if (line === void 0) continue;
    if (line === null) {
      reset += ch;
      continue;
    }
    borders += ch;
    if (line.color !== void 0 || line.szPt !== void 0 || line.spacePt !== void 0)
      lines[ch] = line;
  }
  if (borders) out.borders = borders;
  if (borders && Object.keys(lines).length > 0) out.borderLines = lines;
  if (reset) out.borderReset = reset;
  return out;
}
function mergeStyleBorders(sides, direct) {
  const declared = `${direct?.borders ?? ""}${direct?.borderReset ?? ""}`;
  const merged = {};
  for (const ch of ["t", "b", "l", "r"]) {
    if (direct?.borders?.includes(ch)) merged[ch] = direct.borderLines?.[ch] ?? {};
    else if (sides[ch] && !declared.includes(ch)) merged[ch] = sides[ch];
  }
  const { borders, borderLines } = paraBordersOf(merged);
  return { ...borders ? { borders } : {}, ...borderLines ? { borderLines } : {} };
}
function mergedBorderLinesOf(parent, tag2, withInside) {
  if (!parent) return void 0;
  let merged;
  for (const node of findChildren(parent, tag2)) {
    const b = borderLinesOf(node, withInside);
    if (b) merged = { ...merged, ...b };
  }
  return merged;
}
function cellMarginsOf(node) {
  if (!node) return void 0;
  const SIDES = [
    ["w:top", "top"],
    ["w:left", "left"],
    ["w:bottom", "bottom"],
    ["w:right", "right"],
    ["w:start", "left"],
    ["w:end", "right"]
  ];
  const m = {};
  for (const [tag2, side] of SIDES) {
    const a = attrsOf(findChild(node, tag2) ?? {});
    if (a["w:type"] && a["w:type"] !== "dxa") continue;
    const v = Number(a["w:w"]);
    if (Number.isFinite(v) && v >= 0 && m[side] === void 0) m[side] = v;
  }
  return Object.keys(m).length > 0 ? m : void 0;
}
var EA_LANG_DEFAULT_FONT = {
  // Word probe + fontTable: ko-KR empty EA slot substitutes Malgun Gothic, not Batang
  ko: "Malgun Gothic",
  "ko-kr": "Malgun Gothic",
  ja: "MS Mincho",
  "ja-jp": "MS Mincho",
  "zh-cn": "SimSun",
  "zh-tw": "PMingLiU",
  "zh-hk": "PMingLiU"
};

// vendor/genoffice/docx/parse-sdt.ts
function parseSdtBlock(sdtXml) {
  const contentOpen = /<w:sdtContent(?:\s[^>]*)?>/.exec(sdtXml);
  if (!contentOpen) return null;
  const contentTagEnd = contentOpen.index + contentOpen[0].length;
  const contentClose = sdtXml.lastIndexOf("</w:sdtContent>");
  if (contentClose < contentTagEnd) return null;
  const innerContent = sdtXml.slice(contentTagEnd, contentClose);
  const pStart = innerContent.search(/<w:p[\s/>]/);
  if (pStart === -1) return null;
  let depth = 0;
  let pEnd = -1;
  const tagRe = /<\/?w:p(?=[\s/>])/g;
  let m;
  while ((m = tagRe.exec(innerContent)) !== null) {
    if (m[0].startsWith("</")) {
      if (depth === 1) {
        pEnd = m.index + m[0].length + 1;
        break;
      }
      depth--;
    } else {
      depth++;
    }
  }
  if (pEnd === -1) {
    const selfClose = /<w:p\/>/.exec(innerContent);
    pEnd = selfClose ? selfClose.index + selfClose[0].length : innerContent.length;
  }
  const pXml = innerContent.slice(pStart, pEnd);
  const openXml = sdtXml.slice(0, contentTagEnd);
  const closeXml = sdtXml.slice(contentClose);
  return {
    shell: { ...sdtMeta(sdtXml), openXml, closeXml },
    pXml
  };
}
function sdtMeta(sdtXml) {
  const sdtPrXml = /<w:sdtPr>([\s\S]*?)<\/w:sdtPr>/.exec(sdtXml)?.[1] ?? "";
  const attrVal = (tag3) => {
    const m = /\bw:val=(?:"([^"]*)"|'([^']*)')/.exec(tag3);
    return m?.[1] ?? m?.[2] ?? "";
  };
  const alias = attrVal(/<w:alias[^>]*>/.exec(sdtPrXml)?.[0] ?? "");
  const tag2 = attrVal(/<w:tag[^>]*>/.exec(sdtPrXml)?.[0] ?? "");
  let controlType = "text";
  if (/<w:date[\s/>]/.test(sdtPrXml)) controlType = "date";
  else if (/<w:dropDownList[\s/>]|<w:comboBox[\s/>]/.test(sdtPrXml)) controlType = "dropdown";
  else if (/<w:checkbox[\s/>]/.test(sdtPrXml)) controlType = "checkbox";
  else if (/<w:text[\s/>]|<w:richText[\s/>]/.test(sdtPrXml)) controlType = "text";
  return { alias, tag: tag2, controlType };
}
function splitSdtParts(sdtXml) {
  const contentOpen = /<w:sdtContent(?:\s[^>]*)?>/.exec(sdtXml);
  if (!contentOpen) return null;
  const innerStart = contentOpen.index + contentOpen[0].length;
  const innerEnd = sdtXml.lastIndexOf("</w:sdtContent>");
  if (innerEnd <= innerStart) return null;
  const children = [];
  const tagRe = /<(\/?)([A-Za-z0-9:._-]+)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  tagRe.lastIndex = innerStart;
  let depth = 0;
  let start = -1;
  let name = "";
  let m;
  while ((m = tagRe.exec(sdtXml)) !== null && m.index < innerEnd) {
    if (m[2] === "w:sdt" || m[2] === "w:sdtContent") continue;
    if (m[1] === "/") {
      depth--;
      if (depth === 0) children.push({ name, start, end: m.index + m[0].length });
    } else if (m[3].endsWith("/")) {
      if (depth === 0) children.push({ name: m[2], start: m.index, end: m.index + m[0].length });
    } else {
      if (depth === 0) {
        start = m.index;
        name = m[2];
      }
      depth++;
    }
  }
  const parts = children.filter((c) => c.name === "w:p" || c.name === "w:tbl");
  if (parts.length < 2) return null;
  return parts.map((c, k) => ({
    name: c.name,
    start: k === 0 ? 0 : c.start,
    end: k === parts.length - 1 ? sdtXml.length : parts[k + 1].start,
    childStart: c.start,
    childEnd: c.end
  }));
}
function sdtTableXml(sdtXml) {
  const contentOpen = /<w:sdtContent(?:\s[^>]*)?>/.exec(sdtXml);
  if (!contentOpen) return null;
  const contentTagEnd = contentOpen.index + contentOpen[0].length;
  const contentClose = sdtXml.lastIndexOf("</w:sdtContent>");
  if (contentClose <= contentTagEnd) return null;
  const inner = sdtXml.slice(contentTagEnd, contentClose);
  const tblStart = inner.search(/<w:tbl[\s>]/);
  if (tblStart === -1) return null;
  const pStart = inner.search(/<w:p[\s/>]/);
  if (pStart !== -1 && pStart < tblStart) return null;
  let depth = 0;
  const tagRe = /<\/?w:tbl(?=[\s/>])/g;
  tagRe.lastIndex = tblStart;
  let m;
  while ((m = tagRe.exec(inner)) !== null) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) return inner.slice(tblStart, m.index + "</w:tbl>".length);
    } else depth++;
  }
  return null;
}

// vendor/genoffice/docx/parse-styles.ts
var BUILT_IN_PARA_DEFAULTS = { spaceAfterTwips: 160, lineRawTwips: 276, lineRule: "auto", lineSpacing: 1.15 };
var BUILT_IN_DOC_DEFAULTS = {
  asciiFont: "Aptos",
  sizeHalfPoints: 24,
  ...BUILT_IN_PARA_DEFAULTS
};
function mergeNumPr(own, parent) {
  if (own.numId === void 0 && parent === "none") return "none";
  const inherited = parent === "none" ? void 0 : parent;
  const numId = own.numId ?? inherited?.numId;
  if (numId === "0") return "none";
  if (!numId) return void 0;
  return { numId, ilvl: own.ilvl ?? inherited?.ilvl ?? 0 };
}
async function parseStyles(zip, theme, themeFonts) {
  const styles = /* @__PURE__ */ new Map();
  const file = zip.file("word/styles.xml");
  if (!file) return { styles, docDefaults: { ...BUILT_IN_DOC_DEFAULTS } };
  let parsed;
  try {
    parsed = xmlParser.parse(await file.async("string"));
  } catch (err) {
    console.warn("styles.xml unparseable, styles degraded to empty:", err);
    return { styles, docDefaults: { ...BUILT_IN_DOC_DEFAULTS } };
  }
  const root = parsed.find((n) => nameOf(n) === "w:styles");
  if (!root) return { styles, docDefaults: { ...BUILT_IN_DOC_DEFAULTS } };
  let docDefaults;
  const defaultsNode = findChild(root, "w:docDefaults");
  if (!defaultsNode) docDefaults = { ...BUILT_IN_PARA_DEFAULTS };
  else {
    const dd = {};
    const rPr = findChild(findChild(defaultsNode, "w:rPrDefault") ?? {}, "w:rPr");
    const sz = rPr ? attrsOf(findChild(rPr, "w:sz") ?? {})["w:val"] : void 0;
    if (sz) dd.sizeHalfPoints = parseInt(sz, 10) || void 0;
    const ddRf = themedRFonts(rPr ? attrsOf(findChild(rPr, "w:rFonts") ?? {}) : {}, themeFonts);
    if (ddRf.ascii ?? ddRf.hAnsi) dd.asciiFont = ddRf.ascii ?? ddRf.hAnsi;
    if (ddRf.eastAsia && !ddRf.eaSlotEmpty) dd.eastAsiaFont = ddRf.eastAsia;
    const eaLang = rPr ? attrsOf(findChild(rPr, "w:lang") ?? {})["w:eastAsia"] : void 0;
    if (eaLang) dd.eastAsiaLang = eaLang;
    if (!dd.eastAsiaFont && eaLang) {
      const eaDefault = EA_LANG_DEFAULT_FONT[eaLang.toLowerCase()];
      if (eaDefault) {
        const ddEaTheme = ddRf.eaSlotEmpty && themeFonts ? themeLangEaSlotFont(
          themeFonts,
          rPr ? attrsOf(findChild(rPr, "w:rFonts") ?? {})["w:eastAsiaTheme"] : void 0
        ) : void 0;
        dd.eastAsiaFont = ddEaTheme ?? eaDefault;
        dd.eaFromLang = true;
        if (ddRf.eaSlotEmpty) dd.eaSlotEmpty = true;
      }
    }
    if (rPr) {
      if (onOffOf(rPr, "w:b")) dd.bold = true;
      if (onOffOf(rPr, "w:i")) dd.italic = true;
      const color = colorFrom(rPr, theme);
      if (color) dd.color = color;
      const kern = attrsOf(findChild(rPr, "w:kern") ?? {})["w:val"];
      if (kern !== void 0) dd.kernHalfPoints = parseInt(kern, 10) || 0;
      const lang = attrsOf(findChild(rPr, "w:lang") ?? {})["w:val"];
      if (lang) dd.lang = lang;
    }
    const pPrDefault = findChild(defaultsNode, "w:pPrDefault");
    if (!pPrDefault) Object.assign(dd, BUILT_IN_PARA_DEFAULTS);
    const pPr = findChild(pPrDefault ?? {}, "w:pPr");
    const spacingAttrs = pPr ? attrsOf(findChild(pPr, "w:spacing") ?? {}) : {};
    if (spacingAttrs["w:line"]) {
      const line = lineTwipsOf(spacingAttrs["w:line"]);
      const rule = spacingAttrs["w:lineRule"] ?? "auto";
      if (line > 0) {
        dd.lineRawTwips = line;
        dd.lineRule = rule;
        if (rule === "auto") dd.lineSpacing = line / 240;
      }
    }
    if (spacingAttrs["w:before"] !== void 0) {
      dd.spaceBeforeTwips = parseInt(spacingAttrs["w:before"], 10) || 0;
    }
    if (spacingAttrs["w:after"] !== void 0) {
      dd.spaceAfterTwips = parseInt(spacingAttrs["w:after"], 10) || 0;
    }
    if (spacingAttrs["w:beforeAutospacing"] !== void 0)
      dd.spaceBeforeAuto = spacingAttrs["w:beforeAutospacing"] === "1" || spacingAttrs["w:beforeAutospacing"] === "true";
    if (spacingAttrs["w:afterAutospacing"] !== void 0)
      dd.spaceAfterAuto = spacingAttrs["w:afterAutospacing"] === "1" || spacingAttrs["w:afterAutospacing"] === "true";
    if (pPr && onOffOf(pPr, "w:suppressAutoHyphens")) dd.suppressAutoHyphens = true;
    if (Object.keys(dd).length > 0) docDefaults = dd;
  }
  const basedOnIds = /* @__PURE__ */ new Map();
  const ownNumPrs = /* @__PURE__ */ new Map();
  const linkedIds = /* @__PURE__ */ new Map();
  const outlineOffIds = /* @__PURE__ */ new Set();
  for (const styleNode of findChildren(root, "w:style")) {
    const attrs = attrsOf(styleNode);
    const type = attrs["w:type"];
    if (type !== "paragraph" && type !== "character" && type !== "table") continue;
    const styleId = attrs["w:styleId"];
    if (!styleId) continue;
    const name = attrsOf(findChild(styleNode, "w:name") ?? {})["w:val"] ?? styleId;
    let headingLevel;
    if (type === "paragraph") {
      const nameMatch = /^heading\s*([1-9])$/i.exec(name) ?? /^Heading([1-9])$/.exec(styleId);
      if (nameMatch) headingLevel = parseInt(nameMatch[1], 10);
      else {
        const pPr = findChild(styleNode, "w:pPr");
        const outline = pPr ? attrsOf(findChild(pPr, "w:outlineLvl") ?? {})["w:val"] : void 0;
        if (outline !== void 0) {
          const lvl = parseInt(outline, 10);
          if (lvl >= 0 && lvl <= 8) headingLevel = lvl + 1;
          else outlineOffIds.add(styleId);
        }
      }
    }
    const basedOn = attrsOf(findChild(styleNode, "w:basedOn") ?? {})["w:val"];
    if (basedOn) basedOnIds.set(styleId, basedOn);
    const link = attrsOf(findChild(styleNode, "w:link") ?? {})["w:val"];
    if (link) linkedIds.set(styleId, link);
    const uiPriorityRaw = attrsOf(findChild(styleNode, "w:uiPriority") ?? {})["w:val"];
    const uiPriority = uiPriorityRaw !== void 0 && /^\d+$/.test(uiPriorityRaw) ? parseInt(uiPriorityRaw, 10) : void 0;
    let numPr;
    if (type === "paragraph") {
      const styleNumPr = findChild(findChild(styleNode, "w:pPr") ?? {}, "w:numPr");
      if (styleNumPr) {
        const numId = attrsOf(findChild(styleNumPr, "w:numId") ?? {})["w:val"];
        const ilvlRaw = attrsOf(findChild(styleNumPr, "w:ilvl") ?? {})["w:val"];
        const own = {};
        if (numId !== void 0) own.numId = numId;
        if (ilvlRaw !== void 0) own.ilvl = parseInt(ilvlRaw, 10) || 0;
        ownNumPrs.set(styleId, own);
        numPr = mergeNumPr(own, void 0);
      }
    }
    styles.set(styleId, {
      styleId,
      name,
      type,
      headingLevel,
      headingOutlineOff: outlineOffIds.has(styleId) ? true : void 0,
      basedOn,
      semiHidden: onOffOf(styleNode, "w:semiHidden"),
      qFormat: onOffOf(styleNode, "w:qFormat"),
      uiPriority,
      unhideWhenUsed: onOffOf(styleNode, "w:unhideWhenUsed"),
      custom: attrs["w:customStyle"] === "1" || attrs["w:customStyle"] === "true" ? true : void 0,
      display: type === "table" ? void 0 : styleDisplayOf(styleNode, theme, themeFonts),
      tableDisplay: type === "table" ? tableStyleDisplayOf(styleNode, theme, themeFonts) : void 0,
      numPr,
      isDefault: attrs["w:default"] === "1" || attrs["w:default"] === "true" ? true : void 0
    });
  }
  {
    const declared = /* @__PURE__ */ new Map();
    const normalOfType = /* @__PURE__ */ new Map();
    for (const info of styles.values()) {
      if (info.isDefault) declared.set(info.type, info);
      if (!normalOfType.has(info.type) && (info.styleId.toLowerCase() === "normal" || info.name.toLowerCase() === "normal")) {
        normalOfType.set(info.type, info);
      }
      info.isDefault = void 0;
    }
    for (const type of /* @__PURE__ */ new Set([...declared.keys(), ...normalOfType.keys()])) {
      const pick = declared.get(type) ?? normalOfType.get(type);
      if (pick) pick.isDefault = true;
    }
  }
  const resolved = /* @__PURE__ */ new Set();
  const resolve = (styleId, seen) => {
    const info = styles.get(styleId);
    if (!info) return void 0;
    const parentId = basedOnIds.get(styleId);
    if (resolved.has(styleId) || !parentId || seen.has(styleId)) return info;
    seen.add(styleId);
    const parent = resolve(parentId, seen);
    resolved.add(styleId);
    if (parent?.display) {
      const own = info.display;
      info.display = { ...parent.display, ...own ?? {} };
      if (parent.display.indentChars && own?.indentChars) {
        info.display.indentChars = mergeCharIndents(parent.display.indentChars, own.indentChars);
      }
      if (parent.display.borderSides && own?.borderSides) {
        info.display.borderSides = { ...parent.display.borderSides, ...own.borderSides };
      }
      if (parent.display.tabStops && own?.tabStops) {
        const merged = [
          ...parent.display.tabStops.filter((p) => !own.tabStops.some((o) => o.pos === p.pos)),
          ...own.tabStops.filter((o) => o.val !== "clear")
        ].sort((a, b) => a.pos - b.pos);
        if (merged.length > 0) info.display.tabStops = merged;
        else delete info.display.tabStops;
      }
      if (Object.keys(info.display).length === 0) info.display = void 0;
    }
    if (parent?.tableDisplay) {
      info.tableDisplay = mergeTableDisplay(parent.tableDisplay, info.tableDisplay);
    }
    if (info.type === "paragraph" && info.headingLevel === void 0 && !info.headingOutlineOff && parent?.headingLevel) {
      info.headingLevel = parent.headingLevel;
      info.headingLevelInherited = true;
    }
    if (info.type === "paragraph" && (ownNumPrs.has(styleId) || parent?.numPr)) {
      info.numPr = mergeNumPr(ownNumPrs.get(styleId) ?? {}, parent?.numPr);
    }
    return info;
  };
  for (const styleId of styles.keys()) resolve(styleId, /* @__PURE__ */ new Set());
  const RUN_KEYS = [
    "sizeHalfPoints",
    "color",
    "bold",
    "italic",
    "boldCs",
    "italicCs",
    "sizeCsHalfPoints",
    "rtl",
    "underline",
    "strike",
    "font",
    "fontAscii",
    "eastAsiaFont",
    "csFont",
    "caps",
    "bdr",
    "shading",
    "textOutline"
  ];
  for (const [fromId, toId] of linkedIds) {
    const a = styles.get(fromId);
    const b = styles.get(toId);
    if (!a || !b) continue;
    const back = linkedIds.get(toId);
    if (back !== void 0 && back !== fromId) continue;
    for (const [self, other] of [
      [a, b],
      [b, a]
    ]) {
      if (self.type !== "character" && self.type !== "paragraph") continue;
      const fill = {};
      for (const key of RUN_KEYS) {
        if (self.display?.[key] === void 0 && other.display?.[key] !== void 0) {
          ;
          fill[key] = other.display[key];
        }
      }
      if (Object.keys(fill).length > 0) self.display = { ...fill, ...self.display ?? {} };
    }
    if (a.type === "character" && b.type === "paragraph") a.linkedCharShell = true;
    if (b.type === "character" && a.type === "paragraph") b.linkedCharShell = true;
  }
  return { styles, docDefaults };
}
function mergeTableDisplay(parent, child) {
  const merged = { ...parent, ...child ?? {} };
  const DEEP = ["wholeTable", "firstRow", "firstCol", "lastCol", "lastRow", "paraSpacing"];
  for (const key of DEEP) {
    if (parent[key] || child?.[key]) {
      merged[key] = { ...parent[key] ?? {}, ...child?.[key] ?? {} };
    }
  }
  return Object.keys(merged).length > 0 ? merged : void 0;
}
function tableStyleDisplayOf(styleNode, theme, themeFonts) {
  const display = {};
  const shdFill = (node) => {
    const fill = node ? attrsOf(findChild(node, "w:shd") ?? {})["w:fill"] : void 0;
    return fill && fill !== "auto" ? stripHash(fill) : void 0;
  };
  const baseFill = shdFill(findChild(styleNode, "w:tcPr"));
  if (baseFill) display.fill = baseFill;
  const szHalfOf = (rPr) => {
    const val2 = parseInt(attrsOf(findChild(rPr ?? {}, "w:sz") ?? {})["w:val"] ?? "", 10);
    return val2 > 0 ? val2 : void 0;
  };
  const styleRPr = findChild(styleNode, "w:rPr");
  if (styleRPr) {
    const wholeTable = {};
    const color = colorFrom(styleRPr, theme);
    if (color) wholeTable.color = color;
    if (boolProp(styleRPr, "w:b")) wholeTable.bold = true;
    if (boolProp(styleRPr, "w:i")) wholeTable.italic = true;
    const sz = szHalfOf(styleRPr);
    if (sz) wholeTable.sizeHalfPoints = sz;
    const kern = attrsOf(findChild(styleRPr, "w:kern") ?? {})["w:val"];
    if (kern !== void 0) wholeTable.kernHalfPoints = parseInt(kern, 10) || 0;
    if (Object.keys(wholeTable).length > 0) display.wholeTable = wholeTable;
  }
  for (const cond of findChildren(styleNode, "w:tblStylePr")) {
    const type = attrsOf(cond)["w:type"];
    const tcPr = findChild(cond, "w:tcPr");
    const fill = shdFill(tcPr);
    if (type === "firstRow" || type === "firstCol" || type === "lastCol" || type === "lastRow") {
      const rPr = findChild(cond, "w:rPr");
      const fmt = {};
      if (fill) fmt.fill = fill;
      if (rPr && boolProp(rPr, "w:b")) fmt.bold = true;
      if (rPr && boolProp(rPr, "w:i")) fmt.italic = true;
      const color = colorFrom(rPr, theme);
      if (color) fmt.color = color;
      const sz = szHalfOf(rPr);
      if (sz) fmt.sizeHalfPoints = sz;
      if (rPr) {
        const capsOn = onOffOf(rPr, "w:caps");
        const smallCapsOn = onOffOf(rPr, "w:smallCaps");
        if (capsOn) fmt.caps = "all";
        else if (smallCapsOn) fmt.caps = "small";
        else if (capsOn === false || smallCapsOn === false) fmt.caps = "none";
        const rf = themedRFonts(attrsOf(findChild(rPr, "w:rFonts") ?? {}), themeFonts);
        const fontAscii = rf.ascii ?? rf.hAnsi;
        if (fontAscii) fmt.fontAscii = fontAscii;
        const spc = parseInt(attrsOf(findChild(rPr, "w:spacing") ?? {})["w:val"] ?? "", 10);
        if (!Number.isNaN(spc)) fmt.charSpacingTwips = spc;
      }
      if (Object.keys(fmt).length > 0) display[type] = fmt;
    } else if (type === "band1Horz" && fill) {
      display.band1Fill = fill;
    } else if (type === "band2Horz" && fill) {
      display.band2Fill = fill;
    }
  }
  const styleTblPr = findChild(styleNode, "w:tblPr");
  const bandSize = rowBandSizeOf(styleTblPr);
  if (bandSize) display.rowBandSize = bandSize;
  const borders = mergedBorderLinesOf(styleTblPr, "w:tblBorders", true);
  if (borders) display.borders = borders;
  const cellMar = cellMarginsOf(findChild(styleTblPr ?? {}, "w:tblCellMar"));
  if (cellMar) display.cellMarTwips = cellMar;
  const stylePPr = findChild(styleNode, "w:pPr");
  const jc = attrsOf(findChild(stylePPr ?? {}, "w:jc") ?? {})["w:val"];
  if (jc) display.paraJc = jc;
  const stylePPrSpacing = findChild(stylePPr ?? {}, "w:spacing");
  if (stylePPrSpacing) {
    const a = attrsOf(stylePPrSpacing);
    const ps = {};
    const before = parseInt(a["w:before"] ?? "", 10);
    if (before >= 0 && a["w:before"] !== void 0) ps.beforeTwips = before;
    const after = parseInt(a["w:after"] ?? "", 10);
    if (after >= 0 && a["w:after"] !== void 0) ps.afterTwips = after;
    const line = lineTwipsOf(a["w:line"]);
    if (line > 0) {
      ps.lineRawTwips = line;
      const rule = a["w:lineRule"] ?? "auto";
      ps.lineRule = rule;
      if (rule === "auto") ps.lineSpacing = Math.round(line / 240 * 100) / 100;
    }
    if (Object.keys(ps).length > 0) display.paraSpacing = ps;
  }
  return Object.keys(display).length > 0 ? display : void 0;
}
function runBorderOf(bdrNode) {
  const bdr = attrsOf(bdrNode);
  if (!bdr["w:val"] || bdr["w:val"] === "none" || bdr["w:val"] === "nil") return void 0;
  return {
    val: bdr["w:val"],
    sz: parseInt(bdr["w:sz"] ?? "", 10) || 4,
    ...bdr["w:color"] && bdr["w:color"] !== "auto" ? { color: stripHash(bdr["w:color"]) } : {},
    ...parseInt(bdr["w:space"] ?? "", 10) > 0 ? { space: parseInt(bdr["w:space"], 10) } : {}
  };
}
function styleDisplayOf(styleNode, theme, themeFonts) {
  const display = {};
  const rPr = findChild(styleNode, "w:rPr");
  if (rPr) {
    const sz = attrsOf(findChild(rPr, "w:sz") ?? {})["w:val"];
    if (sz) display.sizeHalfPoints = parseInt(sz, 10) || void 0;
    const color = colorFrom(rPr, theme) ?? autoColorOf(rPr);
    if (color) display.color = color;
    const bold = onOffOf(rPr, "w:b");
    if (bold !== void 0) display.bold = bold;
    const italic = onOffOf(rPr, "w:i");
    if (italic !== void 0) display.italic = italic;
    const boldCs = onOffOf(rPr, "w:bCs");
    if (boldCs !== void 0) display.boldCs = boldCs;
    const italicCs = onOffOf(rPr, "w:iCs");
    if (italicCs !== void 0) display.italicCs = italicCs;
    const szCs = attrsOf(findChild(rPr, "w:szCs") ?? {})["w:val"];
    if (szCs) display.sizeCsHalfPoints = parseInt(szCs, 10) || void 0;
    const rtl = onOffOf(rPr, "w:rtl");
    if (rtl !== void 0) display.rtl = rtl;
    const u = attrsOf(findChild(rPr, "w:u") ?? {})["w:val"];
    if (u) display.underline = u !== "none";
    const strike = onOffOf(rPr, "w:strike");
    if (strike !== void 0) display.strike = strike;
    const bdrNode = findChild(rPr, "w:bdr");
    const bdr = bdrNode ? runBorderOf(bdrNode) : void 0;
    if (bdr) display.bdr = bdr;
    const rf = themedRFonts(attrsOf(findChild(rPr, "w:rFonts") ?? {}), themeFonts);
    const font = rf.eastAsia ?? rf.ascii ?? rf.hAnsi;
    const fontAscii = rf.ascii ?? rf.hAnsi;
    if (fontAscii) display.fontAscii = fontAscii;
    if (rf.eastAsia && !rf.eaSlotEmpty) display.eastAsiaFont = rf.eastAsia;
    if (rf.cs) display.csFont = rf.cs;
    if (font) display.font = font;
    if (rf.eaSlotEmpty && font && font === rf.eastAsia) display.eaSlotEmpty = true;
    const spc = parseInt(attrsOf(findChild(rPr, "w:spacing") ?? {})["w:val"] ?? "", 10);
    if (!Number.isNaN(spc)) display.charSpacingTwips = spc;
    const kern = attrsOf(findChild(rPr, "w:kern") ?? {})["w:val"];
    if (kern !== void 0) display.kernHalfPoints = parseInt(kern, 10) || 0;
    const eaLang = attrsOf(findChild(rPr, "w:lang") ?? {})["w:eastAsia"];
    if (eaLang) display.eastAsiaLang = eaLang;
    const capsOn = onOffOf(rPr, "w:caps");
    const smallCapsOn = onOffOf(rPr, "w:smallCaps");
    if (capsOn) display.caps = "all";
    else if (smallCapsOn) display.caps = "small";
    else if (capsOn === false || smallCapsOn === false) display.caps = "none";
    const shading = shdDisplayFill(findChild(rPr, "w:shd"), theme);
    if (shading) display.shading = shading;
    const outline = w14TextOutlineOf(rPr, theme);
    if (outline) display.textOutline = outline;
    const vanish = onOffOf(rPr, "w:vanish");
    if (vanish !== void 0 && onOffOf(rPr, "w:specVanish") !== true) display.vanish = vanish;
  }
  const pPr = findChild(styleNode, "w:pPr");
  if (pPr) {
    const spacing = attrsOf(findChild(pPr, "w:spacing") ?? {});
    const line = lineTwipsOf(spacing["w:line"]);
    if (line > 0) {
      const rule = spacing["w:lineRule"] ?? "auto";
      display.lineRule = rule;
      display.lineRawTwips = line;
      if (rule === "auto") {
        display.lineSpacing = line / 240;
      }
    }
    if (spacing["w:before"] !== void 0) {
      display.spaceBeforeTwips = parseInt(spacing["w:before"], 10) || 0;
    }
    if (spacing["w:after"] !== void 0) {
      display.spaceAfterTwips = parseInt(spacing["w:after"], 10) || 0;
    }
    if (spacing["w:beforeAutospacing"] !== void 0)
      display.spaceBeforeAuto = spacing["w:beforeAutospacing"] === "1" || spacing["w:beforeAutospacing"] === "true";
    if (spacing["w:afterAutospacing"] !== void 0)
      display.spaceAfterAuto = spacing["w:afterAutospacing"] === "1" || spacing["w:afterAutospacing"] === "true";
    if (boolProp(pPr, "w:keepNext")) display.keepNext = true;
    if (boolProp(pPr, "w:keepLines")) display.keepLines = true;
    {
      const sln = onOffOf(pPr, "w:suppressLineNumbers");
      if (sln !== void 0) display.suppressLineNumbers = sln;
    }
    {
      const pbb = onOffOf(pPr, "w:pageBreakBefore");
      if (pbb !== void 0) display.pageBreakBefore = pbb;
    }
    {
      const wc = onOffOf(pPr, "w:widowControl");
      if (wc !== void 0) display.widowControl = wc;
    }
    {
      const sah = onOffOf(pPr, "w:suppressAutoHyphens");
      if (sah !== void 0) display.suppressAutoHyphens = sah;
    }
    {
      const ctx = onOffOf(pPr, "w:contextualSpacing");
      if (ctx !== void 0) display.contextualSpacing = ctx;
    }
    const autoSpace = autoSpaceOf(pPr);
    if (autoSpace !== void 0) display.autoSpace = autoSpace;
    const wordWrap = onOffOf(pPr, "w:wordWrap");
    if (wordWrap !== void 0) display.wordWrap = wordWrap;
    const overflowPunct = onOffOf(pPr, "w:overflowPunct");
    if (overflowPunct !== void 0) display.overflowPunct = overflowPunct;
    const jc = attrsOf(findChild(pPr, "w:jc") ?? {})["w:val"];
    if (jc === "center" || jc === "right" || jc === "left" || jc === "justify") display.align = jc;
    else if (jc === "both" || /kashida$|^thaiDistribute$/i.test(jc ?? "")) display.align = "justify";
    else if (jc === "distribute") display.align = "distribute";
    const bidi = onOffOf(pPr, "w:bidi");
    if (bidi !== void 0) display.bidi = bidi;
    const shd = findChild(pPr, "w:shd");
    const shdDisp = shdDisplayFill(shd, theme);
    if (shdDisp) display.shadingFill = shdDisp;
    else if (shd) display.shadingFill = "auto";
    const borderSides = paraBorderSidesOf(pPr, theme);
    if (borderSides) display.borderSides = borderSides;
    const stops = tabStopsOf(pPr);
    if (stops) display.tabStops = stops;
    const ind = findChild(pPr, "w:ind");
    if (ind) {
      const { left, right, firstLine } = indentTwipsOf(ind);
      if (left !== void 0) display.indentLeftTwips = left;
      if (right !== void 0) display.indentRightTwips = right;
      if (firstLine !== void 0) display.indentFirstLineTwips = firstLine;
      const chars = charIndentsOf(ind);
      if (chars) display.indentChars = chars;
    }
  }
  return Object.keys(display).length > 0 ? display : void 0;
}

// vendor/genoffice/docx/parse.ts
var emuToPx = (emu) => Math.round(emu / EMU_PER_PX2 * 100) / 100;
var BREAK_CHAR = { page: "\f", column: "\v" };
function breakCharOf(attrs) {
  if (attrs["w:clear"]) return "";
  return BREAK_CHAR[attrs["w:type"] ?? ""] ?? "\n";
}
var IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  emf: "image/emf",
  wmf: "image/wmf",
  emz: "image/x-emz",
  wmz: "image/x-wmz",
  tif: "image/tiff",
  tiff: "image/tiff"
};
var contentTypesCache = /* @__PURE__ */ new WeakMap();
function contentTypesOf(zip) {
  let cached = contentTypesCache.get(zip);
  if (!cached) {
    cached = (async () => {
      const defaults = /* @__PURE__ */ new Map();
      const overrides = /* @__PURE__ */ new Map();
      const file = zip.file("[Content_Types].xml");
      if (!file) return { defaults, overrides };
      const parsed = xmlParser.parse(await file.async("string"));
      const root = parsed.find((n) => nameOf(n) === "Types");
      for (const node of root ? findChildren(root, "Default") : []) {
        const attrs = attrsOf(node);
        const ext = attrs["Extension"]?.toLowerCase();
        if (ext && attrs["ContentType"]) defaults.set(ext, attrs["ContentType"]);
      }
      for (const node of root ? findChildren(root, "Override") : []) {
        const attrs = attrsOf(node);
        if (attrs["PartName"] && attrs["ContentType"])
          overrides.set(attrs["PartName"], attrs["ContentType"]);
      }
      return { defaults, overrides };
    })();
    contentTypesCache.set(zip, cached);
  }
  return cached;
}
async function imagePartMime(zip, path) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const fromExt = IMAGE_MIME[ext];
  if (fromExt) return fromExt;
  const { defaults, overrides } = await contentTypesOf(zip);
  const fromPart = overrides.get(`/${path}`) ?? defaults.get(ext);
  return fromPart?.startsWith("image/") ? fromPart : void 0;
}
async function parseDocx(bytes, options = {}) {
  const zip = await loadDocxZip(bytes);
  assertZipWithinLimits(zip);
  const docPath = await resolveMainDocumentPath(zip);
  if (!docPath) {
    const mime = (await zip.file("mimetype")?.async("string"))?.trim();
    if (mime?.startsWith("application/vnd.oasis.opendocument"))
      throw new Error(`OpenDocument file (${mime}), not OOXML \u2014 save as .docx to open`);
    throw new Error("not a docx: missing word/document.xml");
  }
  const documentXml = await zip.file(docPath).async("string");
  const theme = await parseTheme(zip);
  const { styles, docDefaults } = await parseStyles(zip, theme.colors, theme.fonts);
  const headingStyleIds = /* @__PURE__ */ new Map();
  let listParagraphStyleId;
  for (const info of styles.values()) {
    if (info.headingLevel && !headingStyleIds.has(info.headingLevel)) {
      headingStyleIds.set(info.headingLevel, info.styleId);
    }
    if (!listParagraphStyleId && /^listparagraph$/i.test(info.styleId)) {
      listParagraphStyleId = info.styleId;
    }
  }
  const rels = await parseRels(zip, docPath.replace(/([^/]+)$/, "_rels/$1.rels"));
  const { formats: numFormats, defs: numbering, picBullets } = await parseNumbering(zip);
  await resolvePicBullets(zip, numbering, picBullets);
  const comments = await parseComments(zip);
  const protection = await parseProtection(zip);
  const writeProtection = await parseWriteProtection(zip);
  const removePersonalInfo = await parseRemovePersonalInfo(zip);
  const footnotes = await parseNotesPart(zip, "footnote");
  const endnotes = await parseNotesPart(zip, "endnote");
  const sources = await parseSources(zip);
  const zoteroDocumentData = await readZoteroDocumentData(zip).catch(() => "");
  const fontTableFile = zip.file(FONT_TABLE_PART_PATH);
  const fontTable = fontTableFile ? parseFontTable(await fontTableFile.async("string")) : [];
  const embeddedFonts = await readEmbeddedFonts(zip, fontTable);
  const { footnoteProps, endnoteProps } = await parseNoteProps(zip, documentXml);
  const noteNumbers = noteNumbersOf(documentXml, footnotes, endnotes, footnoteProps, endnoteProps);
  const rangedCommentIds = new Set(
    [...documentXml.matchAll(/<w:commentRangeStart\b[^>]*\bw:id\s*=\s*["']([^"']+)["']/g)].map(
      (m) => m[1]
    )
  );
  const referenceOnlyComments = new Set(
    comments.map((c) => c.id).filter((id) => !rangedCommentIds.has(id))
  );
  const scan = scanBody(documentXml);
  const mediaByRid = await tableBlipMedia(scan.elements, documentXml, zip, rels, docPath);
  const externalTxbxByRid = await externalTxbxParts(documentXml, zip, rels, docPath);
  const sectSlices = [...documentXml.matchAll(/<w:sectPr[^>]*\/>|<w:sectPr[\s\S]*?<\/w:sectPr>/g)];
  const gutterAtTop = await parseSettingsFlag(zip, "w:gutterAtTop");
  const sectCache = /* @__PURE__ */ new Map();
  const sectionAt = (docOffset) => {
    let i = sectSlices.findIndex((m) => (m.index ?? 0) + m[0].length > docOffset);
    if (i === -1) i = sectSlices.length - 1;
    let settings = sectCache.get(i);
    if (!settings) {
      settings = sectionSettingsFromXml(i >= 0 ? sectSlices[i][0] : "", { gutterAtTop });
      sectCache.set(i, settings);
    }
    return settings;
  };
  const elements = [];
  const blocks = [];
  const zoteroFieldParagraphs = crossParagraphZoteroFields(scan.elements, documentXml);
  const chartParts = {};
  const compatibilityMode = await parseCompatibilityMode(zip);
  const buildCtx = {
    zip,
    sourcePath: docPath,
    styles,
    rels,
    numFormats,
    numbering,
    chartParts,
    noteNumbers,
    compatibilityMode,
    themeColors: theme.colors,
    themeFonts: theme.fonts,
    mediaByRid,
    externalTxbxByRid,
    referenceOnlyComments,
    sectionAt,
    docDefaults,
    defaultParaStyle: [...styles.values()].find((s) => s.type === "paragraph" && s.isDefault),
    xmlSpacePreserve: partXmlSpacePreserve(documentXml, "w:document"),
    ...documentXml.includes("<v:shapetype") ? { vmlShapeTypes: vmlShapeTypeTable(documentXml) } : {},
    nextZoteroFieldId: Math.max(0, ...[...zoteroFieldParagraphs.values()].map((field) => field.id)) + 1,
    // explicit breaks in any attribute order, plus Word's rendered-page hint
    // (catches natural pages in single-section docs); a false positive only
    // turns page-pinning off, which is the conservative direction
    firstPageBreakAt: (() => {
      const br = documentXml.search(
        /<w:br [^>]*w:type="page"|<w:pageBreakBefore[^>]*\/>|<w:lastRenderedPageBreak[^>]*\/>/
      );
      const sect = documentXml.indexOf("</w:sectPr>");
      const cands = [br, sect].filter((i) => i !== -1);
      return cands.length > 0 ? Math.min(...cands) : void 0;
    })()
  };
  let sdtGroupSeq = 0;
  for (const el of scan.elements) {
    const xml = documentXml.slice(el.start, el.end);
    const sdtParts = el.name === "w:sdt" ? splitSdtParts(xml) : null;
    if (sdtParts) {
      const meta = sdtMeta(xml);
      const group = sdtGroupSeq++;
      for (const part of sdtParts) {
        const i2 = elements.length;
        elements.push({ name: part.name, start: el.start + part.start, end: el.start + part.end });
        const childXml = xml.slice(part.childStart, part.childEnd);
        const block2 = await buildBlock(
          { name: part.name, start: el.start + part.childStart, end: el.start + part.childEnd },
          i2,
          childXml,
          buildCtx
        );
        block2.originalXml = xml.slice(part.start, part.end);
        block2.sdtShell = {
          ...meta,
          openXml: xml.slice(part.start, part.childStart),
          closeXml: xml.slice(part.childEnd, part.end),
          group
        };
        if (!block2.label) block2.label = meta.alias || meta.tag || "Content control";
        blocks.push(block2);
        buildCtx.floatTableAhead = floatTableColumnSpan(block2, sectionAt(el.start));
      }
      continue;
    }
    if (el.name === "w:altChunk" && options.expandAltChunks !== false) {
      const expanded = await expandAltChunk(xml, zip, rels, styles, numbering, docPath);
      if (expanded.length > 0) {
        expanded.forEach((block2, k) => {
          const i2 = elements.length;
          elements.push(k === 0 ? el : { name: el.name, start: el.end, end: el.end });
          blocks.push({ ...block2, id: `b${i2}`, docxIndex: i2 });
        });
        continue;
      }
    }
    const i = elements.length;
    elements.push(el);
    const block = await buildBlock(el, i, xml, buildCtx, zoteroFieldParagraphs.get(el.start));
    blocks.push(block);
    buildCtx.floatTableAhead = floatTableColumnSpan(block, sectionAt(el.start));
  }
  foldFieldCodeParagraphs(blocks, buildCtx);
  applyTocEntryNumbers(blocks, numbering);
  bandWrappedBoxesBeforeTables(blocks);
  normalizeImageZOrders(blocks);
  applyProtectedLeadingBreaks(blocks);
  const readHf = (kind, hfType) => readHeaderFooterPart(
    zip,
    documentXml,
    rels,
    kind,
    hfType,
    theme.colors,
    styles,
    compatibilityMode,
    theme.fonts,
    docDefaults,
    docPath
  );
  const header = await readHf("header", "default");
  const footer = await readHf("footer", "default");
  const headerFirst = await readHf("header", "first");
  const footerFirst = await readHf("footer", "first");
  const headerEven = await readHf("header", "even");
  const footerEven = await readHf("footer", "even");
  const titlePg = xmlFlagOn(documentXml, "w:titlePg");
  const evenAndOddHeaders = await parseSettingsFlag(zip, "w:evenAndOddHeaders");
  const mirrorMargins = await parseSettingsFlag(zip, "w:mirrorMargins");
  const layoutSettings = await parseLayoutSettings(zip);
  const hfParts = await parseAllHfParts(
    zip,
    rels,
    styles,
    theme.colors,
    compatibilityMode,
    theme.fonts,
    docDefaults,
    docPath
  );
  if (layoutSettings.balanceDbcsSpacing) {
    const hfGroups = [];
    for (const part of [header, footer, headerFirst, footerFirst, headerEven, footerEven]) {
      for (const para of part?.paras ?? []) {
        hfGroups.push(para.runs);
        for (const cell of para.cells ?? []) hfGroups.push(...cell.paras);
      }
    }
    for (const part of Object.values(hfParts ?? {})) {
      for (const para of part.paras) {
        hfGroups.push(para.runs);
        for (const cell of para.cells ?? []) hfGroups.push(...cell.paras);
      }
    }
    applyBalancedDbcsSpacing([...blockRunGroups(blocks), ...hfGroups], docDefaults?.eastAsiaFont);
  }
  const inks = [];
  for (const block of blocks) {
    if (block.docxIndex === null || !block.originalXml) continue;
    for (const run2 of findInkRuns(block.originalXml)) {
      inks.push({
        anchorIndex: block.docxIndex,
        offsetXPx: run2.offsetXPx,
        offsetYPx: run2.offsetYPx,
        widthPx: run2.widthPx,
        heightPx: run2.heightPx,
        dataUrl: run2.embedRId ? await mediaDataUrl(zip, rels, run2.embedRId, docPath) : null,
        payload: run2.payload
      });
    }
  }
  return {
    blocks,
    zoteroDocumentData,
    comments,
    protection,
    writeProtection,
    removePersonalInfo,
    footnotes,
    endnotes,
    ...footnoteProps ? { footnoteProps } : {},
    ...endnoteProps ? { endnoteProps } : {},
    noteNumbers: Object.fromEntries(noteNumbers),
    sources,
    inks,
    themeFonts: theme.fonts,
    themeColors: theme.colors,
    ...fontTable.length > 0 ? { fontTable } : {},
    ...embeddedFonts.length > 0 ? { embeddedFonts } : {},
    watermarkText: header?.watermark ?? null,
    watermarkPicture: header?.watermarkPicture ?? null,
    headerText: header?.text ?? null,
    headerParas: header?.paras ?? null,
    footerParas: footer?.paras ?? null,
    headerImages: header?.images ?? null,
    footerImages: footer?.images ?? null,
    footerText: footer?.text ?? null,
    footerHasPageNumber: footer?.hasPageNumber ?? false,
    headerHasPageNumber: header?.hasPageNumber ?? false,
    titlePg,
    evenAndOddHeaders,
    ...mirrorMargins ? { mirrorMargins } : {},
    ...gutterAtTop ? { gutterAtTop } : {},
    compatibilityMode,
    ...layoutSettings,
    headerFirst: hfPartInfo(headerFirst),
    footerFirst: hfPartInfo(footerFirst),
    headerEven: hfPartInfo(headerEven),
    footerEven: hfPartInfo(footerEven),
    hfParts,
    styles,
    docDefaults,
    headingStyleIds,
    listParagraphStyleId,
    numbering,
    internal: {
      originalBytes: bytes,
      documentXml,
      bodyInnerStart: scan.innerStart,
      bodyInnerEnd: scan.innerEnd,
      bodyContentStart: scan.bodyContentStart,
      bodyContentEnd: scan.bodyContentEnd
    },
    extras: {
      elements,
      opaqueRegions: scan.opaqueRegions,
      chartParts,
      lazyMediaHashes: [...lazyHashesByZip.get(zip) ?? []],
      ...unconvertedChunksByZip.get(zip) ? { altChunksNeedConverter: unconvertedChunksByZip.get(zip) } : {}
    }
  };
}
function listRefOf(ctx, pPr, styleId) {
  const numPr = pPr ? findChild(pPr, "w:numPr") : void 0;
  const directNumId = numPr ? attrsOf(findChild(numPr, "w:numId") ?? {})["w:val"] : void 0;
  const directIlvl = numPr ? attrsOf(findChild(numPr, "w:ilvl") ?? {})["w:val"] : void 0;
  if (directNumId === "0") return void 0;
  const styleNum = styleId ? ctx.styles.get(styleId)?.numPr : void 0;
  const styleNumPr = styleNum === "none" ? void 0 : styleNum;
  const numId = directNumId ?? styleNumPr?.numId;
  if (!numId) return void 0;
  const ilvl = directIlvl !== void 0 ? parseInt(directIlvl, 10) || 0 : styleNumPr?.ilvl ?? 0;
  return { numId, ilvl };
}
function listKindOf(ctx, numId, ilvl) {
  const fmt = ctx.numbering.get(numId)?.levels[ilvl]?.numFmt;
  if (fmt !== void 0) return fmt === "bullet" ? "bullet" : "ordered";
  return ctx.numFormats.get(numId) ?? "bullet";
}
var INVISIBLE_BODY_MARKERS = /* @__PURE__ */ new Set([
  "w:bookmarkStart",
  "w:bookmarkEnd",
  "w:commentRangeStart",
  "w:commentRangeEnd",
  "w:proofErr",
  "w:permStart",
  "w:permEnd",
  "w:moveFromRangeStart",
  "w:moveFromRangeEnd",
  "w:moveToRangeStart",
  "w:moveToRangeEnd",
  "w:customXmlInsRangeStart",
  "w:customXmlInsRangeEnd",
  "w:customXmlDelRangeStart",
  "w:customXmlDelRangeEnd"
]);
async function expandAltChunk(xml, zip, rels, styles, numbering, sourcePath = "word/document.xml") {
  const rId = /\br:id\s*=\s*["']([^"']+)["']/.exec(xml)?.[1];
  if (!rId) return [];
  try {
    const bytes = await altChunkToDocx(
      zip,
      rels,
      rId,
      async (path) => {
        const { defaults, overrides } = await contentTypesOf(zip);
        return overrides.get(`/${path}`) ?? defaults.get(path.split(".").pop()?.toLowerCase() ?? "");
      },
      sourcePath
    );
    if (!bytes) {
      if (!hasAltChunkHtmlConverter()) {
        unconvertedChunksByZip.set(zip, (unconvertedChunksByZip.get(zip) ?? 0) + 1);
      }
      return [];
    }
    const sub = await parseDocx(bytes, { expandAltChunks: false });
    for (const [id, info] of sub.styles) if (!styles.has(id)) styles.set(id, info);
    let nextNumId = 1;
    for (const id of numbering.keys()) nextNumId = Math.max(nextNumId, (Number(id) || 0) + 1);
    const abstractPrefix = `altChunk${nextNumId}:`;
    const numIdMap = /* @__PURE__ */ new Map();
    const remap = (list) => {
      let mapped = numIdMap.get(list.numId);
      if (!mapped) {
        const def = sub.numbering.get(list.numId);
        mapped = String(nextNumId++);
        if (def) {
          numbering.set(mapped, {
            ...def,
            numId: mapped,
            abstractNumId: abstractPrefix + def.abstractNumId
          });
        }
        numIdMap.set(list.numId, mapped);
      }
      return { ...list, numId: mapped };
    };
    const remapTable = (table) => {
      for (const row of table.rows) {
        for (const cell of row) {
          for (const para of cell.richParas ?? []) if (para.list) para.list = remap(para.list);
          for (const nested of cell.nestedTables ?? []) remapTable(nested);
        }
      }
    };
    const blocks = sub.blocks.filter((b) => !b.hidden);
    for (const block of blocks) {
      block.altChunk = true;
      if (block.list) block.list = remap(block.list);
      if (block.table) remapTable(block.table);
    }
    return blocks;
  } catch {
    return [];
  }
}
async function buildBlock(el, index, xml, ctx, zoteroField) {
  const base = { id: `b${index}`, docxIndex: index, originalXml: xml };
  if (el.name === "w:ins" || el.name === "w:del") {
    const openEnd = xml.indexOf(">") + 1;
    const closeStart = xml.lastIndexOf(`</${el.name}>`);
    const child = splitXmlChildren(xml.slice(openEnd, closeStart)).find(
      (entry) => entry.name === "w:p" || entry.name === "w:tbl"
    );
    if (child) {
      const inner = await buildBlock(
        { name: child.name, start: el.start, end: el.end },
        index,
        child.xml,
        ctx
      );
      let revisionAttrs = {};
      try {
        const parsed = xmlParser.parse(xml);
        const revisionNode = parsed.find((node) => nameOf(node) === el.name);
        if (revisionNode) revisionAttrs = attrsOf(revisionNode);
      } catch {
      }
      inner.originalXml = xml;
      inner.blockRevision = {
        kind: el.name === "w:ins" ? "ins" : "del",
        author: revisionAttrs["w:author"] ?? "",
        ...revisionAttrs["w:date"] ? { date: revisionAttrs["w:date"] } : {},
        ...revisionAttrs["w:id"] ? { id: revisionAttrs["w:id"] } : {}
      };
      return inner;
    }
  }
  if (el.name === "w:sectPr") {
    return { ...base, type: "passthrough", label: "Section properties", hidden: true };
  }
  if (el.name === "w:tbl") {
    return {
      ...base,
      type: "table",
      ...tableSummary(xml),
      table: extractTable(xml, ctx, el.start)
    };
  }
  if (el.name === "w:sdt") {
    const tblXml = sdtTableXml(xml);
    if (tblXml) {
      return {
        ...base,
        type: "table",
        ...tableSummary(tblXml),
        table: extractTable(tblXml, ctx, el.start)
      };
    }
    const sdtResult = parseSdtBlock(xml);
    if (sdtResult) {
      const { shell, pXml } = sdtResult;
      const syntheticEl = { name: "w:p", start: el.start, end: el.end };
      const innerBlock = await buildBlock(syntheticEl, index, pXml, ctx);
      innerBlock.originalXml = xml;
      innerBlock.sdtShell = shell;
      if (!innerBlock.label) {
        const aliasLabel = shell.alias || shell.tag || "Content control";
        innerBlock.label = aliasLabel;
      }
      return innerBlock;
    }
    const sdtPreview = plainText(xml);
    if (!sdtPreview.trim() && !xml.includes("<w:drawing") && !/<w:pict[\s>]/.test(xml)) {
      return { ...base, type: "passthrough", label: "Content control", invisibleMarker: true };
    }
    return { ...base, type: "passthrough", label: "Content control", previewText: sdtPreview };
  }
  if (INVISIBLE_BODY_MARKERS.has(el.name)) {
    return { ...base, type: "passthrough", label: el.name, invisibleMarker: true };
  }
  if (el.name === "w:br") {
    if (/w:type="page"/.test(xml)) {
      return {
        ...base,
        type: "passthrough",
        label: "Page break",
        fieldDisplay: { kind: "pageBreak" }
      };
    }
    return { ...base, type: "passthrough", label: el.name, invisibleMarker: true };
  }
  if (el.name !== "w:p") {
    return { ...base, type: "passthrough", label: el.name, previewText: "" };
  }
  const detect = stripInkRuns(
    xml.includes("<mc:Fallback") ? xml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, "") : xml
  );
  if (detect.includes("<w:sectPr") && !plainText(detect).trim()) {
    if (!RICH_DRAWING_RE.test(detect) && await hasResolvablePicture(detect, ctx))
      return buildTextParagraph(base, xml, ctx, true, el.start);
    return {
      ...base,
      type: "passthrough",
      label: "Section break paragraph",
      previewText: ""
    };
  }
  const fieldDetect = detect.includes("<w:txbxContent") ? stripTextboxes(detect) : detect;
  const hasFields = fieldDetect.includes("<w:fldChar") || fieldDetect.includes("<w:fldSimple") || fieldDetect.includes("<w:instrText");
  if (hasFields && detect.includes("<w:drawing") && !detect.includes("<c:chart") && !detect.includes("r:dm=") && !detect.includes("<dgm:") && plainText(stripTextboxes(detect)).trim() === "") {
    const image = await extractImage(detect, ctx);
    if (image) {
      return { ...base, type: "image", label: "Image", imageDataUrl: image, ...imageMeta(detect) };
    }
  }
  const fieldPassthrough = () => {
    const pStyle = tagAttr(xml, "w:pStyle", "w:val");
    const fieldDisplay = fieldDisplayOf(xml, ctx.styles);
    if (fieldDisplay?.kind === "text") {
      const runs = fieldResultRuns(xml, ctx, fieldDisplay.left ?? "");
      if (runs) fieldDisplay.runs = runs;
    }
    return {
      ...base,
      type: "passthrough",
      label: fieldLabel(xml),
      previewText: plainText(xml),
      fieldDisplay,
      ...pStyle ? { styleId: pStyle } : {}
    };
  };
  const hasChart = detect.includes("<c:chart") || detect.includes("<cx:chart");
  if (hasFields && !hasChart && !zoteroField) {
    if (detect.includes("<w:object") && onlyOleFields(fieldDetect)) {
      return {
        ...base,
        type: "passthrough",
        label: "Embedded object",
        previewText: plainText(detect),
        ...await oleDisplay(detect, ctx)
      };
    }
    if (!onlyXeFields(detect)) return fieldPassthrough();
  }
  const tocStyleId = tagAttr(xml, "w:pStyle", "w:val");
  if (tocStyleId && tocLevelOf(tocStyleId, ctx.styles) !== null) {
    return {
      ...base,
      type: "passthrough",
      label: "TOC entry",
      previewText: plainText(xml),
      fieldDisplay: fieldDisplayOf(xml, ctx.styles),
      styleId: tocStyleId
    };
  }
  if (/<w:(delInstrText|cellIns|cellDel)[ />]/.test(detect)) {
    return {
      ...base,
      type: "passthrough",
      label: "Revised paragraph",
      previewText: plainText(detect)
    };
  }
  if (detect.includes("<m:oMath") && (detect.includes("<m:oMathPara") || plainText(detect).trim() === "")) {
    const tokens = mathTokens(detect);
    const omml = ommlFragmentsOf(detect).join("");
    const mathml = plainText(detect).trim() === "" ? ommlToMathML(omml) : "";
    const latex = omml ? ommlToLatex(omml) : null;
    return {
      ...base,
      type: "passthrough",
      label: "Equation",
      previewText: tokens.join(""),
      formulaDisplay: {
        tokens,
        ...mathml ? { mathml } : {},
        ...omml ? { omml } : {},
        ...latex ? { latex } : {}
      }
    };
  }
  if (detect.includes("<w:object") || /<w:pict[\s>]/.test(detect)) {
    if (!detect.includes("<w:object") && (detect.includes("<w:txbxContent") || VML_WORDART_RE.test(detect) || hasFloatingVmlGeometry(detect))) {
      const hostXml = stripTextboxes(detect);
      const anchoredPics = hostXml.includes("<w:drawing") && (hostXml.includes("<pic:pic") || hostXml.includes("<a:blip"));
      if (anchoredPics || VML_PICT_RID_RE.test(hostXml)) await resolveBlipMedia(detect, ctx);
      const textboxes = extractTextboxes(
        detect,
        ctx,
        anchoredPics ? {
          shapes: true,
          pictures: true,
          section: ctx.sectionAt?.(el.start),
          docOffset: el.start,
          firstPage: index > 0 && (ctx.firstPageBreakAt === void 0 || el.start < ctx.firstPageBreakAt)
        } : {
          docOffset: el.start,
          ...hasFloatingVmlGeometry(detect) ? { shapes: true } : {},
          // pure VML paragraphs resolve mso-position keywords against the
          // section; a DrawingML twin keeps the section-free legacy placement
          ...hostXml.includes("<w:drawing") ? {} : { section: ctx.sectionAt?.(el.start) }
        }
      );
      const strayText = plainText(stripTextboxes(detect)).trim();
      const keepForImages = strayText !== "" && VML_PICT_RID_RE.test(detect);
      if (textboxes.length > 0 && !keepForImages) {
        const stray = strayText !== "" ? strayParaRuns(detect.replace(/<w:pict>[\s\S]*?<\/w:pict>/g, ""), ctx) : null;
        const listStray = stray?.list && stray.runs.length > 0 ? { ...stray, list: stray.list } : null;
        if (strayText !== "" && !listStray) {
          const strayBox = paragraphStrayBox(detect, ctx);
          if (strayBox) textboxes.push(strayBox);
        }
        const jc = /<w:jc w:val="([^"]+)"/.exec(stripTextboxes(detect))?.[1];
        return {
          ...base,
          type: "passthrough",
          label: "Text box",
          // floating shapes leave the flow, but Word still lays the anchor
          // paragraph out as an empty line of its own style and spacing
          ...el.name === "w:p" ? { anchorLine: anchorLineOf(xml) } : {},
          previewText: [
            ...listStray ? [strayText] : [],
            ...textboxes.flatMap((t) => t.paras.map((p) => p.runs.map((r) => r.text).join("")))
          ].join("\n"),
          textboxes,
          ...hostPageBreak(detect) ? { fieldDisplay: { kind: "pageBreak" } } : {},
          ...jc === "center" ? { imageAlign: "center" } : jc === "right" || jc === "end" ? { imageAlign: "right" } : {},
          ...listStray ? {
            strayRuns: listStray.runs,
            ...listStray.styleId ? { strayStyleId: listStray.styleId } : {},
            ...listStray.indent ? { strayIndent: listStray.indent } : {},
            ...listStray.align ? { strayAlign: listStray.align } : {},
            strayList: listStray.list
          } : {}
        };
      }
    }
    if (!detect.includes("<w:object") && VML_PICT_RID_RE.test(detect)) {
      if (plainText(stripTextboxes(detect)).trim() !== "") {
        await resolveBlipMedia(detect, ctx);
        return buildTextParagraph(base, xml, ctx, true, el.start);
      }
      const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(detect)?.[1];
      const image = rId ? await mediaDataUrl(ctx.zip, ctx.rels, rId, ctx.sourcePath ?? "word/document.xml") : null;
      if (image) {
        return {
          ...base,
          type: "image",
          label: "Image",
          imageDataUrl: image,
          ...vmlImageMeta(detect)
        };
      }
    }
    if (!detect.includes("<w:object") && plainText(detect).trim() === "" && isInvisibleVmlPict(detect)) {
      return {
        ...base,
        type: "passthrough",
        label: "Drawing object",
        invisibleMarker: true,
        ...el.name === "w:p" ? { anchorLine: anchorLineOf(xml) } : {}
      };
    }
    if (!detect.includes("<w:object") && vmlPictsInlineOnly(detect, ctx.vmlShapeTypes)) {
      return buildTextParagraph(base, xml, ctx, true, el.start);
    }
    if (!detect.includes("<w:object") && /<v:rect\b[^>]*\bo:hr="t"[^>]*>/.test(detect)) {
      if (detect.includes("<a:blip")) await resolveBlipMedia(detect, ctx);
      return buildTextParagraph(base, xml, ctx, true, el.start);
    }
    if (detect.includes("<w:object") && (plainText(stripTextboxes(detect)).trim() !== "" || detect.includes("<w:drawing"))) {
      await resolveBlipMedia(detect, ctx);
      const objects = detect.match(/<w:object[\s\S]*?<\/w:object>/g) ?? [];
      const displayable = objects.every((o) => {
        const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(o)?.[1];
        return rId !== void 0 && ctx.mediaByRid?.has(rId);
      });
      if (displayable && objects.length > 0)
        return buildTextParagraph(base, xml, ctx, true, el.start);
    }
    return {
      ...base,
      type: "passthrough",
      label: "Embedded object",
      previewText: plainText(detect),
      ...await oleDisplay(detect, ctx)
    };
  }
  if (detect.includes("<w:drawing")) {
    if (detect.includes("<c:chart") || detect.includes("<cx:chart") || detect.includes("r:dm=") || detect.includes("<dgm:")) {
      const isChart = detect.includes("<c:chart") || detect.includes("<cx:chart");
      if (isChart && !hasFields && detect.includes('/drawing/2014/chartex"')) {
        const fbImage = await extractImage(xml, ctx);
        if (fbImage) {
          return {
            ...base,
            type: "image",
            label: "Image",
            imageDataUrl: fbImage,
            ...imageMeta(xml)
          };
        }
      }
      const chartDisplay = isChart ? await extractChart(detect, ctx) : null;
      if (isChart && !chartDisplay && hasFields) return fieldPassthrough();
      const caption = chartDisplay && plainText(stripTextboxes(detect)).trim() !== "" ? fieldDisplayOf(xml, ctx.styles) : void 0;
      if (caption?.kind === "text") {
        const runs = fieldResultRuns(xml, ctx, caption.left ?? "");
        if (runs) caption.runs = runs;
      }
      const diagramText = isChart ? null : await extractDiagramText(detect, ctx);
      const diagramDisplay = isChart ? null : await extractDiagramDrawing(detect, ctx);
      const frags = topLevelDrawings(detect);
      let siblingBoxes = [];
      if (!isChart && frags.length > 1) {
        if (diagramDisplay) {
          const dmFrag = frags.find((f) => f.includes("r:dm="));
          const meta = dmFrag ? drawingAnchorMeta(dmFrag) : {};
          if (meta.anchored) {
            diagramDisplay.offsetXEmu = meta.offsetXEmu;
            diagramDisplay.offsetYEmu = meta.offsetYEmu;
            diagramDisplay.floating = true;
          }
        }
        await resolveBlipMedia(detect, ctx);
        siblingBoxes = extractTextboxes(detect, ctx, {
          shapes: true,
          pictures: true,
          section: ctx.sectionAt?.(el.start),
          docOffset: el.start
        });
      }
      return {
        ...base,
        type: "passthrough",
        label: isChart ? "Chart" : "SmartArt",
        ...chartDisplay ? { chartDisplay, previewText: chartDisplay.title ?? "" } : {},
        ...caption?.kind === "text" ? { fieldDisplay: caption } : {},
        ...diagramText ? { previewText: diagramText } : {},
        ...diagramDisplay ? { diagramDisplay } : {},
        ...siblingBoxes.length > 0 ? { textboxes: siblingBoxes } : {}
      };
    }
    if (detect.includes("<lc:lockedCanvas")) {
      await resolveBlipMedia(detect, ctx);
      const canvas = extractLockedCanvas(detect, ctx);
      if (canvas) {
        const frags = topLevelDrawings(detect);
        const meta = frags.length > 0 ? drawingAnchorMeta(frags[0]) : {};
        if (meta.anchored) {
          canvas.offsetXEmu = meta.offsetXEmu;
          if (meta.noWrap) canvas.floating = true;
        }
        return {
          ...base,
          type: "passthrough",
          label: "Drawing object",
          diagramDisplay: canvas,
          previewText: canvas.shapes.flatMap((s) => s.texts ?? []).join("\n")
        };
      }
    }
    const image = await extractImage(detect, ctx);
    const hasWsp = detect.includes("<wps:wsp");
    let spanningPhotoRow = false;
    if (image) {
      const boxed = detect.includes("<w:txbxContent") ? extractTextboxes(detect, ctx).some(
        (t) => t.paras.some(
          (p) => p.runs.some((r) => r.text.trim() !== "") || p.cells?.some((c) => c.paras.some((rs) => rs.some((r) => r.text.trim() !== "")))
        )
      ) : false;
      if (!boxed) {
        const multiPic = (detect.match(/<a:blip[ />]/g) ?? []).length > 1;
        const hasText = plainText(stripTextboxes(detect)).trim() !== "";
        const drawings = topLevelDrawings(detect);
        const anchoredDrawings = drawings.filter((f) => f.includes("<wp:anchor")).length;
        const inlineBesideAnchor = anchoredDrawings === 1 && drawings.some((f) => !f.includes("<wp:anchor") && f.includes("<pic:pic"));
        if (hasText && !hasWsp || multiPic && (!detect.includes("<wp:anchor") || inlineBesideAnchor && !hasWsp)) {
          await resolveBlipMedia(detect, ctx);
          const inlinePics = drawings.filter(
            (f) => !f.includes("<wp:anchor") && f.includes("<pic:pic")
          ).length;
          spanningPhotoRow = hasText && anchoredDrawings >= 2 && inlinePics === 0 && extractTextboxes(detect, ctx, {
            pictures: true,
            section: ctx.sectionAt?.(el.start),
            docOffset: el.start
          }).some((b) => b.bandBottomPx !== void 0);
          if (!spanningPhotoRow) return buildTextParagraph(base, xml, ctx, true, el.start);
        }
        if (!hasWsp && anchoredDrawings <= 1) {
          const meta = imageMeta(detect);
          const sect = ctx.sectionAt?.(el.start);
          if (ctx.floatTableAhead && pictureBesideFloatTable(meta, detect, ctx.floatTableAhead, sect) || pictureOverhangsColumn(meta, detect, sect)) {
            meta.imageBand = true;
          }
          const sideWrapped = /^(?:square|tight|through)-(?:left|right)$/.test(meta.imageWrap ?? "");
          return {
            ...base,
            type: "image",
            label: "Image",
            imageDataUrl: image,
            ...meta,
            ...sideWrapped && !meta.imageBand ? { anchorLine: anchorLineOf(xml) } : {}
          };
        }
      }
    }
    if (detect.includes("<a:blip")) await resolveBlipMedia(detect, ctx);
    const textboxes = extractTextboxes(detect, ctx, {
      shapes: true,
      pictures: true,
      section: ctx.sectionAt?.(el.start),
      docOffset: el.start,
      // page-pinning needs content ABOVE the anchor paragraph to matter: a
      // first-block anchor is already exact under the paragraph-origin path
      // (and stays aligned with the body text around it)
      firstPage: index > 0 && (ctx.firstPageBreakAt === void 0 || el.start < ctx.firstPageBreakAt)
    });
    const boxTexts = textboxes.flatMap(
      (t) => t.paras.map((p) => p.runs.map((r) => r.text).join(""))
    );
    const strayText = plainText(stripTextboxes(detect)).trim();
    if (strayText !== "" && !spanningPhotoRow && !boxTexts.some((t) => t.trim() !== "") && !(hasWsp && textboxes.length > 0)) {
      return buildTextParagraph(base, xml, ctx, true, el.start);
    }
    if (textboxes.length > 0) {
      const inlineRunPics = detect.includes("<wp:anchor") && topLevelDrawings(detect).some(
        (f) => !f.includes("<wp:anchor") && f.includes("<pic:pic") && !f.includes("<w:txbxContent")
      );
      const stray = strayText !== "" || inlineRunPics ? strayParaRuns(detect, ctx, inlineRunPics) : null;
      const meta = imageMeta(detect);
      const anchorLine = stray?.runs.length || el.name === "w:p" && !/-(?:left|right)$/.test(meta.imageWrap ?? "") ? strayAnchorLine(xml, ctx) : void 0;
      return {
        ...base,
        type: "passthrough",
        label: "Text box",
        previewText: (strayText !== "" ? [strayText, ...boxTexts] : boxTexts).join("\n"),
        textboxes,
        .../^<w:p\b[^>]*>\s*<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:snapToGrid w:val="(?:0|false)"\s*\/>/.test(
          xml
        ) ? { anchorSnapToGrid: false } : {},
        ...hostPageBreak(detect) ? { fieldDisplay: { kind: "pageBreak" } } : {},
        // the line lays out with the anchor paragraph's spacing and line rule;
        // wp:positionV paragraph offsets count from the top of its
        // space-before (Word probe 2026-09-17)
        ...anchorLine ? { anchorLine } : {},
        ...stray && stray.runs.length > 0 ? {
          strayRuns: stray.runs,
          ...stray.styleId ? { strayStyleId: stray.styleId } : {},
          ...stray.indent ? { strayIndent: stray.indent } : {},
          ...stray.align ? { strayAlign: stray.align } : {},
          ...stray.list ? { strayList: stray.list } : {}
        } : {},
        ...meta
      };
    }
    if (image) {
      return { ...base, type: "image", label: "Image", imageDataUrl: image, ...imageMeta(detect) };
    }
    if (detect.includes("<a:blip") || detect.includes("<pic:pic")) {
      const docPr = /<wp:docPr [^>]*\/?>/.exec(detect)?.[0] ?? "";
      const alt = /\bdescr="([^"]+)"/.exec(docPr)?.[1] ?? /\bname="([^"]+)"/.exec(docPr)?.[1];
      return {
        ...base,
        type: "passthrough",
        label: "Image",
        brokenImage: true,
        ...alt ? { previewText: decodeEntities(alt) } : {},
        ...imageMeta(detect)
      };
    }
    if (isInvisibleEmptyShape(detect)) {
      return { ...base, type: "passthrough", label: "Drawing object", invisibleMarker: true };
    }
    const decorative = isThinRule(detect);
    return {
      ...base,
      type: "passthrough",
      label: "Drawing object",
      decorative,
      ...decorative ? ruleDisplayOf(detect) : {}
    };
  }
  return buildTextParagraph(base, xml, ctx, false, el.start, zoteroField);
}
function crossParagraphZoteroFields(bodyElements, documentXml) {
  const result = /* @__PURE__ */ new Map();
  let nextId = 1;
  let active;
  const tokenRe = /<w:fldChar\b[^>]*>|<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g;
  for (const el of bodyElements) {
    if (el.name !== "w:p") {
      active = void 0;
      continue;
    }
    const xml = documentXml.slice(el.start, el.end);
    if (active) active.paragraphStarts.push(el.start);
    for (const match of xml.matchAll(tokenRe)) {
      const token = match[0];
      if (token.startsWith("<w:instrText")) {
        if (active?.depth === 1) {
          active.instruction += decodeEntities(token.replace(/<[^>]+>/g, ""));
        }
        continue;
      }
      const fieldType = /\bw:fldCharType\s*=\s*["'](begin|separate|end)["']/.exec(token)?.[1];
      if (fieldType === "begin") {
        if (active) active.depth++;
        else active = { depth: 1, instruction: "", paragraphStarts: [el.start] };
      } else if (fieldType === "end" && active) {
        active.depth--;
        if (active.depth === 0) {
          const paragraphs = [...new Set(active.paragraphStarts)];
          const instruction = active.instruction.trim();
          if (paragraphs.length > 1 && ZOTERO_INLINE_FIELD_RE.test(instruction)) {
            const id = nextId++;
            paragraphs.forEach((start, index) => {
              const part = index === 0 ? "begin" : index === paragraphs.length - 1 ? "end" : "inside";
              result.set(start, { id, instruction, part });
            });
          }
          active = void 0;
        }
      }
    }
  }
  return result;
}
function headingLevelOf(pPr, styleId, ctx) {
  const direct = pPr ? attrsOf(findChild(pPr, "w:outlineLvl") ?? {})["w:val"] : void 0;
  if (direct !== void 0) {
    const lvl = parseInt(direct, 10);
    return lvl >= 0 && lvl <= 8 ? lvl + 1 : void 0;
  }
  if (!styleId) return void 0;
  const info = ctx.styles.get(styleId);
  if (info) return info.headingLevel;
  const m = /^Heading([1-9])$/i.exec(styleId);
  return m ? parseInt(m[1], 10) : void 0;
}
function outlineOnlyHeading(pPr, styleId, ctx) {
  if (!pPr || !findChild(pPr, "w:outlineLvl")) return false;
  return headingLevelOf(void 0, styleId, ctx) === void 0;
}
var defaultParaVanishCache = /* @__PURE__ */ new WeakMap();
function defaultParaVanish(styles) {
  if (!styles) return void 0;
  let v = defaultParaVanishCache.get(styles);
  if (v === void 0) {
    v = false;
    for (const info of styles.values()) {
      if (info.isDefault && info.type === "paragraph") {
        v = info.display?.vanish === true;
        break;
      }
    }
    defaultParaVanishCache.set(styles, v);
  }
  return v || void 0;
}
var WORD_DEFAULT_SIZE_HALF_POINTS = 20;
function normalSizeHalfPoints(ctx) {
  return ctx.defaultParaStyle?.display?.sizeHalfPoints ?? ctx.docDefaults?.sizeHalfPoints ?? WORD_DEFAULT_SIZE_HALF_POINTS;
}
function paraTextSizeHalfPoints(ctx, runs, pNode, pPr, styleId) {
  const styleSize = styleId ? ctx.styles.get(styleId)?.display?.sizeHalfPoints : ctx.defaultParaStyle?.display?.sizeHalfPoints;
  const first = runs.find((r) => r.text !== "");
  return first?.sizeHalfPoints ?? (first?.styleId ? ctx.styles.get(first.styleId)?.display?.sizeHalfPoints : void 0) ?? (first ? void 0 : emptyParaSizeHalfPoints(pNode, pPr)) ?? styleSize ?? normalSizeHalfPoints(ctx);
}
function charUnitsOf(ctx, runs, pNode, pPr, styleId, docOffset) {
  const grid = docOffset !== void 0 ? ctx.sectionAt?.(docOffset).docGrid : void 0;
  const gridDelta = grid?.type === "linesAndChars" && grid.charSpace ? grid.charSpace / 4096 * 20 : 0;
  const normal = normalSizeHalfPoints(ctx);
  const first = runs.find((r) => r.text !== "");
  const run2 = paraTextSizeHalfPoints(ctx, runs, pNode, pPr, styleId);
  return {
    run: run2 * 10 + (first?.charSpacingTwips ?? 0) + gridDelta,
    normal: normal * 10 + gridDelta
  };
}
function withCharIndents(format, ctx, pNode, pPr, styleId, runs, opts) {
  const direct = charIndentsOf(pPr ? findChild(pPr, "w:ind") : void 0);
  const style = opts.list ? void 0 : (styleId ? ctx.styles.get(styleId) : ctx.defaultParaStyle)?.display?.indentChars;
  const chars = activeCharIndents(mergeCharIndents(style, direct));
  if (!chars) return format;
  return {
    ...resolveCharIndents(
      format,
      chars,
      charUnitsOf(ctx, runs, pNode, pPr, styleId, opts.docOffset)
    ),
    // the save path cancels these when it rebuilds w:ind in twips
    charIndents: chars
  };
}
function pictureColumnGeom(meta, xml, sect) {
  if (!sect || sect.columns > 1) return null;
  if (!/^(?:square|tight|through)-/.test(meta.imageWrap ?? "")) return null;
  if (meta.imageOffsetXEmu === void 0 || !meta.imageWidthPx) return null;
  const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP;
  const fromPage = /<wp:positionH[^>]*relativeFrom="page"/.test(xml);
  const x = meta.imageOffsetXEmu - (fromPage ? sect.marginLeft * EMU_PER_TWIP : 0);
  return {
    x,
    right: x + meta.imageWidthPx * EMU_PER_PX2,
    distL: meta.imageWrapDistLeftEmu ?? 0,
    distR: meta.imageWrapDistRightEmu ?? 0,
    colWEmu
  };
}
function pictureBesideFloatTable(meta, xml, table, sect) {
  const geo = pictureColumnGeom(meta, xml, sect);
  if (!geo) return false;
  const colWEmu = geo.colWEmu;
  const picture = [geo.x - geo.distL, geo.right + geo.distR];
  const tbl = [table.leftTwips * EMU_PER_TWIP, table.rightTwips * EMU_PER_TWIP];
  const spans = [tbl, picture].sort((a, b) => a[0] - b[0]);
  let gap = 0;
  let cursor = 0;
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return Math.max(gap, colWEmu - cursor) < MIN_WRAP_SLIVER_EMU;
}
function pictureOverhangsColumn(meta, xml, sect) {
  const geo = pictureColumnGeom(meta, xml, sect);
  if (!geo || geo.x >= 0 && geo.right <= geo.colWEmu) return false;
  return Math.max(geo.x - geo.distL, geo.colWEmu - geo.right - geo.distR) < MIN_WRAP_SLIVER_EMU;
}
function vmlHrRule(hrRect) {
  const fill = /fillcolor="#?([0-9A-Fa-f]{6})"/.exec(hrRect)?.[1];
  const hPt = parseFloat(/height:([\d.]+)pt/.exec(hrRect)?.[1] ?? "");
  const wPt = parseFloat(/width:([\d.]+)pt/.exec(hrRect)?.[1] ?? "");
  const align = /o:hralign="(center|right)"/.exec(hrRect)?.[1];
  return {
    ...fill ? { colorHex: fill.toUpperCase() } : {},
    ...hPt > 0 ? { thicknessPx: Math.max(1, Math.round(hPt / 72 * 96)) } : {},
    ...wPt > 0 ? { widthPx: Math.round(wPt / 72 * 96) } : {},
    ...wPt > 0 && align ? { align } : {}
  };
}
function buildTextParagraph(base, xml, ctx, withImages = false, docOffset, zoteroField) {
  let parsed;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return { ...base, type: "passthrough", label: "Paragraph", previewText: plainText(xml) };
  }
  const pNode = parsed.find((n) => nameOf(n) === "w:p");
  if (!pNode) {
    return { ...base, type: "passthrough", label: "Unknown paragraph", previewText: plainText(xml) };
  }
  const pPr = findChild(pNode, "w:pPr");
  const styleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
  if (styleId && ctx.styles.get(styleId)?.display?.vanish === true && staysVanished(xml)) {
    return { ...base, type: "passthrough", label: "Hidden paragraph", invisibleMarker: true };
  }
  if (!styleId && defaultParaVanish(ctx.styles) === true && staysVanished(xml)) {
    return { ...base, type: "passthrough", label: "Hidden paragraph", invisibleMarker: true };
  }
  const markRPr = pPr ? findChild(pPr, "w:rPr") : void 0;
  if (markRPr && onOffOf(markRPr, "w:vanish") === true && onOffOf(markRPr, "w:specVanish") !== true && plainText(xml).trim() === "" && staysVanished(xml) && !hasLayoutRunContent(pNode)) {
    return { ...base, type: "passthrough", label: "Hidden paragraph", invisibleMarker: true };
  }
  const paraStyle2 = styleId ? ctx.styles.get(styleId) : ctx.defaultParaStyle;
  let format = pPr ? extractParaFormat(pPr, ctx.themeColors, paraStyle2?.display?.bidi) : void 0;
  format = inheritStyleBreakFlags(format, paraStyle2);
  format = inheritStyleTabStops(format, paraStyle2);
  const rawPPr = rawPPrOf(xml);
  const mathXml = stripTextboxes(
    xml.includes("<mc:Fallback") ? xml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, "") : xml
  );
  const runs = extractRuns(
    pNode,
    ctx,
    ommlFragmentsOf(mathXml),
    rubyFragmentsOf(mathXml),
    withImages,
    zoteroField
  );
  const spaceOnly = runs.length > 0 && spaceOnlyRuns(runs) && !hasLayoutRunContent(pNode);
  const breakOnly = runs.length > 0 && breakOnlyRuns(runs) && !hasLayoutRunContent(pNode, LAYOUT_RUN_CONTENT_BESIDES_BREAKS);
  if (runs.length === 0 || spaceOnly || breakOnly) {
    const emptySz = emptyParaSizeHalfPoints(pNode, pPr, spaceOnly);
    if (emptySz) format = { ...format ?? {}, emptyRunSizeHalfPoints: emptySz };
    const emptyFont = emptyParaMarkFont(pNode, pPr, ctx.themeFonts, spaceOnly);
    if (emptyFont) format = { ...format ?? {}, emptyRunFontFamily: emptyFont };
  }
  const ptabStops = ptabDisplayStops(pNode);
  if (ptabStops.length > 0) {
    const stops = format?.tabStops ? [...format.tabStops] : [];
    for (const st of ptabStops) {
      if (!stops.some((s) => s.rel === "margin" && s.pos === st.pos)) stops.push(st);
    }
    format = { ...format ?? {}, tabStops: stops };
  }
  {
    const wrapped = runs.filter(
      (r) => r.image?.wrap && r.image.wrap !== "front" && r.image.wrap !== "behind"
    );
    if (wrapped.length > 1) {
      for (const r of wrapped) {
        const img = r.image;
        if (!img.noOverlap) continue;
        const top = (img.offsetYEmu ?? 0) / EMU_PER_PX2;
        const hit = wrapped.find((o) => {
          if (o === r || o.image.noOverlap) return false;
          const oTop = (o.image.offsetYEmu ?? 0) / EMU_PER_PX2;
          return top < oTop + (o.image.heightPx ?? 0) && oTop < top + (img.heightPx ?? 0);
        });
        if (!hit) continue;
        img.wrap = "front";
        img.offsetXEmu = 0;
        img.offsetYEmu = Math.round(((hit.image.heightPx ?? 0) + 2) * EMU_PER_PX2);
      }
    }
  }
  const { bookmarks, hiddenBookmarks } = bookmarkNamesOf(stripTextboxes(xml));
  const { commentStarts, commentEnds } = crossParaCommentMarkers(stripTextboxes(xml));
  let moveRevision;
  if (/<w:moveFrom[\s/>]/.test(xml)) moveRevision = "from";
  else if (/<w:moveTo[\s/>]/.test(xml)) moveRevision = "to";
  let pPrChangeInfo;
  if (pPr) {
    const pPrChangeEl = findChild(pPr, "w:pPrChange");
    if (pPrChangeEl) {
      const attrs = attrsOf(pPrChangeEl);
      pPrChangeInfo = { author: attrs["w:author"] ?? "" };
      if (attrs["w:date"]) pPrChangeInfo.date = attrs["w:date"];
      if (attrs["w:id"]) pPrChangeInfo.id = attrs["w:id"];
      const oldPPr = findChild(pPrChangeEl, "w:pPr");
      if (oldPPr) {
        const old = {
          ...extractParaFormat(oldPPr) ?? {}
        };
        const oldStyleId = attrsOf(findChild(oldPPr, "w:pStyle") ?? {})["w:val"];
        if (oldStyleId) old.styleId = oldStyleId;
        const oldNumPr = findChild(oldPPr, "w:numPr");
        const oldNumId = oldNumPr ? attrsOf(findChild(oldNumPr, "w:numId") ?? {})["w:val"] : void 0;
        if (oldNumId) {
          old.type = "docListItem";
          old.numId = oldNumId;
          old.ilvl = parseInt(attrsOf(findChild(oldNumPr, "w:ilvl") ?? {})["w:val"] ?? "0", 10) || 0;
          old.kind = listKindOf(ctx, oldNumId, old.ilvl);
        } else {
          const oldLevel = headingLevelOf(oldPPr, oldStyleId, ctx);
          if (oldLevel) {
            old.type = "docHeading";
            old.level = oldLevel;
          } else if (oldStyleId) {
            old.type = "docParagraph";
          }
        }
        if (old && Object.keys(old).length > 0) pPrChangeInfo.old = old;
      }
    }
  }
  let paraMarkDel;
  {
    const pRPr = pPr ? findChild(pPr, "w:rPr") : void 0;
    const delEl = pRPr ? findChild(pRPr, "w:del") : void 0;
    if (delEl) {
      const a = attrsOf(delEl);
      paraMarkDel = { author: a["w:author"] ?? "" };
      if (a["w:date"]) paraMarkDel.date = a["w:date"];
      if (a["w:id"]) paraMarkDel.id = a["w:id"];
    }
  }
  const listRef = listRefOf(ctx, pPr, styleId);
  format = withCharIndents(format, ctx, pNode, pPr, styleId, runs, { list: !!listRef, docOffset });
  const markSz = listRef ? emptyParaSizeHalfPoints(pNode, pPr, true) : void 0;
  if (markSz) format = { ...format ?? {}, markSizeHalfPoints: markSz };
  const revExtras = {
    ...moveRevision ? { moveRevision } : {},
    ...pPrChangeInfo ? { pPrChangeInfo } : {},
    ...paraMarkDel ? { paraMarkDel } : {}
  };
  if (listRef) {
    const kind = listKindOf(ctx, listRef.numId, listRef.ilvl);
    return {
      ...base,
      type: "listItem",
      styleId,
      list: { kind, numId: listRef.numId, ilvl: listRef.ilvl },
      format,
      rawPPr,
      bookmarks,
      hiddenBookmarks,
      commentStarts,
      commentEnds,
      runs,
      ...revExtras
    };
  }
  const headingLevel = headingLevelOf(pPr, styleId, ctx);
  if (headingLevel) {
    return {
      ...base,
      type: "heading",
      level: headingLevel,
      ...outlineOnlyHeading(pPr, styleId, ctx) ? { outlineOnly: true } : {},
      styleId,
      format,
      rawPPr,
      bookmarks,
      hiddenBookmarks,
      commentStarts,
      commentEnds,
      runs,
      ...revExtras
    };
  }
  return {
    ...base,
    type: "paragraph",
    styleId,
    format,
    rawPPr,
    bookmarks,
    hiddenBookmarks,
    commentStarts,
    commentEnds,
    runs,
    ...revExtras
  };
}
function strayParaRuns(paragraphXml, ctx, withImages = false) {
  try {
    let strayXml = stripTextboxes(paragraphXml);
    if (withImages) {
      for (const frag of topLevelDrawings(strayXml)) {
        if (frag.includes("<wp:anchor")) strayXml = strayXml.replace(frag, "");
      }
    }
    const parsed = xmlParser.parse(strayXml);
    const pNode = parsed.find((n) => nameOf(n) === "w:p");
    if (!pNode) return null;
    const runs = extractRuns(pNode, ctx, [], [], withImages).filter((r) => r.text !== "" || r.image);
    if (runs.length === 0) return null;
    const pPr = findChild(pNode, "w:pPr");
    const styleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
    let indent;
    const ind = pPr ? findChild(pPr, "w:ind") : void 0;
    if (ind) {
      const a = attrsOf(ind);
      const num2 = (v) => {
        const n = parseInt(v ?? "", 10);
        return Number.isFinite(n) && n !== 0 ? n : void 0;
      };
      const left = num2(a["w:left"] ?? a["w:start"]);
      const right = num2(a["w:right"] ?? a["w:end"]);
      const hanging = num2(a["w:hanging"]);
      const firstLine = hanging !== void 0 && hanging > 0 ? -hanging : num2(a["w:firstLine"]);
      if (left !== void 0 || right !== void 0 || firstLine !== void 0) {
        indent = {
          ...left !== void 0 ? { leftTwips: left } : {},
          ...right !== void 0 ? { rightTwips: right } : {},
          ...firstLine !== void 0 ? { firstLineTwips: firstLine } : {}
        };
      }
    }
    const jc = pPr ? attrsOf(findChild(pPr, "w:jc") ?? {})["w:val"] : void 0;
    const align = (jc ? JC_ALIGN[jc] : void 0) ?? (styleId ? ctx.styles.get(styleId)?.display?.align : void 0);
    const list = listRefOf(ctx, pPr, styleId);
    return {
      runs,
      ...styleId ? { styleId } : {},
      ...indent ? { indent } : {},
      ...align ? { align } : {},
      ...list ? { list } : {}
    };
  } catch {
    return null;
  }
}
function txbxContentParas(content, ctx, docOffset) {
  const out = [];
  const listItems = [];
  collectTxbxParas(content, ctx, docOffset, out, listItems);
  if (listItems.length === 0) return out;
  const infos = computeListMarkerInfos(
    listItems.map((item) => item.ref),
    ctx.numbering
  );
  listItems.forEach(({ para, ref, textSizeHalf }, i) => {
    const info = infos[i];
    if (!info) return;
    const level = ctx.numbering.get(ref.numId ?? "")?.levels[Math.max(0, ref.ilvl)];
    para.listMarker = {
      text: info.text,
      ...info.symbolFont ? { symbol: true } : {},
      ...info.picBulletSrc ? { picBulletSrc: info.picBulletSrc } : {},
      ...level?.indentLeft !== void 0 ? { indentLeft: level.indentLeft } : {},
      ...level?.hanging ? { hanging: level.hanging } : {},
      ...level?.firstLine ? { firstLine: level.firstLine } : {},
      ...level?.szHalfPoints ? { szHalfPoints: level.szHalfPoints } : {},
      ...level?.szHalfPoints && level.szHalfPoints > textSizeHalf ? { oversized: true } : {}
    };
  });
  return out;
}
function collectTxbxParas(content, ctx, docOffset, out, listItems) {
  for (const child of childrenOf(content)) {
    const name = nameOf(child);
    if (name === "w:p") {
      const para = { runs: extractRuns(child, ctx, [], [], true) };
      const pPr = findChild(child, "w:pPr");
      const styleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
      const listRef = listRefOf(ctx, pPr, styleId);
      Object.assign(
        para,
        withCharIndents(
          pPr ? extractParaFormat(
            pPr,
            ctx.themeColors,
            styleId ? ctx.styles.get(styleId)?.display?.bidi : void 0
          ) : void 0,
          ctx,
          child,
          pPr,
          styleId,
          para.runs,
          {
            list: !!listRef,
            docOffset
          }
        )
      );
      if (styleId) para.styleId = styleId;
      if (spaceOnlyRuns(para.runs) && !hasLayoutRunContent(child)) {
        const markSz = emptyParaSizeHalfPoints(child, pPr, true);
        if (markSz) para.emptyRunSizeHalfPoints = markSz;
      }
      if (listRef) {
        listItems.push({
          para,
          ref: listRef,
          textSizeHalf: paraTextSizeHalfPoints(ctx, para.runs, child, pPr, styleId)
        });
      }
      out.push(para);
    } else if (name === "w:tbl") {
      out.push(...txbxTableParas(child, ctx));
    } else if (name === "w:sdt") {
      const inner = findChild(child, "w:sdtContent");
      if (inner) collectTxbxParas(inner, ctx, docOffset, out, listItems);
    }
  }
}
function txbxTableParas(tbl, ctx) {
  return hfTableRowParagraphs(tbl, ctx, ctx.compatibilityMode ?? 0).map((p) => ({
    runs: [],
    cells: p.cells,
    row: p.row
  }));
}
function txbxParaVisible(p) {
  return p.runs.length > 0 || (p.cells?.length ?? 0) > 0;
}
function hasFloatingVmlGeometry(xml) {
  if (VML_PICT_RID_RE.test(xml) || xml.includes("<w:txbxContent")) return false;
  return /<v:(?:shape|rect|roundrect|oval)\b[^>]*\bstyle="[^"]*position:\s*absolute/.test(xml);
}
function vmlPictsInlineOnly(xml, shapeTypes) {
  const picts = xml.match(/<w:pict[\s>][\s\S]*?<\/w:pict>|<w:pict\s*\/>/g) ?? [];
  if (picts.length === 0 || VML_PICT_RID_RE.test(xml)) return false;
  return picts.every((pict) => {
    const body = pict.replace(/<v:shapetype\b[\s\S]*?<\/v:shapetype>|<v:shapetype\b[^>]*\/>/g, "");
    if (!/<v:\w+/.test(body)) return true;
    return !/position:\s*absolute/.test(pict) && vmlShapeSvg(pict, shapeTypes) !== null;
  });
}
function paragraphStrayBox(pXml, ctx) {
  const stripped = stripTextboxes(pXml).replace(/<w:pict>[\s\S]*?<\/w:pict>/g, "");
  let parsed;
  try {
    parsed = xmlParser.parse(stripped);
  } catch {
    return null;
  }
  const pNodes = [];
  collectNodes(parsed, "w:p", pNodes);
  if (pNodes.length === 0) return null;
  const para = { runs: extractRuns(pNodes[0], ctx) };
  const pPr = findChild(pNodes[0], "w:pPr");
  if (pPr) Object.assign(para, extractParaFormat(pPr, ctx.themeColors));
  if (!para.runs.some((r) => r.text.trim() !== "")) return null;
  return {
    paras: [para],
    readOnly: true,
    insetTopPx: 0,
    insetRightPx: 0,
    insetBottomPx: 0,
    insetLeftPx: 0
  };
}
var vmlFlagOff = (value) => value === "f" || value === "false" || value === "0";
function vmlStrokeChildOff(shape) {
  const stroke = findChild(shape, "v:stroke");
  return stroke !== void 0 && vmlFlagOff(attrsOf(stroke)["on"]);
}
function vmlStrokeWeightPx(value) {
  const m = /^\s*([\d.]+)\s*(pt|px)?\s*$/.exec(value ?? "");
  if (!m) return void 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return void 0;
  return Math.round((m[2] === "px" ? n : n / 72 * 96) * 100) / 100;
}
function applyVmlMsoPosition(box, style, sect) {
  const posH = /mso-position-horizontal:(\w+)/.exec(style)?.[1];
  const relH = /mso-position-horizontal-relative:(\w+)/.exec(style)?.[1] ?? "text";
  const relV = /mso-position-vertical-relative:(\w+)/.exec(style)?.[1] ?? "text";
  const marL = sect.marginLeft * EMU_PER_TWIP;
  const colW = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP;
  const fromPage = relH === "page";
  if (fromPage || relH === "margin" || sect.columns <= 1) {
    const originX = fromPage ? -marL : 0;
    const spanW = fromPage ? sect.pageWidth * EMU_PER_TWIP : colW;
    const wEmu = box.widthPx !== void 0 ? box.widthPx * EMU_PER_PX2 : void 0;
    if (posH === "left" || posH === "inside") box.offsetXEmu = Math.round(originX);
    else if ((posH === "right" || posH === "outside") && wEmu !== void 0)
      box.offsetXEmu = Math.round(originX + spanW - wEmu);
    else if (posH === "center" && wEmu !== void 0)
      box.offsetXEmu = Math.round(originX + (spanW - wEmu) / 2);
    else if (fromPage) box.offsetXEmu = Math.round((box.offsetXEmu ?? 0) + originX);
  }
  const posV = /mso-position-vertical:(\w+)/.exec(style)?.[1];
  const numericV = posV === void 0 || posV === "absolute";
  if ((relV === "page" || relV === "margin") && numericV) {
    if (relV === "page") {
      box.offsetYEmu = Math.round((box.offsetYEmu ?? 0) - sect.marginTop * EMU_PER_TWIP);
    }
    box.pageRelV = true;
    box.pageRelVFrom = relV;
  }
}
function extractTextboxes(xml, ctx, opts) {
  const hasLineShapes = xml.includes("<wp:wrapSquare") && LINE_PRSTS_RE.test(xml);
  const hasCanvasText = xml.includes("<a:txSp");
  const hasVmlWordArt = VML_WORDART_RE.test(xml);
  if (!xml.includes("<w:txbxContent") && !hasLineShapes && !hasCanvasText && !hasVmlWordArt && !(opts?.shapes || opts?.pictures)) {
    return [];
  }
  const frags = topLevelDrawings(xml);
  const multiDrawing = frags.length > 1;
  const out = [];
  let txbxOrdinal = 0;
  const buildWpsBox = (shape, groupFill, nested, grouped) => {
    const contents = [];
    collectNodes(childrenOf(shape), "w:txbxContent", contents);
    const topContents = [];
    collectTopNodes(childrenOf(shape), "w:txbxContent", topContents);
    const ordinal = txbxOrdinal;
    if (!nested) txbxOrdinal += topContents.length;
    if (contents.length === 0) {
      const extRid = attrsOf(findChild(shape, "wps:txbx") ?? {})["r:txbx"];
      const extXml = extRid ? ctx.externalTxbxByRid?.get(extRid) : void 0;
      if (extXml) {
        try {
          const nodes = xmlParser.parse(extXml);
          const root = nodes.find((n) => nameOf(n)?.endsWith(":txbx"));
          if (root) contents.push(root);
        } catch {
        }
      }
    }
    const spPr = findChild(shape, "wps:spPr");
    const prstOf = spPr ? attrsOf(findChild(spPr, "a:prstGeom") ?? {})["prst"] : void 0;
    const custGeomNode = spPr ? findChild(spPr, "a:custGeom") : void 0;
    if (contents.length === 0) {
      if (prstOf && LINE_PRSTS.has(prstOf)) {
        if (hasLineShapes) return lineBoxOf(shape, ctx.themeColors);
        if (!opts?.shapes) return null;
        const xfrm = findChild(spPr ?? {}, "a:xfrm");
        const cy = parseInt(attrsOf(findChild(xfrm ?? {}, "a:ext") ?? {})["cy"] ?? "", 10);
        const xa = attrsOf(xfrm ?? {});
        const flipped = ["flipH", "flipV"].some((k) => xa[k] === "1" || xa[k] === "true");
        const ln = findChild(spPr ?? {}, "a:ln");
        const arrowed = ["a:headEnd", "a:tailEnd"].some((name) => {
          const type = attrsOf(findChild(ln ?? {}, name) ?? {})["type"];
          return !!type && type !== "none";
        });
        return Number.isFinite(cy) && cy > 13e4 || flipped || arrowed ? lineBoxOf(shape, ctx.themeColors) : null;
      }
      if (hasLineShapes && !opts?.shapes) return null;
      if (!opts?.shapes || !prstOf && !custGeomNode) return null;
      if (prstOf === "rect") {
        const xfrm = findChild(spPr ?? {}, "a:xfrm");
        const cy = parseInt(attrsOf(findChild(xfrm ?? {}, "a:ext") ?? {})["cy"] ?? "", 10);
        const filledSibling = (grouped || multiDrawing) && !!findChild(spPr ?? {}, "a:solidFill");
        if (!filledSibling && (!Number.isFinite(cy) || cy <= 13e4)) return null;
      }
    }
    const box = { paras: [] };
    if (!nested && topContents.length > 0) box.txbxIndex = ordinal;
    if (nested) box.readOnly = true;
    const shapeId = attrsOf(findChild(shape, "wps:cNvPr") ?? {})["id"];
    if (!nested && shapeId) box.shapeId = shapeId;
    if (spPr) {
      if (!findChild(spPr, "a:noFill")) {
        const pattFill = findChild(spPr, "a:pattFill");
        const fill = colorNodeHex(findChild(spPr, "a:solidFill"), ctx.themeColors) ?? gradFillApproxHex(spPr, ctx.themeColors) ?? (pattFill ? colorNodeHex(findChild(pattFill, "a:fgClr"), ctx.themeColors) : void 0) ?? // a:grpFill inherits the enclosing wpg group's fill
        (findChild(spPr, "a:grpFill") ? groupFill : void 0);
        if (fill) box.fill = fill;
        const blipFill = findChild(spPr, "a:blipFill");
        if (blipFill) {
          const rId = attrsOf(findChild(blipFill, "a:blip") ?? {})["r:embed"];
          const dataUrl = rId ? ctx.mediaByRid?.get(rId) : void 0;
          if (dataUrl) {
            box.fillImageDataUrl = dataUrl;
            if (findChild(blipFill, "a:tile")) box.fillTile = true;
          }
        }
      }
      const ln = findChild(spPr, "a:ln");
      if (ln && !findChild(ln, "a:noFill")) {
        const border = colorNodeHex(findChild(ln, "a:solidFill"), ctx.themeColors);
        if (border) box.borderColor = border;
        const w = parseInt(attrsOf(ln)["w"] ?? "", 10);
        if (Number.isFinite(w) && w > 0) {
          box.borderWidthPx = Math.round(w / EMU_PER_PX2 * 100) / 100;
        }
        const dash = attrsOf(findChild(ln, "a:prstDash") ?? {})["val"];
        if (dash && dash !== "solid") box.borderDash = /dot/i.test(dash) ? "dotted" : "dashed";
      }
      const styleNode = findChild(shape, "wps:style");
      if (styleNode) {
        if (!box.fill && !box.fillImageDataUrl && !findChild(spPr, "a:noFill")) {
          const ref = findChild(styleNode, "a:fillRef");
          if (parseInt(attrsOf(ref ?? {})["idx"] ?? "0", 10) > 0) {
            const fill = colorNodeHex(ref, ctx.themeColors);
            if (fill) box.fill = fill;
          }
        }
        if (!box.borderColor && !(ln && findChild(ln, "a:noFill"))) {
          const ref = findChild(styleNode, "a:lnRef");
          if (parseInt(attrsOf(ref ?? {})["idx"] ?? "0", 10) > 0) {
            const border = colorNodeHex(ref, ctx.themeColors);
            if (border) box.borderColor = border;
          }
        }
        const fontColor = colorNodeHex(findChild(styleNode, "a:fontRef"), ctx.themeColors);
        if (fontColor) box.textColor = fontColor;
      }
      const prst = prstOf;
      if (prst && prst !== "rect") box.prst = prst;
      const xfrm = findChild(spPr, "a:xfrm");
      if (custGeomNode) {
        const extAttrs = attrsOf(findChild(xfrm ?? {}, "a:ext") ?? {});
        const geom = parseCustGeom(
          serializeXNode(spPr),
          parseInt(extAttrs["cx"] ?? "", 10) || 0,
          parseInt(extAttrs["cy"] ?? "", 10) || 0
        );
        if (geom) box.pathData = geom;
      }
      const rot = parseInt(attrsOf(xfrm ?? {})["rot"] ?? "", 10);
      if (Number.isFinite(rot) && rot !== 0) box.rotDeg = Math.round(rot / 6e4);
      const ext = findChild(xfrm ?? {}, "a:ext");
      const cx = ext ? parseInt(attrsOf(ext)["cx"] ?? "", 10) : NaN;
      if (Number.isFinite(cx) && cx > 0) box.widthPx = Math.round(cx / EMU_PER_PX2);
      const bodyPrNode = findChild(shape, "wps:bodyPr");
      const autoFit = bodyPrNode ? !!findChild(bodyPrNode, "a:spAutoFit") : false;
      const cy = ext ? parseInt(attrsOf(ext)["cy"] ?? "", 10) : NaN;
      if (!autoFit && Number.isFinite(cy) && cy > 0) {
        box.heightPx = Math.round(cy / EMU_PER_PX2);
        box.minHeightPx = box.heightPx;
      }
    }
    const bodyPr = findChild(shape, "wps:bodyPr");
    if (bodyPr) {
      const attrs = attrsOf(bodyPr);
      const inset = (name) => {
        const emu = parseInt(attrs[name] ?? "", 10);
        return Number.isFinite(emu) && emu >= 0 ? Math.round(emu / EMU_PER_PX2 * 100) / 100 : void 0;
      };
      box.insetLeftPx = inset("lIns");
      box.insetTopPx = inset("tIns");
      box.insetRightPx = inset("rIns");
      box.insetBottomPx = inset("bIns");
      if (attrs["anchor"] === "b") box.vAlign = "bottom";
      else if (attrs["anchor"] === "ctr") box.vAlign = "center";
    }
    for (const content of contents)
      box.paras.push(...txbxContentParas(content, ctx, opts?.docOffset));
    if (contents.some(txbxHasStructuredContent)) box.readOnly = true;
    if (contents.length > topContents.length) box.readOnly = true;
    if (contents.length === 0) {
      if (!box.fill && !box.borderColor && !box.fillImageDataUrl) return null;
      if (!box.shapeId) box.readOnly = true;
      else if (!box.vAlign && !(bodyPr && attrsOf(bodyPr)["anchor"])) box.vAlign = "center";
      return box;
    }
    if (box.paras.some(txbxParaVisible)) return box;
    if (!box.fill && !box.borderColor && !box.fillImageDataUrl) return null;
    box.paras = [];
    return box;
  };
  const applyAnchor = (box, meta, pagePos, grouped = false) => {
    if (!meta.anchored) return;
    if (meta.behind) box.behind = true;
    if (meta.noWrap) box.noWrap = true;
    if (meta.z !== void 0) box.z = meta.z;
    if (meta.pageXEmu !== void 0) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + meta.pageXEmu;
      box.offsetYEmu = (box.offsetYEmu ?? 0) + (meta.pageYEmu ?? 0);
      box.floating = true;
      box.pagePinned = true;
      return;
    }
    const relXAbsolute = meta.relH === "page" || meta.relH === "margin";
    if (pagePos?.outsideColumn) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + pagePos.xEmu;
      box.offsetYEmu = (box.offsetYEmu ?? 0) + (pagePos.yEmu ?? meta.offsetYEmu ?? 0);
      box.floating = true;
      if (relXAbsolute) box.pageRelX = true;
      return;
    }
    if (meta.offsetXEmu !== void 0) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + meta.offsetXEmu;
      if (relXAbsolute) box.pageRelX = true;
    }
    if (pagePos !== null && !pagePos.outsideColumn && meta.offsetXEmu === void 0 && (meta.topBottom || meta.noWrap || multiDrawing)) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + pagePos.xEmu;
      if (relXAbsolute) box.pageRelX = true;
    }
    if (meta.offsetYEmu !== void 0) box.offsetYEmu = (box.offsetYEmu ?? 0) + meta.offsetYEmu;
    if ((meta.relV === "page" || meta.relV === "margin") && meta.offsetYEmu !== void 0 && !meta.alignV) {
      box.pageRelV = true;
      box.pageRelVFrom = meta.relV;
    }
    let ownSpansColumn = false;
    let squareSpansColumn = false;
    const sect = opts?.section;
    if (!meta.noWrap && !meta.topBottom && !grouped && sect && sect.columns <= 1) {
      const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP;
      const wEmu = box.widthPx !== void 0 ? box.widthPx * EMU_PER_PX2 : meta.extentXEmu;
      const xEmu = box.offsetXEmu ?? 0;
      ownSpansColumn = wEmu !== void 0 && wEmu > 0 && xEmu < MIN_WRAP_SLIVER_EMU && colWEmu - xEmu - wEmu < MIN_WRAP_SLIVER_EMU;
      squareSpansColumn = ownSpansColumn || multiDrawing && anchorUnionSpansColumn(sect);
    }
    if ((meta.topBottom || squareSpansColumn) && (meta.relV === "paragraph" || meta.relV === "line")) {
      const h = box.heightPx ?? (!grouped && meta.extentYEmu !== void 0 ? Math.round(meta.extentYEmu / EMU_PER_PX2) : void 0);
      if (h !== void 0) {
        const top = Math.round((box.offsetYEmu ?? 0) / EMU_PER_PX2);
        if (top + h > 0) {
          box.bandTopPx = top;
          box.bandBottomPx = top + h;
          if (ownSpansColumn && !meta.topBottom) box.bandOverflow = true;
        }
      }
      box.floating = true;
    }
    if (meta.noWrap || multiDrawing) box.floating = true;
    if (!meta.noWrap && !meta.topBottom) box.wrapSides = true;
    if (box.wrapSides && !box.floating && !grouped && sect && sect.columns <= 1 && meta.relV !== "page" && meta.relV !== "margin" && meta.alignH !== "center") {
      const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP;
      const wEmu = box.widthPx !== void 0 ? box.widthPx * EMU_PER_PX2 : meta.extentXEmu;
      if (wEmu !== void 0 && wEmu > 0) {
        const xEmu = meta.alignH === "right" ? colWEmu - wEmu : meta.alignH === "left" ? 0 : box.offsetXEmu ?? 0;
        const distL = meta.distLEmu ?? DEFAULT_WRAP_DIST_EMU;
        const distR = meta.distREmu ?? DEFAULT_WRAP_DIST_EMU;
        const leftGap = xEmu - distL;
        const rightGap = colWEmu - xEmu - wEmu - distR;
        const side = leftGap >= rightGap ? "right" : "left";
        if ((side === "right" ? leftGap : rightGap) >= MIN_WRAP_SLIVER_EMU) {
          box.wrapSide = side;
          box.wrapEdgePx = (side === "right" ? colWEmu - xEmu - wEmu : xEmu) / EMU_PER_PX2;
          box.wrapGapPx = (side === "right" ? distL : distR) / EMU_PER_PX2;
        }
      }
    }
  };
  let unionSpans;
  const anchorUnionSpansColumn = (sect) => {
    if (unionSpans !== void 0) return unionSpans;
    const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP;
    const iv = fragMetas.filter((m) => m.anchored && m.offsetXEmu !== void 0 && (m.extentXEmu ?? 0) > 0).map((m) => [m.offsetXEmu, m.offsetXEmu + m.extentXEmu]).sort((a, b) => a[0] - b[0]);
    let gap = 0;
    let cursor = 0;
    for (const [a, b] of iv) {
      gap = Math.max(gap, a - cursor);
      cursor = Math.max(cursor, b);
    }
    gap = Math.max(gap, colWEmu - cursor);
    unionSpans = iv.length > 0 && gap < MIN_WRAP_SLIVER_EMU;
    return unionSpans;
  };
  const pinnable = (m) => m.anchored === true && (m.noWrap === true || m.behind === true || multiDrawing) && m.relV === "page" && (m.relH === "page" || m.relH === "margin");
  const fragMetas = frags.map(drawingAnchorMeta);
  const anchoredMetas = fragMetas.filter((m) => m.anchored);
  const pinAll = opts?.firstPage === true && opts.section !== void 0 && anchoredMetas.length > 0 && anchoredMetas.every(pinnable);
  if (opts?.section) {
    for (const m of fragMetas) {
      if (pinAll && pinnable(m)) continue;
      if (m.relH === "page" && m.offsetXEmu !== void 0 && !m.alignH) {
        m.offsetXEmu -= opts.section.marginLeft * EMU_PER_TWIP;
      }
      if (m.relV === "page" && m.offsetYEmu !== void 0 && !m.alignV) {
        m.offsetYEmu -= opts.section.marginTop * EMU_PER_TWIP;
      }
    }
  }
  for (const [fragIndex, frag] of frags.entries()) {
    let parsedFrag;
    try {
      parsedFrag = xmlParser.parse(frag);
    } catch {
      continue;
    }
    const meta = fragMetas[fragIndex];
    if (pinAll && pinnable(meta) && opts?.section) {
      const marL = opts.section.marginLeft * EMU_PER_TWIP;
      const marT = opts.section.marginTop * EMU_PER_TWIP;
      const aligned = resolveAnchorPagePos(meta, opts.section);
      meta.pageXEmu = aligned !== null ? aligned.xEmu + marL : (meta.relH === "margin" ? marL : 0) + (meta.offsetXEmu ?? 0);
      meta.pageYEmu = aligned?.yEmu !== void 0 ? aligned.yEmu + marT : meta.offsetYEmu ?? 0;
    }
    const pagePos = meta.pageXEmu === void 0 ? resolveAnchorPagePos(meta, opts?.section) : null;
    let wspCount = 0;
    const extentCy = parseInt(/<wp:extent[^>]*cy="(\d+)"/.exec(frag)?.[1] ?? "", 10);
    const inlineExtentPx = !meta.anchored && extentCy > 0 ? emuToPx(extentCy) : 0;
    const pushShape = (shape, ctm, groupFill, nested) => {
      wspCount++;
      const box = buildWpsBox(shape, groupFill, nested, ctm !== null);
      if (!box) return;
      if (ctm) {
        const xfrm = findChild(findChild(shape, "wps:spPr") ?? {}, "a:xfrm");
        const off = attrsOf(findChild(xfrm ?? {}, "a:off") ?? {});
        const x = parseInt(off["x"] ?? "", 10);
        const y = parseInt(off["y"] ?? "", 10);
        if (Number.isFinite(x)) box.offsetXEmu = Math.round(ctm.tx + x * ctm.sx);
        if (Number.isFinite(y)) box.offsetYEmu = Math.round(ctm.ty + y * ctm.sy);
        if (ctm.sx !== 1 && box.widthPx) box.widthPx = Math.round(box.widthPx * ctm.sx);
        if (ctm.sy !== 1) {
          if (box.heightPx) box.heightPx = Math.round(box.heightPx * ctm.sy);
          if (box.minHeightPx) box.minHeightPx = Math.round(box.minHeightPx * ctm.sy);
        }
        box.floating = true;
        if (inlineExtentPx > 0) box.inlineExtentPx = inlineExtentPx;
      }
      applyAnchor(box, meta, pagePos, ctm !== null);
      out.push(box);
    };
    const pushPic = (node, ctm) => {
      const blip = findChild(findChild(node, "pic:blipFill") ?? {}, "a:blip");
      const blipAttrs = attrsOf(blip ?? {});
      const rId = blipAttrs["r:embed"] ?? blipAttrs["r:link"];
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : void 0;
      if (!dataUrl) return;
      const xfrm = findChild(findChild(node, "pic:spPr") ?? {}, "a:xfrm");
      const ext = attrsOf(findChild(xfrm ?? {}, "a:ext") ?? {});
      const cx = parseInt(ext["cx"] ?? "", 10);
      const cy = parseInt(ext["cy"] ?? "", 10);
      if (!(cx > 0) || !(cy > 0)) return;
      const rot = parseInt(attrsOf(xfrm ?? {})["rot"] ?? "", 10);
      const box = {
        paras: [],
        readOnly: true,
        fillImageDataUrl: dataUrl,
        widthPx: emuToPx(cx * (ctm?.sx ?? 1)),
        heightPx: emuToPx(cy * (ctm?.sy ?? 1)),
        insetTopPx: 0,
        insetRightPx: 0,
        insetBottomPx: 0,
        insetLeftPx: 0
      };
      if (Number.isFinite(rot) && rot !== 0) box.rotDeg = Math.round(rot / 6e4);
      if (ctm) {
        const off = attrsOf(findChild(xfrm ?? {}, "a:off") ?? {});
        const x = parseInt(off["x"] ?? "", 10);
        const y = parseInt(off["y"] ?? "", 10);
        if (Number.isFinite(x)) box.offsetXEmu = Math.round(ctm.tx + x * ctm.sx);
        if (Number.isFinite(y)) box.offsetYEmu = Math.round(ctm.ty + y * ctm.sy);
        box.floating = true;
        if (inlineExtentPx > 0) box.inlineExtentPx = inlineExtentPx;
      }
      applyAnchor(box, meta, pagePos, ctm !== null);
      out.push(box);
    };
    const walkShapes = (nodes, ctm, groupFill, nested = false) => {
      for (const node of nodes) {
        const name = nameOf(node);
        if (name === "wps:wsp") pushShape(node, ctm, groupFill, nested);
        if (name === "pic:pic" && opts?.pictures && ctm) pushPic(node, ctm);
        if (name === "wpg:wgp" || name === "wpg:grpSp") {
          const fill = colorNodeHex(
            findChild(findChild(node, "wpg:grpSpPr") ?? {}, "a:solidFill"),
            ctx.themeColors
          ) ?? groupFill;
          walkShapes(
            childrenOf(node),
            composeGroupCtm(node, ctm ?? IDENTITY_CTM) ?? ctm,
            fill,
            nested
          );
        } else {
          walkShapes(childrenOf(node), ctm, groupFill, nested || name === "wps:wsp");
        }
      }
    };
    walkShapes(parsedFrag, null);
    if (opts?.pictures && wspCount === 0 && frag.includes("<pic:pic") && (meta.anchored || !xml.includes("<wp:anchor"))) {
      const rId = /<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/.exec(frag)?.[1] ?? /<a:blip[^>]*r:link\s*=\s*["']([^"']+)["']/.exec(frag)?.[1];
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : void 0;
      const extentTag = /<wp:extent[^>]*\/?>/.exec(frag)?.[0] ?? "";
      const extCx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
      const extCy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
      if (dataUrl && Number.isFinite(extCx) && Number.isFinite(extCy)) {
        const box = {
          paras: [],
          readOnly: true,
          fillImageDataUrl: dataUrl,
          widthPx: emuToPx(extCx),
          heightPx: emuToPx(extCy),
          insetTopPx: 0,
          insetRightPx: 0,
          insetBottomPx: 0,
          insetLeftPx: 0
        };
        const picXfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>/.exec(frag)?.[1];
        const rot = parseInt(/\brot="(-?\d+)"/.exec(picXfrm ?? "")?.[1] ?? "", 10);
        if (Number.isFinite(rot) && rot !== 0) box.rotDeg = Math.round(rot / 6e4);
        applyAnchor(box, meta, pagePos);
        out.push(box);
      }
    }
  }
  let parsed = null;
  if (/<v:(?:shape|rect|roundrect|oval)\b/.test(xml)) {
    try {
      parsed = xmlParser.parse(xml);
    } catch {
      parsed = null;
    }
  }
  if (parsed) {
    const shapeTypes = [];
    collectNodes(parsed, "v:shapetype", shapeTypes);
    const vmlShapeTypeAttrs = (type) => {
      const id = type?.startsWith("#") ? type.slice(1) : void 0;
      const node = id ? shapeTypes.find((t) => attrsOf(t)["id"] === id) : void 0;
      return node ? attrsOf(node) : id && ctx.vmlShapeTypes?.get(id) || {};
    };
    const vmlShapeTypeLookup = {
      get: (id) => {
        const a = vmlShapeTypeAttrs(`#${id}`);
        return Object.keys(a).length > 0 ? a : void 0;
      }
    };
    const placeVmlBox = (box, style, scale, origin) => {
      if (!scale && /position:absolute/.test(style)) {
        box.floating = true;
        const mx = parseFloat(/margin-left:(-?[\d.]+)pt/.exec(style)?.[1] ?? "");
        const my = parseFloat(/margin-top:(-?[\d.]+)pt/.exec(style)?.[1] ?? "");
        if (Number.isFinite(mx)) box.offsetXEmu = Math.round(mx * EMU_PER_PT);
        if (Number.isFinite(my)) box.offsetYEmu = Math.round(my * EMU_PER_PT);
        if (opts?.section) applyVmlMsoPosition(box, style, opts.section);
      } else if (scale && origin) {
        box.floating = true;
        box.offsetXEmu = Math.round(vmlCoordPx(style, "left", scale, origin) * EMU_PER_PX2);
        box.offsetYEmu = Math.round(vmlCoordPx(style, "top", scale, origin) * EMU_PER_PX2);
      }
    };
    const vmlPicBox = (shape, scale, origin) => {
      const rId = attrsOf(findChild(shape, "v:imagedata") ?? {})["r:id"];
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : void 0;
      if (!dataUrl) return false;
      const style = attrsOf(shape)["style"] ?? "";
      const box = {
        paras: [],
        readOnly: true,
        fillImageDataUrl: dataUrl,
        insetTopPx: 0,
        insetRightPx: 0,
        insetBottomPx: 0,
        insetLeftPx: 0
      };
      const w = vmlShapeDimPx(style, "width", scale);
      if (w) box.widthPx = w;
      const h = vmlShapeDimPx(style, "height", scale);
      if (h) box.heightPx = h;
      placeVmlBox(box, style, scale, origin);
      out.push(box);
      return true;
    };
    const vmlGeomBox = (shape, scale, origin) => {
      const a = attrsOf(shape);
      const style = a["style"] ?? "";
      if (a["o:hr"] === "t" || /visibility:\s*hidden/.test(style)) return;
      if (a["o:spt"] === "75" || /_x0000_t75\b/.test(a["type"] ?? "")) return;
      const shapeXml = !scale && /position:\s*absolute/.test(style) ? serializeXNode(shape) : null;
      const svg = shapeXml && !isInvisibleVmlPict(shapeXml) ? vmlShapeSvg(shapeXml, vmlShapeTypeLookup) : null;
      if (svg) {
        const box2 = {
          paras: [],
          readOnly: true,
          fillImageDataUrl: svg.dataUrl,
          widthPx: svg.widthPx,
          heightPx: svg.heightPx,
          insetTopPx: 0,
          insetRightPx: 0,
          insetBottomPx: 0,
          insetLeftPx: 0
        };
        if (/z-index:\s*-/.test(style)) box2.behind = true;
        const rot = vmlRotationDeg(style);
        if (rot != null) box2.rotDeg = rot;
        placeVmlBox(box2, style, scale, origin);
        out.push(box2);
        return;
      }
      const fill = a["filled"] === "f" ? void 0 : vmlColorHex(a["fillcolor"]);
      const stroke = a["stroked"] === "f" ? void 0 : vmlColorHex(a["strokecolor"]) ?? (scale ? "000000" : void 0);
      if ((!fill || fill.toUpperCase() === "FFFFFF") && !stroke) return;
      const w = vmlShapeDimPx(style, "width", scale);
      const h = vmlShapeDimPx(style, "height", scale);
      if (!w || !h) return;
      const box = {
        paras: [],
        readOnly: true,
        widthPx: w,
        heightPx: h,
        minHeightPx: h,
        insetTopPx: 0,
        insetRightPx: 0,
        insetBottomPx: 0,
        insetLeftPx: 0
      };
      if (fill) box.fill = fill;
      if (stroke) box.borderColor = stroke;
      const name = nameOf(shape);
      if (name === "v:roundrect") box.prst = "roundRect";
      else if (name === "v:oval") box.prst = "ellipse";
      const path = a["path"];
      if (path) {
        const cs = /^\s*(\d+)[,\s]+(\d+)/.exec(a["coordsize"] ?? "");
        const d = cs ? vmlPathToNormD(path, parseInt(cs[1], 10), parseInt(cs[2], 10)) : void 0;
        if (!d) return;
        box.pathData = { path: d };
      }
      placeVmlBox(box, style, scale, origin);
      out.push(box);
    };
    const vmlBox = (shape, scale, origin, nested) => {
      const shapeAttrs = attrsOf(shape);
      const style = shapeAttrs["style"] ?? "";
      const contents = [];
      collectNodes(childrenOf(shape), "w:txbxContent", contents);
      if (contents.length === 0) {
        const wordArt = vmlWordArtBox(shape);
        if (wordArt) {
          out.push(wordArt);
          return;
        }
        if (nested) return;
        if (vmlPicBox(shape, scale, origin)) return;
        vmlGeomBox(shape, scale, origin);
        return;
      }
      const topContents = [];
      collectTopNodes(childrenOf(shape), "w:txbxContent", topContents);
      const box = { paras: [] };
      if (!nested) {
        box.txbxIndex = txbxOrdinal;
        txbxOrdinal += topContents.length;
      }
      if (nested || contents.length > topContents.length) box.readOnly = true;
      const w = vmlShapeDimPx(style, "width", scale);
      if (w) box.widthPx = w;
      const h = vmlShapeDimPx(style, "height", scale);
      const fitToText = /mso-fit-shape-to-text:\s*t/.test(
        attrsOf(findChild(shape, "v:textbox") ?? {})["style"] ?? ""
      );
      if (h && !fitToText) {
        box.heightPx = h;
        box.minHeightPx = h;
      }
      const typeAttrs = vmlShapeTypeAttrs(shapeAttrs["type"]);
      const inherited = (name) => shapeAttrs[name] ?? typeAttrs[name];
      const fill = vmlColorHex(inherited("fillcolor"));
      if (fill && !vmlFlagOff(inherited("filled"))) box.fill = fill;
      const shapeName = nameOf(shape);
      if (shapeName === "v:roundrect") box.prst = "roundRect";
      else if (shapeName === "v:oval") box.prst = "ellipse";
      if (!vmlFlagOff(inherited("stroked")) && !vmlStrokeChildOff(shape)) {
        box.borderColor = vmlColorHex(inherited("strokecolor")) ?? "000000";
        const weight = vmlStrokeWeightPx(inherited("strokeweight"));
        if (weight !== void 0) box.borderWidthPx = weight;
      }
      placeVmlBox(box, style, scale, origin);
      for (const content of contents)
        box.paras.push(...txbxContentParas(content, ctx, opts?.docOffset));
      if (contents.some(txbxHasStructuredContent)) box.readOnly = true;
      const inked = box.fill !== void 0 && box.fill.toUpperCase() !== "FFFFFF" || !!box.borderColor;
      if (box.paras.some(txbxParaVisible) || inked) out.push(box);
    };
    const walkVml = (nodes, scale, origin, nested = false) => {
      for (const node of nodes) {
        const name = nameOf(node);
        if (name === "v:group") {
          const gScale = vmlGroupScale(node, scale);
          const gAttrs = attrsOf(node);
          const gStyle = gAttrs["style"] ?? "";
          let gOrigin = null;
          if (gScale && scale && origin) {
            gOrigin = {
              x: vmlCoordPx(gStyle, "left", scale, origin),
              y: vmlCoordPx(gStyle, "top", scale, origin)
            };
          } else if (gScale && /position:absolute/.test(gStyle)) {
            const mx = parseFloat(/margin-left:(-?[\d.]+)pt/.exec(gStyle)?.[1] ?? "");
            const my = parseFloat(/margin-top:(-?[\d.]+)pt/.exec(gStyle)?.[1] ?? "");
            gOrigin = {
              x: Number.isFinite(mx) ? mx * 96 / 72 : 0,
              y: Number.isFinite(my) ? my * 96 / 72 : 0
            };
          } else if (gScale && !nested) {
            const w = vmlShapeDimPx(gStyle, "width", scale);
            const h = vmlShapeDimPx(gStyle, "height", scale);
            if (w && h) {
              out.push({
                paras: [],
                readOnly: true,
                widthPx: w,
                heightPx: h,
                minHeightPx: h,
                insetTopPx: 0,
                insetRightPx: 0,
                insetBottomPx: 0,
                insetLeftPx: 0
              });
              gOrigin = { x: 0, y: 0 };
            }
          }
          if (gScale && gOrigin) {
            const co = /^\s*(-?\d+)[,\s]+(-?\d+)/.exec(gAttrs["coordorigin"] ?? "");
            if (co) {
              gOrigin = {
                x: gOrigin.x - parseInt(co[1], 10) * gScale.sx,
                y: gOrigin.y - parseInt(co[2], 10) * gScale.sy
              };
            }
          }
          walkVml(childrenOf(node), gScale ?? scale, gScale ? gOrigin : null, nested);
          continue;
        }
        if (name === "v:shape" || name === "v:rect" || name === "v:roundrect" || name === "v:oval") {
          vmlBox(node, scale, origin, nested);
        }
        walkVml(childrenOf(node), scale, origin, nested || name === "w:txbxContent");
      }
    };
    walkVml(parsed, null, null);
  }
  if (hasCanvasText) {
    let parsedAll;
    try {
      parsedAll = xmlParser.parse(xml);
    } catch {
      return out;
    }
    const txSps = [];
    collectNodes(parsedAll, "a:txSp", txSps);
    for (const sp of txSps) {
      const body = findChild(sp, "a:txBody");
      if (!body) continue;
      const paras = [];
      for (const p of childrenOf(body)) {
        if (nameOf(p) !== "a:p") continue;
        const runs = [];
        for (const r of childrenOf(p)) {
          if (nameOf(r) !== "a:r") continue;
          const t = findChild(r, "a:t");
          const text = t ? decodeNumericCharRefs(textOf(t)) : "";
          if (text === "") continue;
          const run2 = { text };
          const rPr = findChild(r, "a:rPr");
          if (rPr) {
            const a = attrsOf(rPr);
            const sz = parseInt(a["sz"] ?? "", 10);
            if (Number.isFinite(sz) && sz > 0) run2.sizeHalfPoints = Math.round(sz / 50);
            if (a["b"] === "1") run2.bold = true;
            const latin = attrsOf(findChild(rPr, "a:latin") ?? {})["typeface"];
            if (latin && !latin.startsWith("+")) run2.font = latin;
          }
          runs.push(run2);
        }
        if (runs.length > 0) {
          const algn = attrsOf(findChild(p, "a:pPr") ?? {})["algn"];
          paras.push({
            runs,
            ...algn === "ctr" ? { align: "center" } : {}
          });
        }
      }
      if (paras.length > 0) out.push({ paras, readOnly: true });
    }
  }
  return out;
}
function inheritStyleBreakFlags(format, style) {
  const d = style?.display;
  let out = format;
  if (out?.autoSpace === void 0 && d?.autoSpace === false) out = { ...out, autoSpace: false };
  if (out?.wordWrap === void 0 && d?.wordWrap === false) out = { ...out, wordWrap: false };
  if (out?.overflowPunct === void 0 && d?.overflowPunct === false) {
    out = { ...out, overflowPunct: false };
  }
  if (out?.eastAsiaLang === void 0 && d?.eastAsiaLang) {
    out = { ...out, eastAsiaLang: d.eastAsiaLang };
  }
  return out;
}
function inheritStyleTabStops(format, style) {
  const styleStops = style?.display?.tabStops;
  if (!styleStops?.length) return format;
  const direct = format?.tabStops ?? [];
  const inherited = styleStops.filter((s) => s.val !== "clear" && !direct.some((d) => d.pos === s.pos)).map((s) => ({ ...s, inherited: true }));
  if (inherited.length === 0) return format;
  return { ...format ?? {}, tabStops: [...direct, ...inherited].sort((a, b) => a.pos - b.pos) };
}
function anchorLineOf(xml) {
  let parsed;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return void 0;
  }
  const pNode = parsed.find((n) => nameOf(n) === "w:p");
  if (!pNode) return void 0;
  const pPr = findChild(pNode, "w:pPr");
  const styleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
  let format = pPr ? extractParaFormat(pPr) : void 0;
  const sz = parseInt(
    (pPr && attrsOf(findChild(findChild(pPr, "w:rPr") ?? {}, "w:sz") ?? {})["w:val"]) ?? "",
    10
  );
  if (Number.isFinite(sz) && sz > 0) format = { ...format ?? {}, emptyRunSizeHalfPoints: sz };
  const clear = /<w:br\b[^>]*\bw:clear="(all|left|right)"/.exec(xml)?.[1];
  return {
    ...styleId ? { styleId } : {},
    ...format ? { format } : {},
    ...clear ? { clear } : {}
  };
}
function strayAnchorLine(xml, ctx) {
  const line = anchorLineOf(xml);
  const style = line?.styleId ? ctx.styles.get(line.styleId)?.display : void 0;
  if (!line || !style) return line;
  const format = { ...line.format ?? {} };
  const styleStops = style.tabStops ?? [];
  if (styleStops.length) {
    const direct = format.tabStops ?? [];
    format.tabStops = [
      ...styleStops.filter((t) => !direct.some((d) => d.pos === t.pos)),
      ...direct.filter((t) => t.val !== "clear")
    ];
  }
  if (format.indentLeft === void 0 && style.indentLeftTwips !== void 0)
    format.indentLeft = style.indentLeftTwips;
  return { ...line, format };
}
function frameBoxOf(pPr) {
  const framePr = findChild(pPr, "w:framePr");
  if (!framePr) return void 0;
  const a = attrsOf(framePr);
  if (a["w:dropCap"]) return void 0;
  const twips = (name) => {
    const v = parseInt(a[name] ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : void 0;
  };
  const out = {};
  const w = twips("w:w");
  const h = twips("w:h");
  if (w) out.wTwips = w;
  if (h) {
    out.hTwips = h;
    if (a["w:hRule"] === "exact") out.hRule = "exact";
  }
  if (!w && !h) return void 0;
  const hSpace = twips("w:hSpace");
  const vSpace = twips("w:vSpace");
  if (hSpace) out.hSpaceTwips = hSpace;
  if (vSpace) out.vSpaceTwips = vSpace;
  if (a["w:vAnchor"] === "text" && /^(around|auto|through|tight)$/.test(a["w:wrap"] ?? "")) {
    out.floatSide = a["w:xAlign"] === "right" || a["w:xAlign"] === "outside" ? "right" : "left";
  }
  return out;
}
function extractParaFormat(pPr, theme, styleBidi) {
  const format = {};
  const bidiOwn = onOffOf(pPr, "w:bidi");
  if (bidiOwn) format.bidi = true;
  const jc = attrsOf(findChild(pPr, "w:jc") ?? {})["w:val"];
  if (jc && JC_ALIGN[jc]) format.align = JC_ALIGN[jc];
  if ((bidiOwn ?? styleBidi) && (format.align === "left" || format.align === "right")) {
    format.align = format.align === "left" ? "right" : "left";
  }
  const spacing = findChild(pPr, "w:spacing");
  if (spacing) {
    const attrs = attrsOf(spacing);
    const rule = attrs["w:lineRule"] ?? "auto";
    const line = lineTwipsOf(attrs["w:line"]);
    if (line > 0) {
      format.lineRawTwips = line;
      if (rule === "auto") {
        format.lineSpacing = Math.round(line / 240 * 100) / 100;
        format.lineRule = "auto";
      } else {
        format.lineRule = rule;
      }
    } else if (line === 0 && rule === "atLeast") {
      format.lineRule = "atLeast";
      format.lineRawTwips = 0;
    }
    const autoOf = (v) => v === void 0 ? void 0 : v === "1" || v === "true";
    const autoBefore = autoOf(attrs["w:beforeAutospacing"]);
    if (autoBefore !== void 0) format.spaceBeforeAuto = autoBefore;
    const autoAfter = autoOf(attrs["w:afterAutospacing"]);
    if (autoAfter !== void 0) format.spaceAfterAuto = autoAfter;
    const before = parseInt(attrs["w:before"] ?? "", 10);
    if (before >= 0 && attrs["w:before"] !== void 0) format.spaceBefore = before;
    const after = parseInt(attrs["w:after"] ?? "", 10);
    if (after >= 0 && attrs["w:after"] !== void 0) format.spaceAfter = after;
  }
  const ind = findChild(pPr, "w:ind");
  if (ind) {
    const { left, right, firstLine } = indentTwipsOf(ind);
    if (left !== void 0) format.indentLeft = left;
    if (right !== void 0) format.indentRight = right;
    if (firstLine !== void 0) format.indentFirstLine = firstLine;
  }
  {
    const pbb = onOffOf(pPr, "w:pageBreakBefore");
    if (pbb !== void 0) format.pageBreakBefore = pbb;
    const kn = onOffOf(pPr, "w:keepNext");
    if (kn !== void 0) format.keepNext = kn;
    const kl = onOffOf(pPr, "w:keepLines");
    if (kl !== void 0) format.keepLines = kl;
    const sln = onOffOf(pPr, "w:suppressLineNumbers");
    if (sln !== void 0) format.suppressLineNumbers = sln;
  }
  const snapEl = findChild(pPr, "w:snapToGrid");
  if (snapEl) {
    const v = attrsOf(snapEl)["w:val"];
    if (v === "0" || v === "false") format.snapToGrid = false;
  }
  const wc = onOffOf(pPr, "w:widowControl");
  if (wc !== void 0) format.widowControl = wc;
  {
    const ctx = onOffOf(pPr, "w:contextualSpacing");
    if (ctx !== void 0) format.contextualSpacing = ctx;
  }
  const autoSpace = autoSpaceOf(pPr);
  if (autoSpace !== void 0) format.autoSpace = autoSpace;
  const wordWrap = onOffOf(pPr, "w:wordWrap");
  if (wordWrap !== void 0) format.wordWrap = wordWrap;
  const overflowPunct = onOffOf(pPr, "w:overflowPunct");
  if (overflowPunct !== void 0) format.overflowPunct = overflowPunct;
  const shd = findChild(pPr, "w:shd");
  if (shd) {
    const fill = attrsOf(shd)["w:fill"];
    if (fill && fill !== "auto") format.shadingFill = stripHash(fill);
    const display = shdDisplayFill(shd, theme);
    if (display && display !== format.shadingFill) format.shadingDisplay = display;
    if (!display) format.shadingClear = true;
  }
  const sides = paraBorderSidesOf(pPr);
  if (sides) Object.assign(format, paraBordersOf(sides));
  const stops = tabStopsOf(pPr);
  if (stops) format.tabStops = stops;
  const frameBox = frameBoxOf(pPr);
  if (frameBox) format.frameBox = frameBox;
  const framePr = findChild(pPr, "w:framePr");
  if (framePr) {
    const dropCapVal = attrsOf(framePr)["w:dropCap"];
    if (dropCapVal === "drop" || dropCapVal === "margin") {
      const lines = parseInt(attrsOf(framePr)["w:lines"] ?? "3", 10) || 3;
      format.dropCap = { type: dropCapVal, lines };
    } else {
      const frame = paraFrameOf(attrsOf(framePr));
      if (frame) format.frame = frame;
    }
  }
  const flow = attrsOf(findChild(pPr, "w:textDirection") ?? {})["w:val"];
  if (flow === "tbRl" || flow === "tbRlV" || flow === "btLr") format.textDirection = flow;
  return Object.keys(format).length > 0 ? format : void 0;
}
function paraFrameOf(a) {
  const num2 = (k) => {
    const n = parseInt(a[k] ?? "", 10);
    return Number.isFinite(n) ? n : void 0;
  };
  const w = num2("w:w");
  if (!w || w <= 0) return void 0;
  const frame = { wTwips: w, xTwips: num2("w:x") ?? 0, yTwips: num2("w:y") ?? 0 };
  const h = num2("w:h");
  if (h && h > 0) {
    frame.hTwips = h;
    frame.hRule = a["w:hRule"] === "exact" ? "exact" : "atLeast";
  }
  const hAnchor = a["w:hAnchor"];
  if (hAnchor === "margin" || hAnchor === "text") frame.hAnchor = hAnchor;
  const vAnchor = a["w:vAnchor"];
  if (vAnchor === "margin" || vAnchor === "text") frame.vAnchor = vAnchor;
  const wrap = a["w:wrap"];
  if (wrap === "around" || wrap === "through" || wrap === "notBeside" || wrap === "auto" || wrap === "tight")
    frame.wrap = wrap;
  const hSpace = num2("w:hSpace");
  if (hSpace) frame.hSpaceTwips = hSpace;
  const vSpace = num2("w:vSpace");
  if (vSpace) frame.vSpaceTwips = vSpace;
  const xAlign = a["w:xAlign"];
  if (xAlign === "left" || xAlign === "center" || xAlign === "right" || xAlign === "inside" || xAlign === "outside")
    frame.xAlign = xAlign;
  const yAlign = a["w:yAlign"];
  if (yAlign === "top" || yAlign === "center" || yAlign === "bottom" || yAlign === "inside" || yAlign === "outside" || yAlign === "inline")
    frame.yAlign = yAlign;
  if (a["w:anchorLock"] === "1" || a["w:anchorLock"] === "true") frame.anchorLock = true;
  return frame;
}
var PARA_XML_RE = /^<w:p(?:\s[^>]*)?>([\s\S]*)<\/w:p>$/;
function foldFieldCodeParagraphs(blocks, ctx) {
  const paraInner = (block) => {
    if (block.type !== "passthrough" || block.sdtShell || block.hidden) return null;
    return PARA_XML_RE.exec(block.originalXml ?? "")?.[1] ?? null;
  };
  for (let i = 0; i < blocks.length; i++) {
    const headInner = paraInner(blocks[i]);
    if (headInner === null) continue;
    let stack = fieldStackAfter(stripTextboxes(headInner), []);
    if (!markInsideFieldCode(stack)) continue;
    let end = i;
    while (markInsideFieldCode(stack) && end + 1 < blocks.length) {
      const inner = paraInner(blocks[end + 1]);
      if (inner === null) break;
      end++;
      stack = fieldStackAfter(stripTextboxes(inner), stack);
    }
    if (markInsideFieldCode(stack)) continue;
    const tail = blocks[end];
    const body = blocks.slice(i, end + 1).map((b) => paraInner(b).replace(/^<w:pPr>[\s\S]*?<\/w:pPr>/, "")).join("");
    const pPr = /^<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paraInner(tail))?.[0] ?? "";
    const joined = `<w:p>${pPr}${body}</w:p>`;
    const fieldDisplay = fieldDisplayOf(joined, ctx.styles);
    if (fieldDisplay?.kind === "text") {
      const runs = fieldResultRuns(joined, ctx, fieldDisplay.left ?? "");
      if (runs) fieldDisplay.runs = runs;
    }
    tail.fieldDisplay = fieldDisplay;
    tail.previewText = plainText(joined);
    tail.label = fieldLabel(joined);
    for (let k = i; k < end; k++) {
      blocks[k].invisibleMarker = true;
      delete blocks[k].fieldDisplay;
    }
    i = end;
  }
}
var XE_INSTR_RE = /^\s*XE\s+(?:"([^"]*)"|(\S+))/;
var REF_INSTR_RE = /^\s*REF\s+(?:"([^"]+)"|([^\s\\]+))/;
var RESULT_FORMAT_SKIP = /* @__PURE__ */ new Set([
  "text",
  "image",
  "math",
  "sym",
  "ruby",
  "noteRef",
  "xeTerm",
  "refField",
  "refInstr",
  "instrField",
  "fldBeginXml",
  "fldDirty",
  "sdtCheckboxXml",
  "commentIds",
  "ins",
  "del",
  "link"
]);
function fieldResultRuns(xml, ctx, visible) {
  let parsed;
  try {
    parsed = xmlParser.parse(stripTextboxes(xml));
  } catch {
    return null;
  }
  const pNode = parsed.find((n) => nameOf(n) === "w:p");
  if (!pNode) return null;
  const runs = [];
  for (const r of extractRuns(pNode, ctx)) {
    if (r.text === "" || r.vanish) continue;
    const run2 = { text: r.text };
    if (r.bold !== void 0) run2.bold = r.bold;
    if (r.italic !== void 0) run2.italic = r.italic;
    if (r.underline) run2.underline = true;
    if (r.color) run2.color = r.color;
    if (r.sizeHalfPoints) run2.sizeHalfPoints = r.sizeHalfPoints;
    if (r.font) run2.font = r.font;
    if (r.fontAscii) run2.fontAscii = r.fontAscii;
    if (r.csFont) run2.csFont = r.csFont;
    if (r.link) run2.link = r.link;
    if (r.styleId) run2.styleId = r.styleId;
    if (r.math) run2.math = r.math;
    runs.push(run2);
  }
  while (runs.length > 0) {
    const first = runs[0];
    first.text = first.text.replace(/^\s+/, "");
    if (first.text !== "") break;
    runs.shift();
  }
  while (runs.length > 0) {
    const last = runs[runs.length - 1];
    last.text = last.text.replace(/\s+$/, "");
    if (last.text !== "") break;
    runs.pop();
  }
  if (runs.length === 0 || runs.map((r) => r.text).join("") !== visible) return null;
  return runs;
}
function extractRuns(pNode, ctx, mathFragments = [], rubyFragments = [], withImages = false, zoteroField) {
  const runs = [];
  let mathIndex = 0;
  let rubyIndex = 0;
  const pStyleId = attrsOf(findChild(findChild(pNode, "w:pPr") ?? {}, "w:pStyle") ?? {})["w:val"];
  const paraRtl = pStyleId ? ctx.styles?.get(pStyleId)?.display?.rtl : void 0;
  const paraBdr = pStyleId ? ctx.styles?.get(pStyleId)?.display?.bdr : void 0;
  const paraVanish = pStyleId ? ctx.styles?.get(pStyleId)?.display?.vanish : defaultParaVanish(ctx.styles);
  const starts = /* @__PURE__ */ new Set();
  const ends = /* @__PURE__ */ new Set();
  const collectRangeIds = (nodes) => {
    for (const node of nodes) {
      const name = nameOf(node);
      if (name === "w:commentRangeStart" || name === "w:commentRangeEnd") {
        const id = attrsOf(node)["w:id"];
        if (id) (name === "w:commentRangeStart" ? starts : ends).add(id);
      }
      collectRangeIds(childrenOf(node));
    }
  };
  collectRangeIds(childrenOf(pNode));
  const complete = new Set([...starts].filter((id) => ends.has(id)));
  const activeComments = /* @__PURE__ */ new Set();
  let fieldDepth = zoteroField && zoteroField.part !== "begin" ? 1 : 0;
  let fieldInstr = zoteroField?.instruction ?? "";
  let fieldSeparated = zoteroField !== void 0 && zoteroField.part !== "begin";
  let fieldCached = "";
  let fieldCachedRuns = [];
  let fieldBeginRun = null;
  let fieldDirty = false;
  const eqField = (instr) => /^\s*EQ\b/i.test(instr) ? eqFieldToOmml(instr) : null;
  const resultFormat = () => {
    let src = fieldCachedRuns[0];
    if (!src && fieldBeginRun) {
      const rPr = findChild(fieldBeginRun, "w:rPr");
      src = buildRun(
        { "w:r": [...rPr ? [rPr] : [], { "w:t": [{ "#text": "x" }] }] },
        void 0,
        ctx.themeColors,
        ctx.themeFonts,
        void 0,
        ctx.styles,
        paraRtl,
        ctx.xmlSpacePreserve,
        paraVanish,
        paraBdr
      );
    }
    if (!src) return {};
    return Object.fromEntries(Object.entries(src).filter(([k]) => !RESULT_FORMAT_SKIP.has(k)));
  };
  let pendingRefIds = [];
  const addCommentIds = (run2, ids) => {
    run2.commentIds = [.../* @__PURE__ */ new Set([...run2.commentIds ?? [], ...ids])].sort();
  };
  const pushRun = (run2, rev) => {
    if (activeComments.size > 0) run2.commentIds = [...activeComments].sort();
    if (pendingRefIds.length > 0) {
      addCommentIds(run2, pendingRefIds);
      pendingRefIds = [];
    }
    if (rev?.ins) run2.ins = rev.ins;
    if (rev?.del) run2.del = rev.del;
    runs.push(run2);
  };
  const pushZoteroCachedRuns = (part, rev) => {
    const cachedRuns = fieldCachedRuns.length > 0 ? fieldCachedRuns : [{ text: fieldCached || " " }];
    const id = zoteroField?.id ?? ctx.nextZoteroFieldId ?? 1;
    if (!zoteroField) ctx.nextZoteroFieldId = id + 1;
    cachedRuns.forEach((cached, index) => {
      let runPart = part;
      if (part === "single" && cachedRuns.length > 1) {
        runPart = index === 0 ? "begin" : index === cachedRuns.length - 1 ? "end" : "inside";
      } else if (part === "begin" && index > 0) runPart = "inside";
      else if (part === "end" && index < cachedRuns.length - 1) runPart = "inside";
      pushRun(
        {
          ...cached,
          instrField: (zoteroField?.instruction ?? fieldInstr).trim(),
          zoteroFieldId: id,
          zoteroFieldPart: runPart
        },
        rev
      );
    });
  };
  const handleRun = (node, link, rev) => {
    const fldChar = findChild(node, "w:fldChar");
    if (fldChar) {
      const type = attrsOf(fldChar)["w:fldCharType"];
      if (type === "begin") {
        fieldDepth++;
        if (fieldDepth === 1) {
          fieldInstr = "";
          fieldSeparated = false;
          fieldCached = "";
          fieldCachedRuns = [];
          fieldBeginRun = node;
          fieldDirty = /^(?:true|1)$/.test(String(attrsOf(fldChar)["w:dirty"] ?? ""));
        }
      } else if (type === "separate") {
        if (fieldDepth === 1) fieldSeparated = true;
      } else if (type === "end") {
        fieldDepth = Math.max(0, fieldDepth - 1);
        if (fieldDepth === 0) {
          const xe = XE_INSTR_RE.exec(fieldInstr);
          const ref = REF_INSTR_RE.exec(fieldInstr);
          const hyper = convertibleHyperlink(fieldInstr);
          if (xe) pushRun({ text: "", xeTerm: xe[1] ?? xe[2] }, rev);
          else if (ref) {
            const name = ref[1] ?? ref[2];
            pushRun(
              {
                text: fieldCached || name,
                refField: name,
                refInstr: fieldInstr,
                ...fieldDirty ? { fldDirty: true } : {}
              },
              rev
            );
          } else if (hyper) {
            const linkVal = {
              href: hyper.href,
              ...hyper.tooltip ? { tooltip: hyper.tooltip } : {}
            };
            if (fieldCachedRuns.length > 0) {
              for (const cached of fieldCachedRuns) pushRun({ ...cached, link: linkVal }, rev);
            } else pushRun({ text: hyper.href, link: linkVal }, rev);
          } else if (/^\s*FORMCHECKBOX\s*$/.test(fieldInstr)) {
            const state = checkboxStateOf(fieldBeginRun);
            if (state) {
              const glyph = state.checked ? "\u2612" : "\u2610";
              const rPr = findChild(fieldBeginRun, "w:rPr");
              const glyphRun = buildRun(
                { "w:r": [...rPr ? [rPr] : [], { "w:t": [{ "#text": glyph }] }] },
                link,
                ctx.themeColors,
                ctx.themeFonts,
                void 0,
                ctx.styles,
                paraRtl,
                ctx.xmlSpacePreserve,
                paraVanish,
                paraBdr
              );
              pushRun(
                {
                  ...glyphRun ?? { text: glyph },
                  instrField: "FORMCHECKBOX",
                  fldBeginXml: serializeXNode(fieldBeginRun)
                },
                rev
              );
            }
          } else if (ZOTERO_INLINE_FIELD_RE.test(fieldInstr)) {
            if (zoteroField) pushZoteroCachedRuns(zoteroField.part, rev);
            else pushZoteroCachedRuns("single", rev);
          } else if (SIMPLE_INLINE_FIELD_RE.test(fieldInstr)) {
            pushRun(
              {
                ...resultFormat(),
                text: fieldCached || " ",
                instrField: fieldInstr.trim(),
                ...fieldDirty ? { fldDirty: true } : {},
                ...link ? { link } : {}
              },
              rev
            );
          } else if (eqField(fieldInstr)) {
            const eq = eqField(fieldInstr);
            pushRun({ ...resultFormat(), text: eq.text, math: { omml: eq.omml } }, rev);
          } else if (fieldCachedRuns.length > 0) {
            for (const cached of fieldCachedRuns) pushRun(cached, rev);
          }
          fieldInstr = "";
          fieldSeparated = false;
          fieldCached = "";
          fieldCachedRuns = [];
          fieldBeginRun = null;
        }
      }
      return;
    }
    if (fieldDepth > 0) {
      if (findChild(node, "w:ruby")) rubyIndex++;
      const instr = findChild(node, "w:instrText");
      if (instr) fieldInstr += textOf(instr);
      else if (fieldSeparated && fieldDepth === 1) {
        const cached = buildRun(
          node,
          link,
          ctx.themeColors,
          ctx.themeFonts,
          void 0,
          ctx.styles,
          paraRtl,
          ctx.xmlSpacePreserve,
          paraVanish,
          paraBdr
        );
        if (cached) {
          fieldCached += cached.text;
          fieldCachedRuns.push(cached);
        }
      }
      return;
    }
    const rubyNode = findChild(node, "w:ruby");
    if (rubyNode) {
      const xml = rubyFragments[rubyIndex++];
      const base = rubyPartText(rubyNode, "w:rubyBase");
      const rt = rubyPartText(rubyNode, "w:rt");
      if (base) pushRun(xml ? { text: base, ruby: { rt, xml } } : { text: base }, rev);
      return;
    }
    const noteRefNode = findChild(node, "w:footnoteReference") ?? findChild(node, "w:endnoteReference");
    if (noteRefNode) {
      const kind = nameOf(noteRefNode) === "w:footnoteReference" ? "footnote" : "endnote";
      const id = attrsOf(noteRefNode)["w:id"];
      if (id) {
        const num2 = ctx.noteNumbers.get(`${kind}:${id}`);
        pushRun({ text: String(num2 ?? "*"), noteRef: { kind, id } }, rev);
        return;
      }
    }
    const commentRef = findChild(node, "w:commentReference");
    if (commentRef) {
      const id = attrsOf(commentRef)["w:id"];
      if (id && ctx.referenceOnlyComments?.has(id)) {
        const prev = runs[runs.length - 1];
        if (prev) addCommentIds(prev, [id]);
        else pendingRefIds.push(id);
      }
    }
    const nodes = (withImages && childrenOf(node).filter((c) => IMAGE_RUN_CHILDREN.has(nameOf(c) ?? "")).length > 1 ? splitImageRun(node) : [node]).flatMap(splitSymRun);
    for (const part of nodes) {
      const run2 = buildRun(
        part,
        link,
        ctx.themeColors,
        ctx.themeFonts,
        // a part without pictures has no media map, but its VML rules
        // (image runs without media) must still be modelled
        withImages ? ctx.mediaByRid ?? NO_MEDIA : void 0,
        ctx.styles,
        paraRtl,
        ctx.xmlSpacePreserve,
        paraVanish,
        paraBdr,
        ctx.vmlShapeTypes
      );
      if (run2) pushRun(run2, rev);
    }
  };
  const foldSimpleField = (node, link, rev) => {
    const instr = decodeNumericCharRefs(String(attrsOf(node)["w:instr"] ?? ""));
    const xe = XE_INSTR_RE.exec(instr);
    const ref = REF_INSTR_RE.exec(instr);
    if (!xe && !ref && !SIMPLE_INLINE_FIELD_RE.test(instr)) {
      walk(childrenOf(node), link, rev);
      return;
    }
    const first = runs.length;
    walk(childrenOf(node), link, rev);
    const cached = runs.splice(first);
    const text = cached.map((r) => r.text).join("");
    const format = cached[0] ? Object.fromEntries(Object.entries(cached[0]).filter(([k]) => !RESULT_FORMAT_SKIP.has(k))) : {};
    const dirty = /^(?:true|1)$/.test(String(attrsOf(node)["w:dirty"] ?? ""));
    if (xe) pushRun({ text: "", xeTerm: xe[1] ?? xe[2] }, rev);
    else if (ref) {
      const name = ref[1] ?? ref[2];
      pushRun(
        {
          ...format,
          text: text || name,
          refField: name,
          refInstr: ` ${instr.trim()} `,
          ...dirty ? { fldDirty: true } : {},
          ...link ? { link } : {}
        },
        rev
      );
    } else {
      pushRun(
        {
          ...format,
          text: text || " ",
          instrField: instr.trim(),
          ...dirty ? { fldDirty: true } : {},
          ...link ? { link } : {}
        },
        rev
      );
    }
  };
  const walk = (nodes, link, rev) => {
    for (const node of nodes) {
      const name = nameOf(node);
      if (name === "w:commentRangeStart" || name === "w:commentRangeEnd") {
        const id = attrsOf(node)["w:id"];
        if (id && complete.has(id)) {
          if (name === "w:commentRangeStart") activeComments.add(id);
          else activeComments.delete(id);
        }
      } else if (name === "w:ins" || name === "w:del") {
        const attrs = attrsOf(node);
        const info = { author: attrs["w:author"] ?? "" };
        if (attrs["w:date"]) info.date = attrs["w:date"];
        if (attrs["w:id"]) info.id = attrs["w:id"];
        const next = name === "w:ins" ? { ...rev, ins: info } : { ...rev, del: info };
        walk(childrenOf(node), link, next);
      } else if (name === "w:moveFrom" || name === "w:moveTo") {
        const attrs = attrsOf(node);
        const info = { author: attrs["w:author"] ?? "" };
        if (attrs["w:date"]) info.date = attrs["w:date"];
        if (attrs["w:id"]) info.id = attrs["w:id"];
        const next = name === "w:moveFrom" ? { ...rev, del: info } : { ...rev, ins: info };
        walk(childrenOf(node), link, next);
      } else if (name === "w:r") {
        handleRun(node, link, rev);
      } else if (name === "m:oMath") {
        const omml = mathFragments[mathIndex++];
        if (omml) pushRun({ text: mathTokens(omml).join(""), math: { omml } }, rev);
      } else if (name === "w:hyperlink") {
        const attrs = attrsOf(node);
        const rId = attrs["r:id"];
        const anchor = attrs["w:anchor"];
        const tooltip = attrs["w:tooltip"];
        const href = rId ? `${ctx.rels.get(rId)?.target ?? ""}${anchor ? `#${anchor}` : ""}` : anchor ? `#${anchor}` : "";
        const first = runs.length;
        walk(childrenOf(node), { href, rId, ...tooltip ? { tooltip } : {} }, rev);
        if (!rId && anchor) {
          for (const run2 of runs.slice(first)) {
            if (run2.link && !run2.styleId) run2.link = { ...run2.link, plain: true };
          }
        }
      } else if (name === "w:sdt" && sdtCheckboxControl(node)) {
        const control = sdtCheckboxControl(node);
        const first = runs.length;
        walk(childrenOf(node), link, rev);
        const base = runs.slice(first).find((r) => r.text.trim() !== "") ?? runs[first];
        runs.length = first;
        pushRun({ ...base ?? {}, text: control.glyph, sdtCheckboxXml: control.sdtPrXml }, rev);
      } else if (name === "w:smartTag" || name === "w:sdt" || name === "w:sdtContent" || name === "w:dir" || name === "w:bdo") {
        walk(childrenOf(node), link, rev);
      } else if (name === "w:fldSimple") {
        if (fieldDepth === 0) foldSimpleField(node, link, rev);
        else if (fieldSeparated) walk(childrenOf(node), link, rev);
      } else if (name === "w:br") {
        pushRun({ text: breakCharOf(attrsOf(node)) }, rev);
      }
    }
  };
  walk(childrenOf(pNode));
  if (zoteroField && fieldDepth > 0 && zoteroField.part !== "end") {
    pushZoteroCachedRuns(zoteroField.part);
  } else if (fieldDepth > 0 && fieldSeparated) {
    for (const cached of fieldCachedRuns) pushRun(cached);
  }
  return mergeRuns(runs);
}
function wtText(raw, preserve) {
  const text = raw.replace(/\r\n?|\n/g, " ");
  return preserve ? text : text.replace(/^[ \t]+|[ \t]+$/g, "").replace(/\t/g, " ");
}
var NO_MEDIA = /* @__PURE__ */ new Map();
var TEXT_EFFECTS = ["outline", "emboss", "imprint", "shadow"];
function buildRun(rNode, link, theme, themeFonts, mediaByRid, styles, paraRtl, partPreserve, paraVanish, paraBdr, vmlShapeTypes) {
  let text = "";
  let sym;
  for (const child of childrenOf(rNode)) {
    const name = nameOf(child);
    if (name === "w:t" || name === "w:delText") {
      const own = attrsOf(child)["xml:space"];
      text += wtText(
        decodeNumericCharRefs(textOf(child)),
        own === "preserve" || own === void 0 && partPreserve === true
      );
    } else if (name === "w:tab" || name === "w:ptab") text += "	";
    else if (name === "w:br") text += breakCharOf(attrsOf(child));
    else if (name === "w:cr") text += "\n";
    else if (name === "w:noBreakHyphen") text += "\u2011";
    else if (name === "w:softHyphen") text += "\xAD";
    else if (name === "w:sym") {
      const a = attrsOf(child);
      const glyph = symbolGlyph(a["w:font"] ?? "", a["w:char"] ?? "");
      if (glyph !== null) {
        text += glyph;
        sym = sym === void 0 ? { font: a["w:font"] ?? "", char: a["w:char"], glyph } : null;
      }
    }
  }
  let image;
  if (mediaByRid) {
    const choice = findChild(findChild(rNode, "mc:AlternateContent") ?? {}, "mc:Choice");
    const drawing = findChild(rNode, "w:drawing") ?? (choice && findChild(choice, "w:drawing"));
    if (drawing) {
      const drawingXml = serializeXNode(drawing);
      const rId = /<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']/.exec(drawingXml)?.[1];
      const dataUrl = rId ? mediaByRid.get(rId) : void 0;
      if (dataUrl) {
        image = { dataUrl, xml: drawingXml };
        const extentTag = /<wp:extent[^>]*\/?>/.exec(drawingXml)?.[0] ?? "";
        const cx = Number(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? NaN);
        const cy = Number(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? NaN);
        if (cx > 0) image.widthPx = emuToPx(cx);
        if (cy > 0) image.heightPx = emuToPx(cy);
        const border = picBorderOf(drawingXml);
        if (border) image.border = border;
        const xf = picTransformOf(drawingXml);
        if (xf.rotDeg !== void 0) image.rotDeg = xf.rotDeg;
        if (xf.flipH) image.flipH = true;
        if (xf.flipV) image.flipV = true;
        if (/<wp:anchor[\s>]/.test(drawingXml)) {
          const meta = imageMeta(drawingXml);
          if (meta.imageWrap) image.wrap = meta.imageWrap;
          if (meta.imageOffsetXEmu !== void 0) image.offsetXEmu = meta.imageOffsetXEmu;
          if (meta.imageOffsetYEmu !== void 0) image.offsetYEmu = meta.imageOffsetYEmu;
          if (meta.imageRelV) image.relV = meta.imageRelV;
          if (meta.imageWrapDistTopEmu !== void 0)
            image.wrapDistTopEmu = meta.imageWrapDistTopEmu;
          if (meta.imageWrapDistBottomEmu !== void 0)
            image.wrapDistBottomEmu = meta.imageWrapDistBottomEmu;
          if (meta.imageWrapDistLeftEmu !== void 0)
            image.wrapDistLeftEmu = meta.imageWrapDistLeftEmu;
          if (meta.imageWrapDistRightEmu !== void 0)
            image.wrapDistRightEmu = meta.imageWrapDistRightEmu;
          if (/<wp:positionV[^>]*relativeFrom\s*=\s*["']line["'][^>]*>\s*<wp:align>center<\/wp:align>/.test(
            drawingXml
          ))
            image.lineCenterV = true;
          if (meta.imageNoOverlap) image.noOverlap = true;
        }
      }
    }
    if (!image) {
      const picts = [
        findChild(rNode, "w:pict"),
        findChild(rNode, "w:object"),
        ...choice ? [findChild(choice, "w:pict"), findChild(choice, "w:object")] : []
      ].filter((n) => n !== void 0);
      for (const pict of picts) {
        const pictXml = serializeXNode(pict);
        const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(pictXml)?.[1];
        const dataUrl = rId ? mediaByRid.get(rId) : void 0;
        if (dataUrl) {
          image = { dataUrl, xml: pictXml };
          const style = /<v:shape [^>]*style="([^"]*)"/.exec(pictXml)?.[1] ?? "";
          const w = parseFloat(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1] ?? "");
          const h = parseFloat(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1] ?? "");
          const objAttrs = /<w:object\b[^>]*>/.exec(pictXml)?.[0] ?? "";
          const wTw = parseInt(/w:dxaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? "", 10);
          const hTw = parseInt(/w:dyaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? "", 10);
          if (w > 0) image.widthPx = Math.round(w / 72 * 96);
          else if (wTw > 0) image.widthPx = Math.round(wTw / 15);
          if (h > 0) image.heightPx = Math.round(h / 72 * 96);
          else if (hTw > 0) image.heightPx = Math.round(hTw / 15);
          break;
        }
        const hrRect = /<v:rect\b[^>]*\bo:hr="t"[^>]*>/.exec(pictXml)?.[0];
        if (hrRect) {
          image = { dataUrl: "", xml: pictXml, rule: vmlHrRule(hrRect) };
          break;
        }
        if (nameOf(pict) === "w:pict" && !/position:\s*absolute/.test(pictXml)) {
          const shape = vmlShapeSvg(pictXml, vmlShapeTypes);
          if (shape) {
            image = {
              dataUrl: shape.dataUrl,
              xml: pictXml,
              widthPx: shape.widthPx,
              heightPx: shape.heightPx
            };
            const rot = vmlRotationDeg(shape.style);
            if (rot != null) image.rotDeg = rot;
            break;
          }
        }
      }
    }
  }
  if (text === "" && !image) return null;
  const rPr = findChild(rNode, "w:rPr");
  const run2 = { text };
  if (sym && text === sym.glyph) run2.sym = { font: sym.font, char: sym.char };
  if (image) run2.image = image;
  if (link) run2.link = link;
  if (!rPr && paraRtl) run2.cs = true;
  if (!rPr && paraVanish) run2.vanish = true;
  if (!rPr && paraBdr) run2.bdr = paraBdr;
  if (rPr) {
    run2.rawRPr = serializeXNode(rPr);
    const rStyle = attrsOf(findChild(rPr, "w:rStyle") ?? {})["w:val"];
    if (rStyle) run2.styleId = rStyle;
    const vanishOwn = onOffOf(rPr, "w:specVanish") === true ? void 0 : onOffOf(rPr, "w:vanish");
    const vanish = vanishOwn ?? (rStyle ? styles?.get(rStyle)?.display?.vanish : void 0) ?? paraVanish;
    if (vanish === true) run2.vanish = true;
    if (vanishOwn !== void 0) run2.vanishOwn = vanishOwn;
    const eaLang = attrsOf(findChild(rPr, "w:lang") ?? {})["w:eastAsia"] ?? (rStyle ? styles?.get(rStyle)?.display?.eastAsiaLang : void 0);
    if (eaLang) run2.eastAsiaLang = eaLang;
    const inheritedRtl = (rStyle ? styles?.get(rStyle)?.display?.rtl : void 0) ?? paraRtl;
    const cs = (onOffOf(rPr, "w:rtl") ?? inheritedRtl) === true;
    if (cs) run2.cs = true;
    const bold = onOffOf(rPr, cs ? "w:bCs" : "w:b");
    if (bold !== void 0) run2.bold = bold;
    const italic = onOffOf(rPr, cs ? "w:iCs" : "w:i");
    if (italic !== void 0) run2.italic = italic;
    if (underlineProp(rPr)) run2.underline = true;
    else if (attrsOf(findChild(rPr, "w:u") ?? {})["w:val"] === "none") run2.underline = false;
    const strike = onOffOf(rPr, "w:strike");
    if (strike !== void 0) run2.strike = strike;
    const color = colorFrom(rPr, theme) ?? w14TextFillHex(rPr, theme) ?? autoColorOf(rPr);
    if (color) run2.color = color;
    if (color && theme && attrsOf(findChild(rPr, "w:color") ?? {})["w:themeColor"]) {
      run2.themeColor = color;
    }
    const sz = parseInt(attrsOf(findChild(rPr, cs ? "w:szCs" : "w:sz") ?? {})["w:val"] ?? "", 10);
    if (Number.isFinite(sz)) run2.sizeHalfPoints = Math.max(1, sz);
    const rfAttrs = attrsOf(findChild(rPr, "w:rFonts") ?? {});
    const rf = themedRFonts(rfAttrs, themeFonts);
    const font = rf.eastAsia ?? rf.ascii ?? rf.hAnsi;
    if (font) run2.font = font;
    if (rf.eastAsia) run2.eastAsiaFont = rf.eastAsia;
    if (rf.eaSlotEmpty && font && font === rf.eastAsia) run2.eaSlotEmpty = true;
    const fontAscii = rf.ascii ?? rf.hAnsi;
    if (fontAscii) run2.fontAscii = fontAscii;
    const fontThemed = rf.eastAsia !== void 0 ? rf.themed?.eastAsia : rf.ascii !== void 0 ? rf.themed?.ascii : rf.themed?.hAnsi;
    const fontAsciiThemed = rf.ascii !== void 0 ? rf.themed?.ascii : rf.themed?.hAnsi;
    if (fontThemed && font || fontAsciiThemed && fontAscii) {
      run2.themeRFonts = {
        ...fontThemed && font ? { font } : {},
        ...fontAsciiThemed && fontAscii ? { fontAscii } : {}
      };
    }
    if (rfAttrs["w:cs"]) run2.fontCs = rfAttrs["w:cs"];
    if (rf.cs) run2.csFont = rf.cs;
    const rtl = onOffOf(rPr, "w:rtl");
    if (rtl !== void 0) run2.rtl = rtl;
    const spc = parseInt(attrsOf(findChild(rPr, "w:spacing") ?? {})["w:val"] ?? "", 10);
    if (!Number.isNaN(spc)) run2.charSpacingTwips = spc;
    const kern = attrsOf(findChild(rPr, "w:kern") ?? {})["w:val"];
    if (kern !== void 0) run2.kernHalfPoints = parseInt(kern, 10) || 0;
    const capsOn = onOffOf(rPr, "w:caps");
    const smallCapsOn = onOffOf(rPr, "w:smallCaps");
    if (capsOn) run2.caps = "all";
    else if (smallCapsOn) run2.caps = "small";
    else if (capsOn === false || smallCapsOn === false) run2.caps = "none";
    const wScale = parseInt(attrsOf(findChild(rPr, "w:w") ?? {})["w:val"] ?? "", 10);
    if (wScale > 0 && wScale !== 100) run2.charScalePct = wScale;
    const highlight = attrsOf(findChild(rPr, "w:highlight") ?? {})["w:val"];
    if (highlight && highlight !== "none") run2.highlight = highlight;
    const shdNode = findChild(rPr, "w:shd");
    const shdFill = attrsOf(shdNode ?? {})["w:fill"];
    if (shdFill && shdFill !== "auto") run2.shading = stripHash(shdFill);
    const shdDisplay = shdDisplayFill(shdNode, theme);
    if (shdDisplay && shdDisplay !== run2.shading) run2.shadingDisplay = shdDisplay;
    const outline = w14TextOutlineOf(rPr, theme);
    if (outline) run2.textOutline = outline;
    const effect = TEXT_EFFECTS.find((e) => onOffOf(rPr, `w:${e}`));
    if (effect) run2.textEffect = effect;
    const dstrike = onOffOf(rPr, "w:dstrike");
    if (dstrike !== void 0) run2.dstrike = dstrike;
    const glow = w14GlowOf(rPr, theme);
    if (glow) run2.glow = glow;
    const position = parseInt(attrsOf(findChild(rPr, "w:position") ?? {})["w:val"] ?? "", 10);
    if (position) run2.positionHalfPoints = position;
    const bdrNode = findChild(rPr, "w:bdr");
    const bdr = bdrNode ? runBorderOf(bdrNode) : (rStyle ? styles?.get(rStyle)?.display?.bdr : void 0) ?? paraBdr;
    if (bdr) run2.bdr = bdr;
    const vertAlign = attrsOf(findChild(rPr, "w:vertAlign") ?? {})["w:val"];
    if (vertAlign === "superscript" || vertAlign === "subscript") run2.vertAlign = vertAlign;
    const em = attrsOf(findChild(rPr, "w:em") ?? {})["w:val"];
    if (em && em !== "none") run2.em = em;
    const rPrChange = findChild(rPr, "w:rPrChange");
    if (rPrChange) {
      const a = attrsOf(rPrChange);
      const oldRPr = findChild(rPrChange, "w:rPr");
      const old = {};
      if (oldRPr) {
        const ocs = (onOffOf(oldRPr, "w:rtl") ?? inheritedRtl) === true;
        if (boolProp(oldRPr, ocs ? "w:bCs" : "w:b")) old.bold = true;
        if (boolProp(oldRPr, ocs ? "w:iCs" : "w:i")) old.italic = true;
        if (underlineProp(oldRPr)) old.underline = true;
        if (boolProp(oldRPr, "w:strike")) old.strike = true;
        const oc = colorFrom(oldRPr, theme);
        if (oc) old.color = oc;
        const osz = attrsOf(findChild(oldRPr, ocs ? "w:szCs" : "w:sz") ?? {})["w:val"];
        if (osz) old.sizeHalfPoints = parseInt(osz, 10) || void 0;
        const ofonts = attrsOf(findChild(oldRPr, "w:rFonts") ?? {});
        const of = ofonts["w:eastAsia"] ?? ofonts["w:ascii"] ?? ofonts["w:hAnsi"];
        if (of) old.font = of;
        const ofa = ofonts["w:ascii"] ?? ofonts["w:hAnsi"];
        if (ofa) old.fontAscii = ofa;
        const ospc = parseInt(attrsOf(findChild(oldRPr, "w:spacing") ?? {})["w:val"] ?? "", 10);
        if (ospc) old.charSpacingTwips = ospc;
        const owScale = parseInt(attrsOf(findChild(oldRPr, "w:w") ?? {})["w:val"] ?? "", 10);
        if (owScale > 0 && owScale !== 100) old.charScalePct = owScale;
        const ohighlight = attrsOf(findChild(oldRPr, "w:highlight") ?? {})["w:val"];
        if (ohighlight && ohighlight !== "none") old.highlight = ohighlight;
        const overtAlign = attrsOf(findChild(oldRPr, "w:vertAlign") ?? {})["w:val"];
        if (overtAlign === "superscript" || overtAlign === "subscript") old.vertAlign = overtAlign;
        const ostyle = attrsOf(findChild(oldRPr, "w:rStyle") ?? {})["w:val"];
        if (ostyle) old.styleId = ostyle;
      }
      run2.rPrChange = {
        author: a["w:author"] ?? "",
        ...a["w:date"] ? { date: a["w:date"] } : {},
        ...a["w:id"] ? { id: a["w:id"] } : {},
        ...Object.keys(old).length > 0 ? { old } : {}
      };
    }
  }
  const symFont = run2.fontAscii ?? run2.font;
  if (symFont && !run2.sym) {
    const decoded = decodeSymbolText(symFont, run2.text, { textGlyphsOnly: true });
    if (decoded !== null) {
      run2.text = decoded;
      delete run2.font;
      delete run2.fontAscii;
      delete run2.fontCs;
      if (run2.rawRPr) run2.rawRPr = run2.rawRPr.replace(/<w:rFonts[^>]*\/>/, "");
    }
  }
  return run2;
}
function tableSummary(xml) {
  const rows = (xml.match(/<w:tr[\s>]/g) ?? []).length;
  const firstRow = /<w:tr[\s>][\s\S]*?<\/w:tr>/.exec(xml)?.[0] ?? "";
  const cols = (firstRow.match(/<w:tc[\s>]/g) ?? []).length;
  return { label: `Table ${rows}\xD7${cols}`, previewText: plainText(xml).slice(0, 120) };
}
function extractTable(xml, ctx, docOffset) {
  try {
    const parsed = deepXmlParser.parse(xml);
    const tbl = parsed.find((n) => nameOf(n) === "w:tbl");
    if (!tbl) return void 0;
    const model = extractTableModel(tbl, ctx, 1, docOffset);
    if (!model) return void 0;
    const rawTrPrs = model.rows.map(() => null);
    attachRawTablePr(xml, model.rows, rawTrPrs);
    if (rawTrPrs.some((r) => r !== null)) model.rawTrPrs = rawTrPrs;
    return model;
  } catch {
    return void 0;
  }
}
function tcwColumnWidths(tbl) {
  const cols = [];
  let colCount = 0;
  for (const tr of childrenThroughSdt(tbl, "w:tr")) {
    const edges = rowGridEdges(tr);
    let idx = edges.before;
    for (const tc of childrenThroughSdt(tr, "w:tc")) {
      const tcPr = findChild(tc, "w:tcPr");
      const span = Math.max(
        1,
        Number(attrsOf(findChild(tcPr ?? {}, "w:gridSpan") ?? {})["w:val"]) || 1
      );
      const a = attrsOf(findChildren(tcPr ?? {}, "w:tcW").at(-1) ?? {});
      const w = !a["w:type"] || a["w:type"] === "dxa" ? Number(a["w:w"]) || 0 : 0;
      if (span === 1 && w > 0) cols[idx] = Math.max(cols[idx] || 0, w);
      idx += span;
    }
    colCount = Math.max(colCount, idx + edges.after);
  }
  if (colCount === 0) return void 0;
  for (let i = 0; i < colCount; i++) if (!(cols[i] > 0)) return void 0;
  return cols.slice(0, colCount);
}
function rowGridEdges(tr) {
  const trPr = findChild(tr, "w:trPr");
  if (!trPr) return { before: 0, after: 0 };
  const count = (name) => {
    const v = Number(attrsOf(findChild(trPr, name) ?? {})["w:val"]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  };
  const width = (name) => {
    const a = attrsOf(findChild(trPr, name) ?? {});
    const w = !a["w:type"] || a["w:type"] === "dxa" ? Number(a["w:w"]) : NaN;
    return w > 0 ? w : void 0;
  };
  return {
    before: count("w:gridBefore"),
    after: count("w:gridAfter"),
    wBefore: width("w:wBefore"),
    wAfter: width("w:wAfter")
  };
}
var GRID_SNAP_TOL = 20;
function reconcileGridColumns(rows, rowTcws, gridCols) {
  const spanSums = rows.map((row) => row.reduce((sum, c) => sum + (c.colSpan ?? 1), 0));
  let widestSpan = 0;
  for (const sum of spanSums) {
    if (sum > widestSpan) widestSpan = sum;
  }
  const colCount = gridCols?.length ?? widestSpan;
  if (spanSums.every((sum) => sum === colCount)) return void 0;
  const rowBounds = [];
  for (let r = 0; r < rows.length; r++) {
    const bounds = [];
    let x = 0;
    let pos = 0;
    for (let c = 0; c < rows[r].length; c++) {
      const span = rows[r][c].colSpan ?? 1;
      let w = rowTcws[r][c];
      if (!(w !== void 0 && w > 0)) {
        w = gridCols?.slice(pos, pos + span).reduce((sum, v) => sum + v, 0);
      }
      if (!(w !== void 0 && w > 0)) return void 0;
      x += w;
      bounds.push(x);
      pos += span;
    }
    rowBounds.push(bounds);
  }
  const sorted = rowBounds.flat().sort((a, b) => a - b);
  const reps = [];
  for (const b of sorted) {
    if (reps.length === 0 || b - reps[reps.length - 1] > GRID_SNAP_TOL) reps.push(b);
  }
  if (reps.length === 0 || reps.length > 96) return void 0;
  const repIndex = (b) => {
    let lo = 0;
    let hi = reps.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (reps[mid] <= b) lo = mid;
      else hi = mid - 1;
    }
    return reps[lo] <= b && b - reps[lo] <= GRID_SNAP_TOL ? lo : -1;
  };
  const newSpans = [];
  for (const bounds of rowBounds) {
    const spans = [];
    let prev = -1;
    for (const b of bounds) {
      const idx = repIndex(b);
      if (idx <= prev) return void 0;
      spans.push(idx - prev);
      prev = idx;
    }
    newSpans.push(spans);
  }
  rows.forEach(
    (row, r) => row.forEach((cell, c) => {
      if (newSpans[r][c] > 1) cell.colSpan = newSpans[r][c];
      else delete cell.colSpan;
    })
  );
  return reps.map((v, i) => v - (i > 0 ? reps[i - 1] : 0));
}
var MAX_TABLE_NEST_DEPTH = 8;
function flattenedTableModel(tbl) {
  const paras = [];
  const PARA_END = {};
  let buf = null;
  const stack = [tbl];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === PARA_END) {
      paras.push(buf ?? "");
      buf = null;
      continue;
    }
    if ("#text" in node) {
      if (buf !== null) buf += String(node["#text"]);
      continue;
    }
    if (buf === null && nameOf(node) === "w:p") {
      buf = "";
      stack.push(PARA_END);
    }
    const kids = childrenOf(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  if (paras.length === 0) return void 0;
  const cell = {
    paras,
    richParas: paras.map((text) => ({ runs: text === "" ? [] : [{ text }] }))
  };
  return { rows: [[cell]], autoLayout: true };
}
function usableTableWidths(sect, tblIndTwips, hangTwips = 0) {
  const text = sect.pageWidth - sect.marginLeft - sect.marginRight;
  const perColumn = sect.columns > 1 ? sect.colWidths?.length === sect.columns ? sect.colWidths : [(text - (sect.colSpace ?? 720) * (sect.columns - 1)) / sect.columns] : [];
  const indent = Number.isFinite(tblIndTwips) ? tblIndTwips : 0;
  const bases = [text, ...perColumn];
  const spans = [...bases, ...bases.map((w) => w - indent)];
  if (hangTwips > 0) spans.push(...spans.map((w) => w + hangTwips));
  return [...new Set(spans)].filter((w) => w > 0);
}
var DEFAULT_TABLE_CELL_MAR = 108;
function isUniformGrid(widths) {
  if (!widths) return true;
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.every((w) => Math.abs(w * widths.length - total) <= Math.max(2, total * 0.01));
}
function extractTableModel(tbl, ctx, depth = 1, docOffset) {
  const grid = findChild(tbl, "w:tblGrid");
  let colWidthsPct;
  let colWidthsTwips;
  let gridWidthsRaw;
  if (grid) {
    const widths = findChildren(grid, "w:gridCol").map((c) => Number(attrsOf(c)["w:w"]) || 0);
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > 0) {
      gridWidthsRaw = widths;
      colWidthsPct = widths.map((w) => w / total * 100);
      if (widths.every((w) => w > 0)) colWidthsTwips = widths;
    }
  }
  const tblPrNode = findChild(tbl, "w:tblPr");
  const fixedLayout = attrsOf(findChild(tblPrNode ?? {}, "w:tblLayout") ?? {})["w:type"] === "fixed";
  const tblWNode = findChild(tblPrNode ?? {}, "w:tblW");
  const tblW = attrsOf(tblWNode ?? {});
  const tblInd = attrsOf(findChild(tblPrNode ?? {}, "w:tblInd") ?? {});
  const tblIndTwips = !tblInd["w:type"] || tblInd["w:type"] === "dxa" ? Number(tblInd["w:w"]) : NaN;
  const cellMar = cellMarginsOf(findChild(tblPrNode ?? {}, "w:tblCellMar"));
  const styleIdEarly = attrsOf(findChild(tblPrNode ?? {}, "w:tblStyle") ?? {})["w:val"];
  const styleTable = styleIdEarly ? ctx.styles.get(styleIdEarly)?.tableDisplay : void 0;
  const effCellMar = cellMar ?? styleTable?.cellMarTwips;
  const legacyHang = (ctx.compatibilityMode ?? 0) < 15 ? (effCellMar?.left ?? DEFAULT_TABLE_CELL_MAR) + (effCellMar?.right ?? DEFAULT_TABLE_CELL_MAR) : 0;
  const spacingOf = (node) => {
    const a = attrsOf(findChild(node ?? {}, "w:tblCellSpacing") ?? {});
    const w = !a["w:type"] || a["w:type"] === "dxa" ? Number(a["w:w"]) : NaN;
    return w > 0 ? w : void 0;
  };
  const firstTr = childrenThroughSdt(tbl, "w:tr")[0];
  const tblSpacing = spacingOf(tblPrNode) ?? (firstTr ? spacingOf(findChild(firstTr, "w:trPr")) : void 0);
  const uniformGrid = isUniformGrid(colWidthsTwips);
  const tcwWidths = tcwColumnWidths(tbl);
  let tcwWins = false;
  if (tcwWidths) {
    const tcwTotal = tcwWidths.reduce((a, b) => a + b, 0);
    const tcwPct = tcwWidths.map((w) => w / tcwTotal * 100);
    const gridTotal = (colWidthsTwips ?? []).reduce((a, b) => a + b, 0);
    const tblWAuto = tblW["w:type"] === "auto" || (!tblW["w:type"] || tblW["w:type"] === "dxa") && !(Number(tblW["w:w"]) > 0);
    const sect = docOffset !== void 0 ? ctx.sectionAt?.(docOffset) : void 0;
    const gridIsShrunkLayout = (sect ? usableTableWidths(sect, tblIndTwips, legacyHang) : []).some(
      (usable) => tcwTotal > usable + tcwWidths.length && Math.abs(gridTotal - usable) <= usable * 0.03
    );
    const gridExcess = gridTotal - tcwTotal;
    const spacingRoom = tblSpacing ? 3 * tblSpacing * tcwWidths.length : 0;
    const disagree = !colWidthsPct || colWidthsPct.length !== tcwPct.length || (fixedLayout || uniformGrid) && colWidthsPct.some((w, i) => Math.abs(w - tcwPct[i]) > 2) || (fixedLayout || tblWAuto && !gridIsShrunkLayout) && (gridExcess < -tcwWidths.length || gridExcess > tcwWidths.length + spacingRoom);
    if (disagree) {
      colWidthsPct = tcwPct;
      colWidthsTwips = tcwWidths;
      tcwWins = true;
    }
  }
  let widthPct;
  if (tblW["w:type"] === "pct") {
    const raw = String(tblW["w:w"] ?? "");
    const pct = raw.endsWith("%") ? parseFloat(raw) : Number(raw) / 50;
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) widthPct = pct;
  }
  if (!fixedLayout && colWidthsTwips) {
    const tblWDxa = !tblW["w:type"] || tblW["w:type"] === "dxa" ? Number(tblW["w:w"]) : NaN;
    const gridTotal = colWidthsTwips.reduce((a, b) => a + b, 0);
    if (tblWDxa > 0 && gridTotal > 0 && gridTotal < tblWDxa - colWidthsTwips.length) {
      const scale = tblWDxa / gridTotal;
      colWidthsTwips = colWidthsTwips.map((w) => Math.round(w * scale));
    }
  }
  const tblBorders = mergedBorderLinesOf(tblPrNode, "w:tblBorders", true);
  const tblJc = attrsOf(findChild(tblPrNode ?? {}, "w:jc") ?? {})["w:val"];
  const tblAlign = tblJc === "center" ? "center" : tblJc === "right" || tblJc === "end" ? "right" : void 0;
  const tblpPr = attrsOf(findChild(tblPrNode ?? {}, "w:tblpPr") ?? {});
  let floatSide;
  let floatPos;
  if (Object.keys(tblpPr).length > 0) {
    const xSpec = tblpPr["w:tblpXSpec"];
    floatSide = xSpec === "right" || xSpec === "outside" || !xSpec && Number(tblpPr["w:tblpX"]) > 4680 ? "right" : "left";
    const x = Number(tblpPr["w:tblpX"]);
    const y = Number(tblpPr["w:tblpY"]);
    const distanceTwips = {};
    const distanceAttrs = {
      top: "w:topFromText",
      right: "w:rightFromText",
      bottom: "w:bottomFromText",
      left: "w:leftFromText"
    };
    for (const [side, attr] of Object.entries(distanceAttrs)) {
      const value = Number(tblpPr[attr]);
      if (Number.isFinite(value) && value >= 0) distanceTwips[side] = value;
    }
    const horzAnchor = tblpPr["w:horzAnchor"];
    const ySpec = tblpPr["w:tblpYSpec"];
    const xSpecOk = xSpec === "left" || xSpec === "center" || xSpec === "right" || xSpec === "inside" || xSpec === "outside";
    const ySpecOk = ySpec === "top" || ySpec === "center" || ySpec === "bottom" || ySpec === "inside" || ySpec === "outside";
    const vertAnchor = tblpPr["w:vertAnchor"] ?? (ySpecOk ? "margin" : void 0);
    floatPos = {
      xTwips: Number.isFinite(x) ? x : floatSide === "right" ? 9360 : 0,
      yTwips: Number.isFinite(y) ? y : 0,
      ...horzAnchor === "page" || horzAnchor === "margin" || horzAnchor === "text" ? { horzAnchor } : {},
      ...vertAnchor === "page" || vertAnchor === "margin" || vertAnchor === "text" ? { vertAnchor } : {},
      ...xSpecOk ? { xSpec } : {},
      ...ySpecOk ? { ySpec } : {},
      ...Object.keys(distanceTwips).length > 0 ? { distanceTwips } : {}
    };
  }
  let cellSpacing = tblSpacing;
  const tblFill = shdDisplayFill(findChild(tblPrNode ?? {}, "w:shd"));
  const rows = [];
  const rowTcws = [];
  const rowEdges = [];
  const rowHeightsTwips = [];
  const rowHeightRules = [];
  const repeatHeaderRows = [];
  const rowCantSplit = [];
  const rowRevisions = [];
  for (const tr of childrenThroughSdt(tbl, "w:tr")) {
    const cells = [];
    const tcws = [];
    for (const tc of childrenThroughSdt(tr, "w:tc")) {
      const cell = extractCell(tc, ctx, depth, docOffset);
      const a = attrsOf(findChildren(findChild(tc, "w:tcPr") ?? {}, "w:tcW").at(-1) ?? {});
      const rawW = !a["w:type"] || a["w:type"] === "dxa" ? Number(a["w:w"]) : NaN;
      const tcw = rawW > 0 ? rawW : void 0;
      const prev = cells[cells.length - 1];
      if (cell.hMerge === "continue" && prev) {
        prev.colSpan = (prev.colSpan ?? 1) + (cell.colSpan ?? 1);
        const prevW = tcws[tcws.length - 1];
        tcws[tcws.length - 1] = prevW !== void 0 && tcw !== void 0 ? prevW + tcw : void 0;
        continue;
      }
      cells.push(cell);
      tcws.push(tcw);
    }
    if (cells.length > 0) {
      rows.push(cells);
      rowTcws.push(tcws);
      rowEdges.push(rowGridEdges(tr));
      const trPr = findChild(tr, "w:trPr");
      cellSpacing = cellSpacing ?? spacingOf(trPr);
      const trH = trPr ? attrsOf(findChild(trPr, "w:trHeight") ?? {}) : {};
      const h = Number(trH["w:val"]);
      const hasH = Number.isFinite(h) && h > 0;
      rowHeightsTwips.push(hasH ? Math.min(h, 31680) : null);
      rowHeightRules.push(hasH ? trH["w:hRule"] === "exact" ? "exact" : "atLeast" : null);
      repeatHeaderRows.push(trPr ? boolProp(trPr, "w:tblHeader") : false);
      rowCantSplit.push(trPr ? boolProp(trPr, "w:cantSplit") : false);
      rowRevisions.push(trPr ? rowRevisionOf(trPr) : null);
    }
  }
  if (rows.length === 0) return void 0;
  applyTableStyleDisplay(rows, findChild(tbl, "w:tblPr"), ctx);
  if (rowEdges.some((e) => e.before > 0 || e.after > 0)) {
    rows.forEach((cells, i) => {
      const e = rowEdges[i];
      if (e.before > 0) {
        cells.unshift({ paras: [], gridGap: true, ...e.before > 1 ? { colSpan: e.before } : {} });
        rowTcws[i].unshift(e.wBefore);
      }
      if (e.after > 0) {
        cells.push({ paras: [], gridGap: true, ...e.after > 1 ? { colSpan: e.after } : {} });
        rowTcws[i].push(e.wAfter);
      }
    });
  }
  const reconciled = reconcileGridColumns(rows, rowTcws, gridWidthsRaw);
  if (reconciled) {
    colWidthsTwips = reconciled;
    const total = reconciled.reduce((a, b) => a + b, 0);
    colWidthsPct = reconciled.map((w) => w / total * 100);
  }
  const effBorders = tblBorders ?? styleTable?.borders;
  const model = { rows, colWidthsPct };
  if (colWidthsTwips) model.colWidthsTwips = colWidthsTwips;
  if (widthPct) model.widthPct = widthPct;
  const tblWType = tblW["w:type"];
  const autoWidth = !tblWNode || tblWType === "auto" || (!tblWType || tblWType === "dxa") && !(Number(tblW["w:w"]) > 0);
  if (!fixedLayout && (autoWidth || widthPct)) model.autoLayout = true;
  if (!fixedLayout && !widthPct && colWidthsTwips && !tcwWins && !uniformGrid)
    model.layoutGrid = true;
  model.autoFit = fixedLayout || !autoWidth && !widthPct ? "fixed" : widthPct === 100 ? "window" : "contents";
  if (fixedLayout) model.fixedLayout = true;
  if (effCellMar) model.cellMarTwips = effCellMar;
  if (cellSpacing) model.cellSpacingTwips = cellSpacing;
  if (tblFill) model.fill = tblFill;
  if (effBorders) model.borders = effBorders;
  if (tblAlign) model.align = tblAlign;
  if (floatSide) model.floatSide = floatSide;
  if (floatPos) model.floatPos = floatPos;
  if (Number.isFinite(tblIndTwips) && tblIndTwips !== 0) model.indentTwips = tblIndTwips;
  const tblStyle = attrsOf(findChild(findChild(tbl, "w:tblPr") ?? {}, "w:tblStyle") ?? {})["w:val"];
  if (tblStyle) model.tblStyleId = tblStyle;
  model.tableLook = tableLookOf(tblPrNode);
  if (tblPrNode && boolProp(tblPrNode, "w:bidiVisual")) model.bidiVisual = true;
  if (rowHeightsTwips.some((h) => h !== null)) {
    model.rowHeightsTwips = rowHeightsTwips;
    model.rowHeightRules = rowHeightRules;
  }
  model.repeatHeaderRows = repeatHeaderRows;
  if (rowCantSplit.some(Boolean)) model.rowCantSplit = rowCantSplit;
  if (rowRevisions.some((r) => r !== null)) model.rowRevisions = rowRevisions;
  const caption = attrsOf(findChild(tblPrNode ?? {}, "w:tblCaption") ?? {})["w:val"];
  if (caption) model.caption = caption;
  const description = attrsOf(findChild(tblPrNode ?? {}, "w:tblDescription") ?? {})["w:val"];
  if (description) model.description = description;
  return model;
}
function rowRevisionOf(trPr) {
  for (const kind of ["ins", "del"]) {
    const node = findChild(trPr, `w:${kind}`);
    if (!node) continue;
    const a = attrsOf(node);
    return {
      kind,
      author: a["w:author"] ?? "",
      ...a["w:date"] ? { date: a["w:date"] } : {},
      ...a["w:id"] ? { id: a["w:id"] } : {}
    };
  }
  return null;
}
function attachRawTablePr(xml, rows, rawTrPrs) {
  const open = /<w:tbl[\s>]/.exec(xml);
  if (!open) return;
  const innerStart = xml.indexOf(">", open.index) + 1;
  const innerEnd = xml.lastIndexOf("</w:tbl>");
  if (innerStart <= 0 || innerEnd < 0) return;
  const trs = splitXmlChildren(xml.slice(innerStart, innerEnd)).filter((c) => c.name === "w:tr");
  if (trs.length !== rows.length) return;
  trs.forEach((tr, ri) => {
    const trOpenEnd = tr.xml.indexOf(">") + 1;
    const trInner = tr.xml.slice(trOpenEnd, tr.xml.lastIndexOf("</w:tr>"));
    const kids = splitXmlChildren(trInner);
    const trPr = kids.find((k) => k.name === "w:trPr");
    if (trPr) rawTrPrs[ri] = trPr.xml;
    const tcs = kids.filter((k) => k.name === "w:tc");
    const targets = rows[ri].filter((cell) => !cell.gridGap);
    if (tcs.length !== targets.length) return;
    tcs.forEach((tc, ci) => {
      const tcOpenEnd = tc.xml.indexOf(">") + 1;
      const tcInner = tc.xml.slice(tcOpenEnd, tc.xml.lastIndexOf("</w:tc>"));
      const tcPr = splitXmlChildren(tcInner).find((k) => k.name === "w:tcPr");
      if (tcPr) targets[ci].rawTcPr = tcPr.xml;
    });
  });
}
function applyTableStyleDisplay(rows, tblPr, ctx) {
  if (!tblPr) return;
  const styleId = attrsOf(findChild(tblPr, "w:tblStyle") ?? {})["w:val"];
  const ts = styleId ? ctx.styles.get(styleId)?.tableDisplay : void 0;
  if (!ts) return;
  const look = attrsOf(findChild(tblPr, "w:tblLook") ?? {});
  const bits = parseInt(look["w:val"] ?? "", 16);
  const flag = (attr, bit, dflt) => look[attr] !== void 0 ? look[attr] !== "0" && look[attr] !== "false" : Number.isFinite(bits) ? (bits & bit) !== 0 : dflt;
  const firstRowOn = flag("w:firstRow", 32, true);
  const lastRowOn = flag("w:lastRow", 64, false);
  const firstColOn = flag("w:firstColumn", 128, true);
  const lastColOn = flag("w:lastColumn", 256, false);
  const hBandOn = !flag("w:noHBand", 512, false);
  const bandSize = rowBandSizeOf(tblPr) ?? ts.rowBandSize ?? 1;
  const totalCols = Math.max(
    ...rows.map((row) => row.reduce((sum, c) => sum + (c.colSpan ?? 1), 0))
  );
  rows.forEach((row, r) => {
    const isFirst = firstRowOn && r === 0;
    const isLast = lastRowOn && r === rows.length - 1;
    const bandRow = firstRowOn ? r - 1 : r;
    const bandFill = hBandOn && bandRow >= 0 ? Math.floor(bandRow / bandSize) % 2 === 0 ? ts.band1Fill : ts.band2Fill : void 0;
    let col = 0;
    for (const cell of row) {
      const span = cell.colSpan ?? 1;
      const conds = [
        isFirst ? ts.firstRow : void 0,
        isLast ? ts.lastRow : void 0,
        firstColOn && col === 0 ? ts.firstCol : void 0,
        lastColOn && col + span === totalCols ? ts.lastCol : void 0
      ];
      col += span;
      if (cell.fill === void 0) {
        cell.fill = conds.find((c) => c?.fill)?.fill ?? bandFill ?? ts.fill ?? void 0;
      }
      const bold = conds.some((c) => c?.bold) || ts.wholeTable?.bold;
      if (bold) {
        cell.styleBold = true;
        if (cell.bold === void 0) cell.bold = true;
      }
      const color = conds.find((c) => c?.color)?.color ?? ts.wholeTable?.color;
      if (color) {
        cell.styleColor = color;
        if (!cell.color) cell.color = color;
      }
    }
  });
}
var ANCHOR_HOSTS = /* @__PURE__ */ new Set(["w:drawing", "w:pict"]);
var TXBX_CONTENT = /* @__PURE__ */ new Set(["w:txbxContent"]);
var WP_INLINE = /* @__PURE__ */ new Set(["wp:inline"]);
var WP_ANCHOR = /* @__PURE__ */ new Set(["wp:anchor"]);
var hfRowAnchorIds = /* @__PURE__ */ new WeakMap();
var hfImageAnchorId = /* @__PURE__ */ new WeakMap();
function anchorDocPrIds(node) {
  const anchors = [];
  collectNodes(childrenOf(node), "wp:anchor", anchors);
  return anchors.flatMap((a) => attrsOf(findChild(a, "wp:docPr") ?? {})["id"] ?? []);
}
function hasDeepChild(node, names) {
  return hasDeepChildOutside(node, names);
}
function hasFloatingVmlPicture(node) {
  for (const child of childrenOf(node)) {
    const name = nameOf(child);
    if (name?.startsWith("v:") && /position:\s*absolute/.test(attrsOf(child)["style"] ?? "") && !hasDeepChild(child, TXBX_CONTENT)) {
      return true;
    }
    if (hasFloatingVmlPicture(child)) return true;
  }
  return false;
}
function hasDeepChildOutside(node, names, skip) {
  for (const child of childrenOf(node)) {
    const name = nameOf(child);
    if (name && names.has(name)) return true;
    if (name && skip?.has(name)) continue;
    if (hasDeepChildOutside(child, names, skip)) return true;
  }
  return false;
}
function extractCell(tc, ctx, depth, docOffset) {
  const cell = { paras: [] };
  const richParas = [];
  const tcPr = findChild(tc, "w:tcPr");
  if (tcPr) {
    const span = Number(attrsOf(findChild(tcPr, "w:gridSpan") ?? {})["w:val"]);
    if (span > 1) cell.colSpan = span;
    const vMerge = findChild(tcPr, "w:vMerge");
    if (vMerge) {
      cell.vMerge = attrsOf(vMerge)["w:val"] === "restart" ? "restart" : "continue";
    }
    const fill = shdDisplayFill(findChild(tcPr, "w:shd"));
    if (fill) cell.fill = fill;
    const vAlign = attrsOf(findChild(tcPr, "w:vAlign") ?? {})["w:val"];
    if (vAlign === "center" || vAlign === "bottom" || vAlign === "top") cell.vAlign = vAlign;
    const tcMar = cellMarginsOf(findChild(tcPr, "w:tcMar"));
    if (tcMar) cell.cellMarTwips = tcMar;
    const dir = attrsOf(findChild(tcPr, "w:textDirection") ?? {})["w:val"];
    if (dir === "tbRl" || dir === "tbRlV") cell.textDirection = "tbRl";
    else if (dir === "btLr" || dir === "btLrV") cell.textDirection = "btLr";
    if (boolProp(tcPr, "w:noWrap")) cell.noWrap = true;
    const hMerge = findChild(tcPr, "w:hMerge");
    if (hMerge) cell.hMerge = attrsOf(hMerge)["w:val"] === "restart" ? "restart" : "continue";
    const borders = mergedBorderLinesOf(tcPr, "w:tcBorders", false);
    if (borders) cell.borders = borders;
    for (const kind of ["ins", "del"]) {
      const node = findChild(tcPr, kind === "ins" ? "w:cellIns" : "w:cellDel");
      if (!node) continue;
      const a = attrsOf(node);
      cell.cellRevision = {
        kind,
        author: a["w:author"] ?? "",
        ...a["w:date"] ? { date: a["w:date"] } : {},
        ...a["w:id"] ? { id: a["w:id"] } : {}
      };
      break;
    }
  }
  const nested = [];
  const nestedAnchors = [];
  let sawBold = false;
  let sawNonBold = false;
  const runColors = /* @__PURE__ */ new Set();
  const textParaJcs = /* @__PURE__ */ new Set();
  for (const block of childrenThroughSdt(tc, ["w:p", "w:tbl"])) {
    if (nameOf(block) === "w:tbl") {
      const model = depth >= MAX_TABLE_NEST_DEPTH ? flattenedTableModel(block) : extractTableModel(block, ctx, depth + 1, docOffset);
      if (model) {
        nested.push(model);
        nestedAnchors.push(cell.paras.length);
      }
      continue;
    }
    let p = block;
    if (hasDeepChild(p, ANCHOR_HOSTS)) {
      const rawPXml = serializeXNode(p);
      const pXml = rawPXml.includes("<mc:Fallback") ? rawPXml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, "") : rawPXml;
      if (pXml.includes("<wp:anchor") || /<w:pict[\s>]/.test(pXml)) {
        const pictures = topLevelDrawings(pXml).filter((f) => f.includes("<wp:anchor") && f.includes("<pic:pic")).length >= 2;
        const boxes = extractTextboxes(pXml, ctx, { shapes: true, pictures, docOffset });
        if (boxes.length > 0) {
          cell.anchoredBoxes = [...cell.anchoredBoxes ?? [], ...boxes];
          cell.anchoredBoxAnchors = [
            ...cell.anchoredBoxAnchors ?? [],
            ...boxes.map(() => cell.paras.length)
          ];
          try {
            let txml = pXml;
            for (const frag of topLevelDrawings(txml)) {
              if (frag.includes("<wp:anchor") && (pictures || !frag.includes("<pic:pic"))) {
                txml = txml.split(frag).join("");
              }
            }
            txml = txml.replace(
              /<w:pict>(?:(?!<\/w:pict>)[\s\S])*?<w:txbxContent>[\s\S]*?<\/w:pict>/g,
              ""
            );
            const stripped = xmlParser.parse(txml)[0];
            if (stripped && nameOf(stripped) === "w:p") p = stripped;
          } catch {
          }
        }
      }
    }
    const paraText = textOf(p);
    cell.paras.push(paraText);
    const pPr = findChild(p, "w:pPr");
    const cellStyleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
    const cellRef = listRefOf(ctx, pPr, cellStyleId);
    const list = cellRef ? {
      kind: listKindOf(ctx, cellRef.numId, cellRef.ilvl),
      numId: cellRef.numId,
      ilvl: cellRef.ilvl
    } : void 0;
    const runs = extractRuns(p, ctx, [], [], true);
    const format = inheritStyleBreakFlags(
      withCharIndents(
        extractParaFormat(pPr ?? {}, ctx.themeColors),
        ctx,
        p,
        pPr,
        cellStyleId,
        runs,
        {
          list: !!list,
          docOffset
        }
      ),
      cellStyleId ? ctx.styles.get(cellStyleId) : ctx.defaultParaStyle
    );
    const spaceOnly = runs.length > 0 && spaceOnlyRuns(runs) && !hasLayoutRunContent(p);
    const markSized = runs.length === 0 || spaceOnly;
    const emptySz = markSized ? emptyParaSizeHalfPoints(p, pPr, spaceOnly) : void 0;
    const emptyFont = markSized ? emptyParaMarkFont(p, pPr, ctx.themeFonts, spaceOnly) : void 0;
    const markSz = cellRef ? emptyParaSizeHalfPoints(p, pPr, true) : void 0;
    richParas.push({
      ...format,
      ...cellStyleId ? { styleId: cellStyleId } : {},
      ...emptySz ? { emptyRunSizeHalfPoints: emptySz } : {},
      ...emptyFont ? { emptyRunFontFamily: emptyFont } : {},
      ...markSz ? { markSizeHalfPoints: markSz } : {},
      ...list ? { list } : {},
      runs
    });
    if (paraText !== "") textParaJcs.add(attrsOf(findChild(pPr ?? {}, "w:jc") ?? {})["w:val"] ?? "");
    for (const r of findChildren(p, "w:r")) {
      const rPr = findChild(r, "w:rPr");
      if (rPr && boolProp(rPr, "w:b")) sawBold = true;
      else sawNonBold = true;
      if (textOf(r) !== "") runColors.add((rPr && colorFrom(rPr, ctx.themeColors)) ?? "none");
    }
  }
  if (textParaJcs.size === 1) {
    const jc = textParaJcs.values().next().value;
    if (jc === "center" || jc === "right" || jc === "left" || jc === "justify") cell.align = jc;
  }
  cell.richParas = richParas;
  if (nested.length > 0) {
    cell.nestedTables = nested;
    cell.nestedTableAnchors = nestedAnchors.map((a) => Math.min(a, cell.paras.length));
  }
  if (sawBold && !sawNonBold) cell.bold = true;
  if (runColors.size === 1) {
    const only = runColors.values().next().value;
    if (only !== "none") cell.color = only;
  }
  return cell;
}
function hfPartInfo(part) {
  if (!part) return null;
  return {
    text: part.text,
    hasPageNumber: part.hasPageNumber,
    paras: part.paras,
    ...part.images?.length ? { images: part.images } : {}
  };
}
function bindHfImageAnchors(images, paras) {
  for (const image of images) {
    const id = hfImageAnchorId.get(image);
    if (!id) continue;
    const at = paras.findIndex((p) => hfRowAnchorIds.get(p)?.includes(id));
    if (at >= 0) image.anchorPara = at;
  }
  return images;
}
async function hfImages(zip, partPath, partXml) {
  if (!partXml.includes("<a:blip") && !partXml.includes("<wps:wsp") && !/<w:pict[\s>]/.test(partXml)) {
    return [];
  }
  const relsPath = partPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const rels = await parseRels(zip, relsPath);
  const tbls = hfTblRanges(partXml);
  const onCellRun = (at) => tbls.some(([s, e]) => at > s && at < e);
  const acs = Array.from(
    partXml.matchAll(/<mc:AlternateContent[\s>][\s\S]*?<\/mc:AlternateContent>/g),
    (m) => {
      const fb = /<mc:Fallback>[\s\S]*?<\/mc:Fallback>/.exec(m[0]);
      return {
        start: m.index,
        end: m.index + m[0].length,
        fbStart: fb ? m.index + fb.index : -1,
        fbEnd: fb ? m.index + fb.index + fb[0].length : -1
      };
    }
  );
  const acAt = (at) => acs.findIndex((a) => at > a.start && at < a.end);
  const inFallbackOf = (at) => acs.findIndex((a) => at > a.fbStart && at < a.fbEnd);
  const choiceProduced = /* @__PURE__ */ new Set();
  const fallbackDup = (at) => {
    const fb = inFallbackOf(at);
    return fb >= 0 && choiceProduced.has(fb);
  };
  const recordProduced = (at) => {
    const ac = acAt(at);
    if (ac >= 0 && inFallbackOf(at) < 0) choiceProduced.add(ac);
  };
  const out = [];
  const paraAlignAt = (at) => {
    const pStart = Math.max(partXml.lastIndexOf("<w:p ", at), partXml.lastIndexOf("<w:p>", at));
    if (pStart < 0) return void 0;
    const jc = /<w:jc w:val="(\w+)"/.exec(partXml.slice(pStart, at))?.[1];
    return jc === "left" || jc === "center" || jc === "right" ? jc : void 0;
  };
  for (const m of partXml.matchAll(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g)) {
    const frag = m[0];
    if (fallbackDup(m.index)) continue;
    if (!/<wp:anchor[\s>]/.test(frag) && onCellRun(m.index)) continue;
    if (/<wp:anchor[\s>]/.test(frag) && frag.includes("<wpg:wgp")) {
      const children = await hfGroupPictures(zip, rels, frag, partPath);
      if (children) {
        out.push(...children);
        recordProduced(m.index);
        continue;
      }
    }
    let dataUrl = null;
    for (const b of frag.matchAll(/<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/g)) {
      dataUrl = await mediaDataUrl(zip, rels, b[1], partPath);
      if (dataUrl) break;
    }
    if (!dataUrl) dataUrl = hfShapeDrawingSvg(frag);
    if (!dataUrl) continue;
    const image = { dataUrl };
    const extent = /<wp:extent[^>]*\/?>/.exec(frag)?.[0] ?? "";
    const cx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? "", 10);
    const cy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? "", 10);
    if (Number.isFinite(cx) && cx > 0) image.widthPx = emuToPx(cx);
    if (Number.isFinite(cy) && cy > 0) image.heightPx = emuToPx(cy);
    const srcRect = /<a:srcRect\s[^>]*\/>/.exec(frag)?.[0];
    if (srcRect) {
      const crop = {
        l: rectFrac(srcRect, "l"),
        t: rectFrac(srcRect, "t"),
        r: rectFrac(srcRect, "r"),
        b: rectFrac(srcRect, "b")
      };
      if (crop.l || crop.t || crop.r || crop.b) image.crop = crop;
    }
    if (/<wp:anchor[\s>]/.test(frag)) {
      image.floating = true;
      const anchorTag = /<wp:anchor[^>]*>/.exec(frag)?.[0] ?? "";
      if (/behindDoc="(?:1|true)"/.test(anchorTag)) image.behind = true;
      const wrap = /<wp:wrap(None|Square|Tight|Through|TopAndBottom)[\s/>]/.exec(frag)?.[1];
      if (wrap) {
        image.wrap = wrap === "TopAndBottom" ? "topBottom" : wrap.toLowerCase();
      }
      readAnchorPos(frag, image);
      if (image.posXPx != null && image.posHRel === "margin" && onCellRun(m.index)) {
        image.posXPx += hfCellColumnLeftPx(partXml, m.index);
      }
      if (image.posVRel === "paragraph" && image.posYPx != null && onCellRun(m.index)) {
        const id = /<wp:docPr\s[^>]*\bid="([^"]+)"/.exec(frag)?.[1];
        if (id) hfImageAnchorId.set(image, id);
      }
    } else {
      const align = paraAlignAt(m.index);
      if (align) image.align = align;
    }
    recordProduced(m.index);
    out.push(image);
  }
  for (const m of partXml.matchAll(/<w:pict[\s>][\s\S]*?<\/w:pict>/g)) {
    const frag = m[0];
    if (fallbackDup(m.index)) continue;
    if (frag.includes("<v:textpath")) {
      const wm = readWatermarkShape(frag);
      if (wm) {
        recordProduced(m.index);
        out.push(wm);
      }
      continue;
    }
    if (!/position:\s*absolute/.test(frag) && onCellRun(m.index)) continue;
    const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(frag)?.[1];
    if (!rId) {
      const shape = vmlShapeSvg(frag);
      if (!shape || !/position:\s*absolute/.test(shape.style)) continue;
      const image2 = {
        dataUrl: shape.dataUrl,
        widthPx: shape.widthPx,
        heightPx: shape.heightPx,
        floating: true
      };
      if (/z-index:\s*-/.test(shape.style)) image2.behind = true;
      const rot = vmlRotationDeg(shape.style);
      if (rot != null) image2.rotationDeg = rot;
      vmlFloatAnchor(shape.style, image2);
      recordProduced(m.index);
      out.push(image2);
      continue;
    }
    const dataUrl = await mediaDataUrl(zip, rels, rId, partPath);
    if (!dataUrl) continue;
    const style = /<v:shape[^>]*style="([^"]*)"/.exec(frag)?.[1] ?? "";
    const image = { dataUrl };
    const w = vmlStyleDimPx(style, "width");
    const h = vmlStyleDimPx(style, "height");
    if (w) image.widthPx = w;
    if (h) image.heightPx = h;
    if (/position:absolute/.test(style)) {
      image.floating = true;
      if (/z-index:\s*-/.test(style)) image.behind = true;
      if (isPictureWatermarkShape(frag)) image.watermark = true;
      const rot = vmlRotationDeg(style);
      if (rot != null) image.rotationDeg = rot;
      vmlFloatAnchor(style, image);
    } else {
      const align = paraAlignAt(m.index);
      if (align) image.align = align;
    }
    const imagedata = /<v:imagedata[^>]*>/.exec(frag)?.[0] ?? "";
    const gain = vmlFraction(/\sgain="([^"]*)"/.exec(imagedata)?.[1]);
    const blackLevel = vmlFraction(/\sblacklevel="([^"]*)"/.exec(imagedata)?.[1]);
    if (gain != null || blackLevel != null) {
      image.washout = { gain: gain ?? 1, blackLevel: blackLevel ?? 0 };
    }
    recordProduced(m.index);
    out.push(image);
  }
  return out;
}
function readAnchorPos(frag, image) {
  for (const axis of ["H", "V"]) {
    const m = new RegExp(
      `<wp:position${axis}[^>]*relativeFrom="([^"]+)"[^>]*>([\\s\\S]*?)</wp:position${axis}>`
    ).exec(frag);
    if (!m) continue;
    const align = /<wp:align>(\w+)<\/wp:align>/.exec(m[2])?.[1];
    const offset = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(m[2])?.[1];
    if (align) {
      if (axis === "H" && (align === "left" || align === "center" || align === "right")) {
        image.posH = align;
        image.posHRel = anchorRelH(m[1]);
      }
      if (axis === "V" && (align === "top" || align === "center" || align === "bottom")) {
        image.posV = align;
        image.posVRel = anchorRelV(m[1]);
      }
    } else if (offset != null) {
      const px = Math.round(Number(offset) / EMU_PER_PX2);
      if (axis === "H") {
        image.posXPx = px;
        image.posHRel = anchorRelH(m[1]);
      } else {
        image.posYPx = px;
        image.posVRel = anchorRelV(m[1]);
      }
    }
  }
}
async function hfGroupPictures(zip, rels, frag, sourcePath = "word/document.xml") {
  const body = frag.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, "");
  const anchor = {};
  readAnchorPos(body, anchor);
  if (anchor.posXPx == null || anchor.posYPx == null) return null;
  const attrNum = (tag2, key) => {
    const v = new RegExp(`${key}="(-?\\d+)"`).exec(tag2)?.[1];
    return v == null ? null : parseInt(v, 10);
  };
  const grpXfrm = /<wpg:grpSpPr[^>]*>[\s\S]*?<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(body)?.[1];
  if (!grpXfrm) return null;
  const el = (name) => new RegExp(`<a:${name}[^>]*/>`).exec(grpXfrm)?.[0] ?? "";
  const ext = { x: attrNum(el("ext"), "cx") ?? 0, y: attrNum(el("ext"), "cy") ?? 0 };
  const chExt = { x: attrNum(el("chExt"), "cx") ?? 0, y: attrNum(el("chExt"), "cy") ?? 0 };
  const sx = ext.x > 0 && chExt.x > 0 ? ext.x / chExt.x : 1;
  const sy = ext.y > 0 && chExt.y > 0 ? ext.y / chExt.y : 1;
  const tx = (attrNum(el("off"), "x") ?? 0) - (attrNum(el("chOff"), "x") ?? 0) * sx;
  const ty = (attrNum(el("off"), "y") ?? 0) - (attrNum(el("chOff"), "y") ?? 0) * sy;
  const anchorTag = /<wp:anchor[^>]*>/.exec(body)?.[0] ?? "";
  const behind = /behindDoc="(?:1|true)"/.test(anchorTag);
  const wrap = /<wp:wrap(None|Square|Tight|Through|TopAndBottom)[\s/>]/.exec(body)?.[1];
  const out = [];
  for (const pm of body.matchAll(/<pic:pic[\s>][\s\S]*?<\/pic:pic>/g)) {
    const pic = pm[0];
    const xfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>([\s\S]*?)<\/a:xfrm>/.exec(pic);
    if (!xfrm || /\brot="-?[1-9]/.test(xfrm[1])) return null;
    const off = /<a:off[^>]*\/>/.exec(xfrm[2])?.[0] ?? "";
    const size = /<a:ext[^>]*\/>/.exec(xfrm[2])?.[0] ?? "";
    const cx = (attrNum(size, "cx") ?? 0) * sx;
    const cy = (attrNum(size, "cy") ?? 0) * sy;
    if (cx <= 0 || cy <= 0) return null;
    const rId = /<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/.exec(pic)?.[1];
    const dataUrl = rId ? await mediaDataUrl(zip, rels, rId, sourcePath) : null;
    if (!dataUrl) continue;
    const image = {
      dataUrl,
      widthPx: emuToPx(cx),
      heightPx: emuToPx(cy),
      floating: true,
      posXPx: anchor.posXPx + Math.round(((attrNum(off, "x") ?? 0) * sx + tx) / EMU_PER_PX2),
      posYPx: anchor.posYPx + Math.round(((attrNum(off, "y") ?? 0) * sy + ty) / EMU_PER_PX2),
      posHRel: anchor.posHRel,
      posVRel: anchor.posVRel
    };
    if (behind) image.behind = true;
    if (wrap) {
      image.wrap = wrap === "TopAndBottom" ? "topBottom" : wrap.toLowerCase();
    }
    const srcRect = /<a:srcRect\s[^>]*\/>/.exec(pic)?.[0];
    if (srcRect) {
      const crop = {
        l: rectFrac(srcRect, "l"),
        t: rectFrac(srcRect, "t"),
        r: rectFrac(srcRect, "r"),
        b: rectFrac(srcRect, "b")
      };
      if (crop.l || crop.t || crop.r || crop.b) image.crop = crop;
    }
    out.push(image);
  }
  return out.length > 0 ? out : null;
}
function hfShapeDrawingSvg(frag) {
  if (!frag.includes("<wps:wsp") || frag.includes("<w:txbxContent")) return null;
  const body = frag.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, "");
  const attrNum = (tag2, key) => {
    const v = new RegExp(`${key}="(-?\\d+)"`).exec(tag2)?.[1];
    return v == null ? null : parseInt(v, 10);
  };
  const extent = /<wp:extent[^>]*\/?>/.exec(body)?.[0] ?? "";
  const extCx = attrNum(extent, "cx") ?? 0;
  const extCy = attrNum(extent, "cy") ?? 0;
  if (extCx <= 0 || extCy <= 0) return null;
  if (/rot="-?[1-9]|flipH="(?:1|true)"|flipV="(?:1|true)"/.test(body)) return null;
  let sx = 1;
  let sy = 1;
  let tx = 0;
  let ty = 0;
  const grpXfrm = /<wpg:grpSpPr[^>]*>[\s\S]*?<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(body)?.[1];
  if (grpXfrm) {
    const el = (name) => new RegExp(`<a:${name}[^>]*/>`).exec(grpXfrm)?.[0] ?? "";
    const ext = { x: attrNum(el("ext"), "cx") ?? 0, y: attrNum(el("ext"), "cy") ?? 0 };
    const chExt = { x: attrNum(el("chExt"), "cx") ?? 0, y: attrNum(el("chExt"), "cy") ?? 0 };
    sx = ext.x > 0 && chExt.x > 0 ? ext.x / chExt.x : 1;
    sy = ext.y > 0 && chExt.y > 0 ? ext.y / chExt.y : 1;
    const off = { x: attrNum(el("off"), "x") ?? 0, y: attrNum(el("off"), "y") ?? 0 };
    const chOff = { x: attrNum(el("chOff"), "x") ?? 0, y: attrNum(el("chOff"), "y") ?? 0 };
    tx = off.x - chOff.x * sx;
    ty = off.y - chOff.y * sy;
  }
  const px = (emu) => Math.round(emu / EMU_PER_PX2 * 100) / 100;
  const placePath = (d, x, y, w, h) => {
    let axis = 0;
    return d.split(" ").map((tok) => {
      const n = Number(tok);
      if (!Number.isFinite(n)) {
        axis = 0;
        return tok;
      }
      return String(
        axis++ % 2 === 0 ? Math.round((x + n * w) * 100) / 100 : Math.round((y + n * h) * 100) / 100
      );
    }).join(" ");
  };
  const paths = [];
  for (const s of body.matchAll(/<wps:wsp[\s>][\s\S]*?<\/wps:wsp>/g)) {
    const wsp = s[0];
    const spPr = /<wps:spPr[\s\S]*?<\/wps:spPr>/.exec(wsp)?.[0] ?? "";
    const xfrm = /<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/.exec(spPr)?.[0] ?? "";
    const off = /<a:off[^>]*\/>/.exec(xfrm)?.[0] ?? "";
    const ext = /<a:ext[^>]*\/>/.exec(xfrm)?.[0] ?? "";
    const cx = attrNum(ext, "cx") ?? 0;
    const cy = attrNum(ext, "cy") ?? 0;
    if (cx <= 0 || cy <= 0) return null;
    const fill = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(spPr)?.[1];
    if (!fill) return null;
    const geom = parseCustGeom(wsp, cx, cy);
    const d = [geom?.path, geom?.fillPath].filter(Boolean).join(" ");
    if (!d) return null;
    const x = px((attrNum(off, "x") ?? 0) * sx + tx);
    const y = px((attrNum(off, "y") ?? 0) * sy + ty);
    paths.push(`<path d="${placePath(d, x, y, px(cx * sx), px(cy * sy))}" fill="#${fill}"/>`);
  }
  if (paths.length === 0) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(extCx)} ${px(extCy)}">` + paths.join("") + "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function hfTblRanges(xml) {
  const out = [];
  const re = /<w:tbl[\s>]|<\/w:tbl>/g;
  let depth = 0;
  let start = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0] === "</w:tbl>") {
      if (depth > 0 && --depth === 0) out.push([start, m.index + m[0].length]);
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}
function hfCellColumnLeftPx(xml, at) {
  const open = [];
  const re = /<w:tbl[\s>]|<\/w:tbl>|<w:tr[\s>]/g;
  for (let m = re.exec(xml); m && m.index < at; m = re.exec(xml)) {
    if (m[0] === "</w:tbl>") open.pop();
    else if (m[0].startsWith("<w:tbl")) open.push({ start: m.index, firstRow: -1, row: -1 });
    else if (open.length > 0) {
      const t = open[open.length - 1];
      if (t.firstRow < 0) t.firstRow = m.index;
      t.row = m.index;
    }
  }
  const tbl = open[open.length - 1];
  if (!tbl || tbl.row < 0) return 0;
  const { start: tblStart, row: rowStart } = tbl;
  const head = xml.slice(tblStart, tbl.firstRow);
  const tblInd = parseInt(/<w:tblInd\b[^>]*\bw:w\s*=\s*["'](-?\d+)["']/.exec(head)?.[1] ?? "0", 10) || 0;
  const grid = Array.from(
    (/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(head)?.[1] ?? "").matchAll(
      /<w:gridCol\b[^>]*\bw:w\s*=\s*["'](\d+)["']/g
    ),
    (g) => parseInt(g[1], 10)
  );
  const before = xml.slice(rowStart, at).replace(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g, "");
  let cols = 0;
  const cells = Array.from(before.matchAll(/<w:tc[\s>]([\s\S]*?)(?=<w:p[\s>]|<w:tc[\s>]|$)/g));
  for (const cell of cells.slice(0, -1)) {
    cols += parseInt(/<w:gridSpan\b[^>]*\bw:val\s*=\s*["'](\d+)["']/.exec(cell[1])?.[1] ?? "1", 10) || 1;
  }
  const twips = tblInd + grid.slice(0, cols).reduce((a, b) => a + b, 0);
  return Math.round(twips / 15);
}
async function hfTableMedia(zip, partPath, partXml) {
  if (!partXml.includes("<w:tbl")) return void 0;
  if (!partXml.includes("<a:blip") && !partXml.includes("<v:imagedata")) return void 0;
  const rels = await parseRels(zip, partPath.replace(/([^/]+)$/, "_rels/$1.rels"));
  const out = /* @__PURE__ */ new Map();
  for (const [start, end] of hfTblRanges(partXml)) {
    const slice = partXml.slice(start, end);
    const refs = [
      ...slice.matchAll(/<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']/g),
      ...slice.matchAll(/<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g)
    ];
    for (const m of refs) {
      const rId = m[1];
      if (out.has(rId)) continue;
      const rel = rels.get(rId);
      if (!rel) continue;
      if (rel.targetMode === "External" || /^https?:\/\//i.test(rel.target)) {
        out.set(rId, rel.target);
        continue;
      }
      const dataUrl = await mediaDataUrl(zip, rels, rId, partPath);
      if (dataUrl) out.set(rId, dataUrl);
    }
  }
  return out.size > 0 ? out : void 0;
}
async function parseCompatibilityMode(zip) {
  const file = zip.file("word/settings.xml");
  if (!file) return 0;
  const xml = await file.async("string");
  for (const tag2 of xml.match(/<w:compatSetting\b[^>]*>/g) ?? []) {
    if (!/\sw:name="compatibilityMode"/.test(tag2)) continue;
    const val2 = /\sw:val="(\d+)"/.exec(tag2);
    if (val2) return parseInt(val2[1], 10);
  }
  return 0;
}
async function parseLayoutSettings(zip) {
  const file = zip.file("word/settings.xml");
  if (!file) return {};
  const xml = await file.async("string");
  const tab = /<w:defaultTabStop[^>]*w:val="(-?\d+)"/.exec(xml);
  const csc = /<w:characterSpacingControl[^>]*w:val="(\w+)"/.exec(xml);
  return {
    ...xmlFlagOn(xml, "w:autoHyphenation") ? { autoHyphenation: true } : {},
    ...tab ? { defaultTabStopTwips: parseInt(tab[1], 10) } : {},
    ...xmlFlagOn(xml, "w:balanceSingleByteDoubleByteWidth") ? { balanceDbcsSpacing: true } : {},
    ...csc && csc[1].startsWith("compressPunctuation") ? { compressPunctuation: true } : {},
    ...xmlFlagOn(xml, "w:adjustLineHeightInTable") ? { adjustLineHeightInTable: true } : {},
    ...xmlFlagOn(xml, "w:doNotUseIndentAsNumberingTabStop") ? { indentNotNumberingTabStop: true } : {}
  };
}
async function parseNoteProps(zip, documentXml) {
  const settingsXml = await zip.file("word/settings.xml")?.async("string") ?? "";
  const bodyXml = documentXml.replace(/<w:sectPrChange\b[\s\S]*?<\/w:sectPrChange>/g, "");
  const at = bodyXml.lastIndexOf("<w:sectPr");
  const lastSectPr = at >= 0 ? bodyXml.slice(at) : "";
  const merged = (tag2) => {
    const base = notePropsFromXml(settingsXml, tag2);
    const own = notePropsFromXml(lastSectPr, tag2);
    return base || own ? { ...base, ...own } : void 0;
  };
  const footnoteProps = merged("w:footnotePr");
  const endnoteProps = merged("w:endnotePr");
  return {
    ...footnoteProps ? { footnoteProps } : {},
    ...endnoteProps ? { endnoteProps } : {}
  };
}
function noteNumbersOf(documentXml, footnotes, endnotes, footnoteProps, endnoteProps) {
  const out = /* @__PURE__ */ new Map();
  footnotes.forEach((n, i) => out.set(`footnote:${n.id}`, i + 1));
  endnotes.forEach((n, i) => out.set(`endnote:${n.id}`, i + 1));
  const props = { footnote: footnoteProps, endnote: endnoteProps };
  const count = { footnote: 0, endnote: 0 };
  const numbered = /* @__PURE__ */ new Set();
  let depth = 0;
  let sectDepth = -1;
  const re = /<w:(footnote|endnote)Reference\b([^>]*?)\/?>|<w:sectPr[\s>]|<w:p(?:\s[^>]*)?\/?>|<\/w:p>/g;
  for (const m of documentXml.matchAll(re)) {
    if (m[0].startsWith("<w:sectPr")) {
      sectDepth = depth;
      continue;
    }
    if (m[0].startsWith("<w:p")) {
      if (!m[0].endsWith("/>")) depth++;
      continue;
    }
    if (m[0] === "</w:p>") {
      depth--;
      if (sectDepth > depth) {
        sectDepth = -1;
        for (const kind2 of ["footnote", "endnote"]) {
          if (props[kind2]?.numRestart === "eachSect") count[kind2] = 0;
        }
      }
      continue;
    }
    const kind = m[1];
    if (/w:customMarkFollows="(?:1|true)"/.test(m[2])) continue;
    const id = /w:id="([^"]+)"/.exec(m[2])?.[1];
    const key = `${kind}:${id}`;
    if (!id || !out.has(key) || numbered.has(key)) continue;
    numbered.add(key);
    out.set(key, (props[kind]?.numStart ?? 1) + count[kind]++);
  }
  return out;
}
async function parseSettingsFlag(zip, tag2) {
  const file = zip.file("word/settings.xml");
  if (!file) return false;
  return xmlFlagOn(await file.async("string"), tag2);
}
function hfContentFromXml(xml, kind, theme, styles, tableMedia, compatibilityMode = 0, themeFonts, docDefaults) {
  let hasPageNumber = false;
  let cleaned = xml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, "");
  cleaned = cleaned.replace(
    /<w:fldChar[^>]*w:fldCharType\s*=\s*["']begin["'][^>]*?(?:\/>|>\s*<\/w:fldChar>)[\s\S]*?<w:fldChar[^>]*w:fldCharType\s*=\s*["']end["'][^>]*?(?:\/>|>\s*<\/w:fldChar>)/g,
    (span) => {
      const instr = (span.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) ?? []).map((m) => m.replace(/<[^>]+>/g, "")).join("");
      const cached = /<w:fldChar[^>]*w:fldCharType\s*=\s*["']separate["'][^>]*?(?:\/>|>\s*<\/w:fldChar>)([\s\S]*)$/.exec(
        span
      )?.[1];
      const resultRun = cached?.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)?.find((run2) => run2.includes("<w:t"));
      const rPr = resultRun && /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(resultRun)?.[0] || (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(span)?.[0] ?? "");
      const emit = (inner) => `</w:r>${inner}<w:r>`;
      if (/\bNUMPAGES\b/.test(instr)) {
        return emit(`<w:r>${rPr}<w:t>${TOTAL_PAGES_MARK}</w:t></w:r>`);
      }
      if (/\bPAGE\b/.test(instr)) {
        hasPageNumber = true;
        return emit(`<w:r>${rPr}<w:t>${PAGE_MARK}</w:t></w:r>`);
      }
      return emit(
        (cached?.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? []).filter((run2) => run2.includes("<w:t")).join("")
      );
    }
  );
  cleaned = cleaned.replace(
    /<w:fldSimple[^>]*w:instr\s*=\s*["']([^"']*)["'][^>]*(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/g,
    (whole, instr, inner) => {
      const rPr = inner ? /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)?.[0] ?? "" : "";
      if (/\bNUMPAGES\b/.test(instr)) return `<w:r>${rPr}<w:t>${TOTAL_PAGES_MARK}</w:t></w:r>`;
      if (/\bPAGE\b/.test(instr)) {
        hasPageNumber = true;
        return `<w:r>${rPr}<w:t>${PAGE_MARK}</w:t></w:r>`;
      }
      return inner ?? whole;
    }
  );
  cleaned = cleaned.replace(/<w:pgNum\s*\/>/g, () => {
    hasPageNumber = true;
    return `<w:t>${PAGE_MARK}</w:t>`;
  });
  return {
    text: plainText(cleaned),
    hasPageNumber,
    watermark: kind === "header" ? readWatermarkText(xml) : null,
    watermarkPicture: kind === "header" ? readPictureWatermark(xml) : null,
    // strip leftover field chars so the page marker parses as plain text
    paras: hfParagraphs(
      cleaned.replace(/<w:fldChar[^>]*?(?:\/>|>\s*<\/w:fldChar>)/g, ""),
      theme,
      styles,
      tableMedia,
      compatibilityMode,
      themeFonts,
      docDefaults
    )
  };
}
async function readHeaderFooterPart(zip, documentXml, rels, kind, hfType = "default", theme, styles, compatibilityMode = 0, themeFonts, docDefaults, sourcePath = "word/document.xml") {
  const refs = hfReferenceTags(documentXml, kind);
  const typed = refs.find((r) => hfReferenceType(r) === hfType);
  const ref = hfType === "default" ? typed ?? refs.find((r) => hfReferenceType(r) === "odd") ?? refs.find((r) => hfReferenceType(r) === void 0) : typed;
  if (!ref) return null;
  const rId = hfReferenceRId(ref);
  const target = rId ? rels.get(rId)?.target : void 0;
  if (!target) return null;
  const path = resolveRelationshipTargetPath(sourcePath, target);
  if (!path) return null;
  const file = zip.file(path);
  if (!file) return null;
  const xml = await file.async("string");
  const content = hfContentFromXml(
    xml,
    kind,
    theme,
    styles,
    await hfTableMedia(zip, path, xml),
    compatibilityMode,
    themeFonts,
    docDefaults
  );
  const images = bindHfImageAnchors(await hfImages(zip, path, xml), content.paras);
  return images.length > 0 ? { ...content, images } : content;
}
async function parseAllHfParts(zip, rels, styles, theme, compatibilityMode = 0, themeFonts, docDefaults, sourcePath = "word/document.xml") {
  const out = {};
  for (const [rId, rel] of rels) {
    const kind = rel.type.endsWith("/header") ? "header" : rel.type.endsWith("/footer") ? "footer" : null;
    if (!kind) continue;
    const path = resolveRelationshipTargetPath(sourcePath, rel.target);
    if (!path) continue;
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const content = hfContentFromXml(
      xml,
      kind,
      theme,
      styles,
      await hfTableMedia(zip, path, xml),
      compatibilityMode,
      themeFonts,
      docDefaults
    );
    const images = bindHfImageAnchors(await hfImages(zip, path, xml), content.paras);
    out[rId] = {
      text: content.text,
      hasPageNumber: content.hasPageNumber,
      paras: content.paras,
      ...images.length > 0 ? { images } : {}
    };
  }
  return out;
}
function mergeTabStops(style, direct) {
  if (!style?.length || !direct?.length) {
    const only = direct ?? style;
    return only?.filter((s) => s.val !== "clear");
  }
  const merged = [...style.filter((s) => !direct.some((o) => o.pos === s.pos)), ...direct].filter((s) => s.val !== "clear").sort((a, b) => a.pos - b.pos);
  const out = merged.filter((s, i) => i === 0 || s.pos !== merged[i - 1].pos);
  return out.length > 0 ? out : void 0;
}
function hfParaStyleLayers(pNode, styles) {
  const pPr = findChild(pNode, "w:pPr");
  const direct = pPr ? extractParaFormat(pPr) : void 0;
  const styleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
  return { direct, d: styleId ? styles?.get(styleId)?.display : void 0 };
}
function hfStyledParaFormat(pNode, styles, docDefaults) {
  const { direct, d } = hfParaStyleLayers(pNode, styles);
  const chain = d ?? hfDefaultParaStyle(styles)?.display;
  return {
    ...d?.align && d.align !== "justify" ? { align: d.align } : {},
    ...hfStyleLineSpacing(d, direct),
    ...direct,
    ...hfResolvedSpacing(chain, direct, docDefaults),
    ...d?.borderSides ? mergeStyleBorders(d.borderSides, direct) : {}
  };
}
var HF_AUTO_SPACING_TWIPS = 280;
function hfDefaultParaStyle(styles) {
  if (!styles) return void 0;
  for (const info of styles.values()) if (info.type === "paragraph" && info.isDefault) return info;
  return void 0;
}
function hfResolvedSpacing(d, direct, dd) {
  const out = {};
  const before = direct?.spaceBeforeAuto ?? d?.spaceBeforeAuto ?? dd?.spaceBeforeAuto ? HF_AUTO_SPACING_TWIPS : direct?.spaceBefore ?? d?.spaceBeforeTwips ?? dd?.spaceBeforeTwips;
  const after = direct?.spaceAfterAuto ?? d?.spaceAfterAuto ?? dd?.spaceAfterAuto ? HF_AUTO_SPACING_TWIPS : direct?.spaceAfter ?? d?.spaceAfterTwips ?? dd?.spaceAfterTwips;
  if (before) out.spaceBefore = before;
  if (after) out.spaceAfter = after;
  return out;
}
function hfStyleLineSpacing(d, direct) {
  if (!d?.lineRule || !d.lineRawTwips) return {};
  if (direct?.lineRule || direct?.lineRawTwips || direct?.lineSpacing !== void 0) return {};
  return {
    lineRule: d.lineRule,
    lineRawTwips: d.lineRawTwips,
    ...d.lineRule === "auto" ? { lineSpacing: Math.round(d.lineRawTwips / 240 * 100) / 100 } : {}
  };
}
function hfParagraphs(partXml, theme, styles, tableMedia, compatibilityMode = 0, themeFonts, docDefaults) {
  let parsed;
  try {
    parsed = xmlParser.parse(partXml);
  } catch {
    return [];
  }
  const root = parsed.find((n) => nameOf(n) === "w:hdr" || nameOf(n) === "w:ftr");
  if (!root) return [];
  const ctx = {
    rels: /* @__PURE__ */ new Map(),
    noteNumbers: /* @__PURE__ */ new Map(),
    themeColors: theme,
    themeFonts,
    styles,
    xmlSpacePreserve: attrsOf(root)["xml:space"] === "preserve"
  };
  const out = [];
  const deferred = [];
  const flushDeferred = () => {
    out.push(...deferred);
    deferred.length = 0;
  };
  for (const node of childrenThroughSdt(root, ["w:tbl", "w:p"])) {
    const name = nameOf(node);
    if (name === "w:tbl") {
      const rows = hfTableRowParagraphs(
        node,
        tableMedia ? { ...ctx, mediaByRid: tableMedia } : ctx,
        compatibilityMode
      );
      if (findChild(findChild(node, "w:tblPr") ?? {}, "w:tblpPr")) deferred.push(...rows);
      else out.push(...rows);
      continue;
    }
    if (name !== "w:p") continue;
    const pNode = node;
    const runs = extractRuns(pNode, ctx);
    const boxed = hasDeepChild(pNode, TXBX_CONTENT) ? textboxParagraphs(pNode, ctx) : [];
    if (runs.length === 0 && (findChild(pNode, "w:r") || findChild(pNode, "w:pict"))) {
      if ((boxed.length > 0 || hasDeepChild(pNode, WP_ANCHOR) || hasFloatingVmlPicture(pNode)) && boxed.every((p) => p.box) && !hasDeepChildOutside(pNode, WP_INLINE, TXBX_CONTENT)) {
        for (const p of boxed) p.box.anchorPara = out.length;
        out.push({ ...hfStyledParaFormat(pNode, styles, docDefaults), runs: [], lineOnly: true });
      }
      out.push(...boxed);
      flushDeferred();
      continue;
    }
    const anchoredBoxes = boxed.filter((p) => p.box);
    for (const p of anchoredBoxes) p.box.anchorPara = out.length;
    const pPr = findChild(pNode, "w:pPr");
    const { direct, d } = hfParaStyleLayers(pNode, styles);
    const ptabAligns = [];
    let sawPtab = false;
    const walkTabs = (n) => {
      for (const c of childrenOf(n)) {
        const name2 = nameOf(c);
        if (name2 === "w:pPr") continue;
        if (name2 === "w:tab") ptabAligns.push(void 0);
        else if (name2 === "w:ptab") {
          sawPtab = true;
          const a = attrsOf(c)["w:alignment"];
          ptabAligns.push(a === "center" ? "center" : a === "right" ? "right" : "left");
        } else walkTabs(c);
      }
    };
    walkTabs(pNode);
    const framePr = pPr ? findChild(pPr, "w:framePr") : void 0;
    const frameAttrs = framePr ? attrsOf(framePr) : void 0;
    const xAlign = frameAttrs && !frameAttrs["w:dropCap"] ? frameAttrs["w:xAlign"] : void 0;
    const frameXAlign = xAlign === "right" || xAlign === "outside" ? "right" : xAlign === "center" ? "center" : xAlign === "left" || xAlign === "inside" ? "left" : void 0;
    const mergedStops = mergeTabStops(d?.tabStops, direct?.tabStops);
    const styleId = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
    const emptySz = runs.length === 0 ? emptyParaSizeHalfPoints(pNode, pPr) ?? (styleId ? styles?.get(styleId)?.display?.sizeHalfPoints : void 0) : void 0;
    out.push({
      ...hfStyledParaFormat(pNode, styles, docDefaults),
      ...mergedStops ? { tabStops: mergedStops } : {},
      ...sawPtab ? { ptabAligns } : {},
      ...frameXAlign ? { frameXAlign } : {},
      ...emptySz ? { emptyRunSizeHalfPoints: emptySz } : {},
      runs
    });
    out.push(...anchoredBoxes);
    flushDeferred();
  }
  flushDeferred();
  return out;
}
var NO_BORDER = { style: "none" };
function hfLine(b) {
  return b && b.style !== "none" && b.style !== "nil" ? b : void 0;
}
function hfCellBorders(rows, r, c, tbl) {
  const cell = rows[r][c];
  const own = cell.borders;
  const below = rows[r + 1];
  const covering = (row, col) => row.find((x) => x.gridStart <= col && col < x.gridStart + x.span);
  let bottom;
  if (!below) bottom = own?.bottom ?? tbl?.bottom;
  else {
    for (let col = cell.gridStart; col < cell.gridStart + cell.span; col++) {
      const under = covering(below, col);
      const line = under?.vMergeContinue ? NO_BORDER : own?.bottom ?? under?.borders?.top ?? tbl?.insideH;
      if (hfLine(line)) {
        bottom = line;
        break;
      }
      bottom ??= line;
    }
  }
  const next = rows[r][c + 1];
  const right = next ? own?.right ?? next.borders?.left ?? tbl?.insideV : own?.right ?? tbl?.right;
  const top = r === 0 ? own?.top ?? tbl?.top : void 0;
  const left = c === 0 ? own?.left ?? tbl?.left : void 0;
  const out = {};
  if (hfLine(top)) out.top = top;
  if (hfLine(left)) out.left = left;
  if (hfLine(bottom)) out.bottom = bottom;
  if (hfLine(right)) out.right = right;
  return Object.keys(out).length > 0 ? out : void 0;
}
function hfTableRowParagraphs(tbl, ctx, compatibilityMode) {
  const tblPr = findChild(tbl, "w:tblPr");
  const styleId = attrsOf(findChild(tblPr ?? {}, "w:tblStyle") ?? {})["w:val"];
  const styleTable = styleId ? ctx.styles?.get(styleId)?.tableDisplay : void 0;
  const tblBorders = mergedBorderLinesOf(tblPr, "w:tblBorders", true) ?? styleTable?.borders;
  const tblMar = cellMarginsOf(findChild(tblPr ?? {}, "w:tblCellMar")) ?? styleTable?.cellMarTwips;
  const tblW = attrsOf(findChild(tblPr ?? {}, "w:tblW") ?? {});
  const tblInd = attrsOf(findChild(tblPr ?? {}, "w:tblInd") ?? {});
  const indRaw = !tblInd["w:type"] || tblInd["w:type"] === "dxa" ? Number(tblInd["w:w"]) : 0;
  const indentTwips = (Number.isFinite(indRaw) ? indRaw : 0) - (compatibilityMode >= 15 ? 0 : tblMar?.left ?? 108);
  const bidiVisual = boolProp(tblPr ?? {}, "w:bidiVisual");
  const rowBase = {
    indentTwips,
    tabOverflow: compatibilityMode >= 15 ? "wrap" : "clip",
    ...bidiVisual ? { bidiVisual: true } : {}
  };
  const grid = findChild(tbl, "w:tblGrid");
  const gridCols = grid ? findChildren(grid, "w:gridCol").map((g) => Number(attrsOf(g)["w:w"]) || 0) : [];
  const trs = childrenThroughSdt(tbl, "w:tr");
  const rawRows = trs.map((tr) => {
    let col = 0;
    return childrenThroughSdt(tr, "w:tc").map((tc) => {
      const tcPr = findChild(tc, "w:tcPr");
      const span = Number(attrsOf(findChild(tcPr ?? {}, "w:gridSpan") ?? {})["w:val"]) || 1;
      const a = attrsOf(findChild(tcPr ?? {}, "w:tcW") ?? {});
      const v = Number(a["w:w"]);
      const widthIsPct = a["w:type"] === "pct";
      const declared = !widthIsPct && Number.isFinite(v) && v > 0 ? v : 0;
      const fromGrid = gridCols.slice(col, col + span).reduce((s, w) => s + w, 0);
      const vMerge = findChild(tcPr ?? {}, "w:vMerge");
      const cell = {
        tc,
        tcPr,
        gridStart: col,
        span,
        widthTwips: declared || fromGrid,
        widthIsPct,
        vMergeContinue: Boolean(vMerge) && attrsOf(vMerge)["w:val"] !== "restart",
        borders: mergedBorderLinesOf(tcPr, "w:tcBorders", false)
      };
      col += span;
      return cell;
    });
  });
  const visualRows = bidiVisual ? rawRows.map((row) => [...row].reverse()) : rawRows;
  const absolute = tblW["w:type"] !== "pct" && rawRows.every((row) => row.every((c) => !c.widthIsPct && c.widthTwips > 0));
  const out = [];
  rawRows.forEach((raw, r) => {
    const trPr = findChild(trs[r], "w:trPr");
    const trHeight = attrsOf(findChild(trPr ?? {}, "w:trHeight") ?? {});
    const heightTwips = Number(trHeight["w:val"]);
    const row = {
      ...rowBase,
      ...heightTwips > 0 ? { heightTwips, heightRule: trHeight["w:hRule"] === "exact" ? "exact" : "atLeast" } : {}
    };
    const total = raw.reduce((s, c) => s + c.widthTwips, 0);
    const cells = raw.map((rc, c) => {
      const content = hfCellContent(rc.tc, ctx, styleTable?.paraSpacing);
      const vAlign = attrsOf(findChild(rc.tcPr ?? {}, "w:vAlign") ?? {})["w:val"];
      const tcMar = cellMarginsOf(findChild(rc.tcPr ?? {}, "w:tcMar"));
      const mar = tblMar || tcMar ? { ...tblMar, ...tcMar } : void 0;
      const borders = hfCellBorders(visualRows, r, bidiVisual ? raw.length - 1 - c : c, tblBorders);
      return {
        ...content,
        ...total > 0 && rc.widthTwips > 0 ? { widthPct: rc.widthTwips / total * 100 } : {},
        ...absolute ? { widthTwips: rc.widthTwips } : {},
        ...borders ? { borders } : {},
        ...vAlign === "center" || vAlign === "bottom" ? { vAlign } : {},
        ...mar ? { marTwips: mar } : {}
      };
    });
    if (cells.some(
      (c) => c.paras.some((rs) => rs.some((r2) => r2.text !== "" || r2.image)) || c.fill || c.borders
    )) {
      const rowPara = { runs: [], cells, row };
      out.push(rowPara);
      const ids = anchorDocPrIds(trs[r]);
      if (ids.length > 0) hfRowAnchorIds.set(rowPara, ids);
    }
  });
  return out;
}
function hfCellContent(tc, ctx, styleSpacing) {
  const paras = [];
  const paraProps = [];
  let align;
  const shd = attrsOf(findChild(findChild(tc, "w:tcPr") ?? {}, "w:shd") ?? {})["w:fill"];
  let fill = shd && shd !== "auto" ? stripHash(shd) : void 0;
  let sawNested = false;
  for (const node of childrenThroughSdt(tc, ["w:p", "w:tbl"])) {
    if (nameOf(node) === "w:tbl") {
      sawNested = true;
      const nestedStyle = attrsOf(findChild(findChild(node, "w:tblPr") ?? {}, "w:tblStyle") ?? {})["w:val"];
      const nestedSpacing = nestedStyle ? ctx.styles?.get(nestedStyle)?.tableDisplay?.paraSpacing : void 0;
      for (const tr of childrenThroughSdt(node, "w:tr")) {
        for (const inner of childrenThroughSdt(tr, "w:tc")) {
          const c = hfCellContent(inner, ctx, nestedSpacing);
          paras.push(...c.paras);
          paraProps.push(...c.paraProps ?? c.paras.map(() => void 0));
          align ??= c.align;
          fill ??= c.fill;
        }
      }
      continue;
    }
    paras.push(
      extractRuns(node, ctx, [], [], true).flatMap((r) => {
        if (!r.image || !/<wp:anchor[\s>]/.test(r.image.xml) && !/position:\s*absolute/.test(r.image.xml))
          return r;
        const { image: _image, ...rest } = r;
        return rest.text === "" ? [] : rest;
      })
    );
    const pPr = findChild(node, "w:pPr");
    const direct = pPr ? extractParaFormat(pPr, ctx.themeColors) : void 0;
    const pStyle = pPr ? attrsOf(findChild(pPr, "w:pStyle") ?? {})["w:val"] : void 0;
    const d = pStyle ? ctx.styles?.get(pStyle)?.display : void 0;
    const stops = mergeTabStops(d?.tabStops, direct?.tabStops);
    const spaceBefore = direct?.spaceBefore ?? (d?.spaceBeforeTwips == null ? styleSpacing?.beforeTwips : void 0);
    const spaceAfter = direct?.spaceAfter ?? (d?.spaceAfterTwips == null ? styleSpacing?.afterTwips : void 0);
    const props = {
      ...d?.align && d.align !== "justify" ? { align: d.align } : {},
      ...direct?.align ? { align: direct.align } : {},
      ...direct?.indentLeft ? { indentLeft: direct.indentLeft } : {},
      ...direct?.indentFirstLine ? { indentFirstLine: direct.indentFirstLine } : {},
      ...spaceBefore ? { spaceBefore } : {},
      ...spaceAfter ? { spaceAfter } : {},
      ...stops?.length ? { tabStops: stops } : {},
      ...hfStyleLineSpacing(d, direct),
      ...direct?.lineRule ? { lineRule: direct.lineRule } : {},
      ...direct?.lineRawTwips ? { lineRawTwips: direct.lineRawTwips } : {},
      ...direct?.lineSpacing !== void 0 ? { lineSpacing: direct.lineSpacing } : {}
    };
    paraProps.push(Object.keys(props).length > 0 ? props : void 0);
    if (!align && props.align) align = props.align;
  }
  if (sawNested) {
    while (paras.length > 0 && paras[paras.length - 1].length === 0) {
      paras.pop();
      paraProps.pop();
    }
  }
  return {
    paras,
    ...paraProps.some(Boolean) ? { paraProps } : {},
    ...align ? { align } : {},
    ...fill ? { fill } : {}
  };
}
function textboxParagraphs(pNode, ctx) {
  const out = [];
  const walk = (node, box) => {
    const name = nameOf(node);
    if (name === "w:txbxContent") {
      for (const inner of findChildren(node, "w:p")) {
        const runs = extractRuns(inner, ctx);
        if (runs.length === 0) continue;
        const pPr = findChild(inner, "w:pPr");
        out.push({
          ...pPr ? extractParaFormat(pPr, ctx.themeColors) : {},
          runs,
          ...box ? { boxAnchored: true, box } : {}
        });
      }
      return;
    }
    let next = box;
    if (name === "wp:anchor") next = hfTextBoxOfAnchor(node);
    else if (name?.startsWith("v:") && /position:\s*absolute/.test(attrsOf(node)["style"] ?? "")) {
      next = hfTextBoxOfVml(node);
    } else if (box && name === "wps:bodyPr") {
      readBodyPr(node, box);
    } else if (box && name === "v:textbox") {
      readVmlInset(node, box);
    }
    for (const child of childrenOf(node)) walk(child, next);
  };
  walk(pNode, void 0);
  return out;
}
var hfTextBoxSeq = 0;
var TEXTBOX_INSETS_PX = [9.6, 4.8, 9.6, 4.8];
function hfTextBoxOfAnchor(anchor) {
  const box = { id: ++hfTextBoxSeq };
  const attrs = attrsOf(anchor);
  if (attrs["behindDoc"] === "1" || attrs["behindDoc"] === "true") box.behind = true;
  const ext = attrsOf(findChild(anchor, "wp:extent") ?? {});
  const cx = parseInt(ext["cx"] ?? "", 10);
  const cy = parseInt(ext["cy"] ?? "", 10);
  if (cx > 0) box.widthPx = Math.round(cx / EMU_PER_PX2);
  if (cy > 0) box.heightPx = Math.round(cy / EMU_PER_PX2);
  for (const child of childrenOf(anchor)) {
    const wrap = /^wp:wrap(None|Square|Tight|Through|TopAndBottom)$/.exec(nameOf(child) ?? "")?.[1];
    if (wrap)
      box.wrap = wrap === "TopAndBottom" ? "topBottom" : wrap.toLowerCase();
  }
  readAnchorPos(serializeXNode(anchor), box);
  return box;
}
function vmlLengthPx2(raw) {
  const m = /^\s*(-?[\d.]+)\s*(pt|in|cm|mm|px|pc)?\s*$/.exec(raw ?? "");
  if (!m) return void 0;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return void 0;
  const perIn = { pt: 72, in: 1, cm: 2.54, mm: 25.4, px: 96, pc: 6 };
  return Math.round(v / (perIn[m[2] ?? "pt"] ?? 72) * 96 * 100) / 100;
}
function hfTextBoxOfVml(shape) {
  const box = { id: ++hfTextBoxSeq };
  const style = attrsOf(shape)["style"] ?? "";
  const px = (prop) => {
    const v = vmlLengthPx2(new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`).exec(style)?.[1]);
    return v === void 0 ? void 0 : Math.round(v);
  };
  const w = px("width");
  const h = px("height");
  if (w !== void 0 && w > 0) box.widthPx = w;
  if (h !== void 0 && h > 0) box.heightPx = h;
  if (/z-index:\s*-/.test(style)) box.behind = true;
  const posH = /mso-position-horizontal:(\w+)/.exec(style)?.[1];
  const posV = /mso-position-vertical:(\w+)/.exec(style)?.[1];
  const relH = /mso-position-horizontal-relative:([\w-]+)/.exec(style)?.[1];
  const relV = /mso-position-vertical-relative:([\w-]+)/.exec(style)?.[1];
  const x = px("margin-left");
  const y = px("margin-top");
  if (posH === "left" || posH === "center" || posH === "right") box.posH = posH;
  else if (x !== void 0) {
    box.posXPx = x;
    box.posHRel = anchorRelH(relH);
  }
  if (posV === "top" || posV === "center" || posV === "bottom") box.posV = posV;
  else if (y !== void 0) {
    box.posYPx = y;
    box.posVRel = relV === "margin" ? "margin" : anchorRelV(relV ?? "text");
  }
  const wrap = attrsOf(findChild(shape, "w10:wrap") ?? {})["type"];
  if (wrap === "none" || wrap === "square" || wrap === "tight" || wrap === "through")
    box.wrap = wrap;
  else if (wrap === "topAndBottom") box.wrap = "topBottom";
  return box;
}
function readBodyPr(bodyPr, box) {
  const a = attrsOf(bodyPr);
  const ins = (name, dflt) => {
    const v = parseInt(a[name] ?? "", 10);
    return Math.round((Number.isFinite(v) ? v : dflt) / EMU_PER_PX2 * 100) / 100;
  };
  box.insets = [ins("lIns", 91440), ins("tIns", 45720), ins("rIns", 91440), ins("bIns", 45720)];
  if (a["anchor"] === "ctr") box.vAlign = "center";
  else if (a["anchor"] === "b") box.vAlign = "bottom";
  if (a["wrap"] === "none") box.nowrap = true;
  if (findChild(bodyPr, "a:spAutoFit")) box.autofit = true;
}
function readVmlInset(textbox, box) {
  if (/mso-fit-shape-to-text:\s*t/.test(attrsOf(textbox)["style"] ?? "")) box.autofit = true;
  const raw = attrsOf(textbox)["inset"];
  if (!raw) return;
  const parts = raw.split(",");
  box.insets = TEXTBOX_INSETS_PX.map((d, i) => vmlLengthPx2(parts[i]) ?? d);
}
async function parseNotesPart(zip, kind) {
  const file = zip.file(NOTE_PART_PATH[kind]);
  if (!file) return [];
  return parseNotesXml(await file.async("string"), kind);
}
async function parseSources(zip) {
  const path = await findSourcesPart(zip);
  if (!path) return [];
  return parseSourcesXml(await zip.file(path).async("string"));
}
async function parseTheme(zip) {
  const file = zip.file(THEME_PART_PATH);
  if (!file) return { fonts: null, colors: { ...DEFAULT_THEME_COLORS } };
  const xml = await file.async("string");
  const fonts = readThemeFonts(xml);
  if (fonts) {
    const { eaLang, bidiLang } = await readThemeFontLang(zip);
    if (eaLang) fonts.eaLang = eaLang;
    if (bidiLang) fonts.bidiLang = bidiLang;
  }
  return { fonts, colors: readThemeColors(xml) };
}
async function readThemeFontLang(zip) {
  const file = zip.file("word/settings.xml");
  if (!file) return {};
  const tag2 = /<w:themeFontLang\b[^>]*>/.exec(await file.async("string"))?.[0];
  if (!tag2) return {};
  return {
    eaLang: /\bw:eastAsia="([^"]+)"/.exec(tag2)?.[1],
    bidiLang: /\bw:bidi="([^"]+)"/.exec(tag2)?.[1]
  };
}
function blipEffectsOf(xml) {
  const blip = /<a:blip\b[^>]*[^/>]>([\s\S]*?)<\/a:blip>/.exec(xml)?.[1];
  if (!blip) return void 0;
  const out = {};
  const lum = /<a:lum\b[^>]*\/?>/.exec(blip)?.[0];
  if (lum) {
    const bright = rectFrac(lum, "bright");
    const contrast = rectFrac(lum, "contrast");
    if (bright) out.bright = bright;
    if (contrast) out.contrast = contrast;
  }
  if (/<a:grayscl\b/.test(blip)) out.grayscale = true;
  const biLevel = /<a:biLevel\b[^>]*\/?>/.exec(blip)?.[0];
  if (biLevel) out.biLevelThresh = /\bthresh="/.test(biLevel) ? rectFrac(biLevel, "thresh") : 0.5;
  return Object.keys(out).length > 0 ? out : void 0;
}
function rectFrac(tag2, name) {
  const v = parseFloat(new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(tag2)?.[1] ?? "");
  return Number.isFinite(v) ? v / 1e5 : 0;
}
function picBorderOf(xml) {
  const picSpPr = /<pic:spPr[^>]*>([\s\S]*?)<\/pic:spPr>/.exec(xml)?.[1];
  const picLn = picSpPr ? /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(picSpPr)?.[0] : void 0;
  if (!picLn || /<a:noFill\s*\/>/.test(picLn)) return void 0;
  const color = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(picLn)?.[1];
  if (!color) return void 0;
  const w = parseInt(/<a:ln\b[^>]*\bw="(\d+)"/.exec(picLn)?.[1] ?? "", 10);
  return {
    color: color.toUpperCase(),
    widthPt: Number.isFinite(w) && w > 0 ? w / EMU_PER_PT : 0.75
  };
}
function picTransformOf(xml) {
  const picXfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>/.exec(xml)?.[1];
  if (!picXfrm) return {};
  const out = {};
  const rot = parseInt(/\brot="(-?\d+)"/.exec(picXfrm)?.[1] ?? "", 10);
  if (Number.isFinite(rot) && rot !== 0) out.rotDeg = (Math.round(rot / 6e4) % 360 + 360) % 360;
  if (/\bflipH="(?:1|true)"/.test(picXfrm)) out.flipH = true;
  if (/\bflipV="(?:1|true)"/.test(picXfrm)) out.flipV = true;
  return out;
}
function imageMeta(xml) {
  const meta = {};
  const drawingAt = xml.search(/<w:(?:drawing|pict)[\s>]/);
  if (drawingAt >= 0 && /^<w:p[\s>]/.test(xml)) {
    const leadingXml = xml.slice(0, drawingAt);
    const leadingText = plainText(leadingXml);
    if (leadingText !== "") meta.imageLeadingText = leadingText;
    const pPr = rawPPrOf(xml);
    const leadingFonts = [...leadingXml.matchAll(/<w:rFonts\b[^>]*\/?>/g)].at(-1)?.[0];
    meta.imageLeadingFont = /w:eastAsia="([^"]+)"/.exec(leadingFonts ?? "")?.[1] ?? /w:ascii="([^"]+)"/.exec(leadingFonts ?? "")?.[1];
    let explicitSpaceWidthPx = 0;
    let implicitSpaceCount = 0;
    for (const runMatch of leadingXml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const runBody = runMatch[1];
      const text = plainText(`<w:r>${runBody}</w:r>`);
      if (!/^[ ]+$/.test(text)) continue;
      const rPr = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(runBody)?.[0];
      const sizeHalfPoints = Number(/<w:sz\b[^>]*w:val="(\d+)"/.exec(rPr ?? "")?.[1] ?? NaN);
      if (Number.isFinite(sizeHalfPoints)) {
        explicitSpaceWidthPx += text.length * sizeHalfPoints / 3;
      } else {
        implicitSpaceCount += text.length;
      }
    }
    if (explicitSpaceWidthPx > 0) {
      meta.imageLeadingExplicitSpaceWidthPx = explicitSpaceWidthPx;
    }
    if (implicitSpaceCount > 0) meta.imageLeadingImplicitSpaceCount = implicitSpaceCount;
    const ind = pPr ? /<w:ind\b[^>]*\/?>/.exec(pPr)?.[0] : void 0;
    const twips = (name) => {
      const value = Number(new RegExp(`\\bw:${name}="(-?\\d+)"`).exec(ind ?? "")?.[1] ?? NaN);
      return Number.isFinite(value) ? value : void 0;
    };
    meta.imageParagraphIndentLeft = twips("left");
    meta.imageParagraphIndentRight = twips("right");
    meta.imageParagraphIndentFirstLine = twips("firstLine");
    if (meta.imageParagraphIndentFirstLine === void 0) {
      const hanging = twips("hanging");
      if (hanging !== void 0) meta.imageParagraphIndentFirstLine = -hanging;
    }
    const spacing = pPr ? /<w:spacing\b[^>]*\/?>/.exec(pPr)?.[0] : void 0;
    const spacingTwips = (name) => {
      const value = Number(new RegExp(`\\bw:${name}="(-?\\d+)"`).exec(spacing ?? "")?.[1] ?? NaN);
      return Number.isFinite(value) ? value : void 0;
    };
    meta.imageParagraphSpaceBefore = spacingTwips("before");
    meta.imageParagraphSpaceAfter = spacingTwips("after");
  }
  const extent = /<wp:extent[^>]*\/?>/.exec(xml)?.[0];
  if (extent) {
    const cx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? "", 10);
    const cy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? "", 10);
    if (Number.isFinite(cx) && cx > 0) meta.imageWidthPx = emuToPx(cx);
    if (Number.isFinite(cy) && cy > 0) meta.imageHeightPx = emuToPx(cy);
  }
  const effect = /<wp:inline\b[^>]*>[\s\S]*?<wp:effectExtent\b([^>]*)\/?>/.exec(xml)?.[1];
  if (effect) {
    const px = (name) => {
      const v = parseInt(new RegExp(`\\b${name}="(\\d+)"`).exec(effect)?.[1] ?? "", 10);
      return Number.isFinite(v) && v > 0 ? Math.round(v / EMU_PER_PX2 * 100) / 100 : 0;
    };
    const t = px("t");
    const b = px("b");
    if (t) meta.imageEffectExtentTopPx = t;
    if (b) meta.imageEffectExtentBottomPx = b;
  }
  const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1];
  if (jc === "center") meta.imageAlign = "center";
  else if (jc === "right" || jc === "end") meta.imageAlign = "right";
  const xf = picTransformOf(xml);
  if (xf.rotDeg !== void 0) meta.imageRotDeg = xf.rotDeg;
  if (xf.flipH) meta.imageFlipH = true;
  if (xf.flipV) meta.imageFlipV = true;
  const border = picBorderOf(xml);
  if (border) meta.imageBorder = border;
  const srcRect = /<a:srcRect\s[^>]*\/>/.exec(xml)?.[0];
  if (srcRect) {
    const crop = {
      l: rectFrac(srcRect, "l"),
      t: rectFrac(srcRect, "t"),
      r: rectFrac(srcRect, "r"),
      b: rectFrac(srcRect, "b")
    };
    if (crop.l || crop.t || crop.r || crop.b) meta.imageCrop = crop;
  }
  const effects = blipEffectsOf(xml);
  if (effects) meta.imageEffects = effects;
  const fillRect = /<a:stretch>\s*<a:fillRect\s[^>]*\/>/.exec(xml)?.[0];
  if (fillRect) {
    const fr = {
      l: rectFrac(fillRect, "l"),
      t: rectFrac(fillRect, "t"),
      r: rectFrac(fillRect, "r"),
      b: rectFrac(fillRect, "b")
    };
    if (fr.l || fr.t || fr.r || fr.b) meta.imageFillRect = fr;
  }
  const anchor = /<wp:anchor[^>]*>/.exec(xml)?.[0];
  if (anchor) {
    const wrapDistance = (attr) => {
      const value = Number(new RegExp(`\\b${attr}\\s*=\\s*["'](\\d+)["']`).exec(anchor)?.[1] ?? NaN);
      return Number.isFinite(value) ? value : void 0;
    };
    meta.imageWrapDistTopEmu = wrapDistance("distT");
    meta.imageWrapDistBottomEmu = wrapDistance("distB");
    meta.imageWrapDistLeftEmu = wrapDistance("distL");
    meta.imageWrapDistRightEmu = wrapDistance("distR");
    if (/allowOverlap\s*=\s*["'](?:0|false)["']/.test(anchor)) meta.imageNoOverlap = true;
    if (/\blocked\s*=\s*["'](?:1|true)["']/.test(anchor)) meta.imageAnchorLocked = true;
    const relHeight = Number(/relativeHeight\s*=\s*["'](\d+)["']/.exec(anchor)?.[1] ?? NaN);
    if (Number.isFinite(relHeight)) {
      const z = relHeight - 251658240;
      if (z !== 0) meta.imageZOrder = z;
    }
    if (/behindDoc\s*=\s*["']1["']/.test(anchor) && !/<wp:wrap(Square|Tight|Through|TopAndBottom)/.test(xml))
      meta.imageWrap = "behind";
    else if (/<wp:wrapTopAndBottom/.test(xml)) meta.imageWrap = "topBottom";
    else if (/<wp:wrap(Square|Tight|Through)/.test(xml)) {
      const kind = /<wp:wrap(Square|Tight|Through)/.exec(xml)[1];
      const alignRight = /<wp:positionH[^>]*>(?:(?!<\/wp:positionH>)[\s\S])*?<wp:align>right<\/wp:align>/.test(xml);
      const alignCenter = /<wp:positionH[^>]*relativeFrom\s*=\s*["']column["'][^>]*>(?:(?!<\/wp:positionH>)[\s\S])*?<wp:align>center<\/wp:align>/.test(
        xml
      );
      const wrapText = /<wp:wrap(?:Square|Tight|Through)[^>]*wrapText\s*=\s*["']([^"']+)["']/.exec(
        xml
      )?.[1];
      const posH = /<wp:positionH[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(xml)?.[1] ?? "";
      const offX = Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posH)?.[1] ?? NaN);
      const extentCx = Number(/<wp:extent[^>]*\bcx\s*=\s*["'](\d+)["']/.exec(xml)?.[1] ?? NaN);
      const centerX = offX + (Number.isFinite(extentCx) ? extentCx / 2 : 0);
      const side = alignRight || wrapText === "left" || wrapText !== "right" && centerX > 4680 * 635 ? "right" : "left";
      meta.imageWrap = alignCenter ? "topBottom" : kind === "Tight" ? `tight-${side}` : kind === "Through" ? `through-${side}` : `square-${side}`;
    } else meta.imageWrap = "front";
    const posHBody = /<wp:positionH[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(xml)?.[1] ?? "";
    const posVBody = /<wp:positionV[^>]*>([\s\S]*?)<\/wp:positionV>/.exec(xml)?.[1] ?? "";
    const offsetX = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posHBody)?.[1];
    const offsetY = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posVBody)?.[1];
    if (offsetX !== void 0) meta.imageOffsetXEmu = parseInt(offsetX, 10);
    if (offsetY !== void 0) meta.imageOffsetYEmu = parseInt(offsetY, 10);
    const posHFrom = /<wp:positionH[^>]*relativeFrom="([^"]+)"/.exec(xml)?.[1];
    const posVFrom = /<wp:positionV[^>]*relativeFrom="([^"]+)"/.exec(xml)?.[1];
    const alignH = /<wp:align>(left|center|right)<\/wp:align>/.exec(posHBody)?.[1];
    const alignV = /<wp:align>(top|center|bottom)<\/wp:align>/.exec(posVBody)?.[1];
    if ((posVFrom === "page" || posVFrom === "margin") && offsetY !== void 0 && !alignV)
      meta.imageRelV = posVFrom;
    if (posHFrom === "margin" && posVFrom === "margin" && alignH && alignV) {
      meta.imagePosH = alignH;
      meta.imagePosV = alignV;
    } else if ((posHFrom === "margin" || posHFrom === "page") && alignH && !alignV) {
      meta.imagePosH = alignH;
    }
  }
  return meta;
}
function vmlImageMeta(xml) {
  const meta = {};
  const style = /<v:shape [^>]*style="([^"]*)"/.exec(xml)?.[1] ?? "";
  const w = parseFloat(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1] ?? "");
  const h = parseFloat(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1] ?? "");
  if (w > 0) meta.imageWidthPx = Math.round(w / 72 * 96);
  if (h > 0) meta.imageHeightPx = Math.round(h / 72 * 96);
  const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1];
  if (jc === "center") meta.imageAlign = "center";
  else if (jc === "right" || jc === "end") meta.imageAlign = "right";
  if (/position:absolute/.test(style)) {
    meta.imageWrap = /z-index:\s*-/.test(style) ? "behind" : "front";
    const mx = parseFloat(/margin-left:(-?[\d.]+)pt/.exec(style)?.[1] ?? "");
    const my = parseFloat(/margin-top:(-?[\d.]+)pt/.exec(style)?.[1] ?? "");
    if (Number.isFinite(mx)) meta.imageOffsetXEmu = Math.round(mx * EMU_PER_PT);
    if (Number.isFinite(my)) meta.imageOffsetYEmu = Math.round(my * EMU_PER_PT);
    const posH = /mso-position-horizontal:(\w+)/.exec(style)?.[1];
    const posV = /mso-position-vertical:(\w+)/.exec(style)?.[1];
    const relH = /mso-position-horizontal-relative:(\w+)/.exec(style)?.[1];
    const relV = /mso-position-vertical-relative:(\w+)/.exec(style)?.[1];
    if ((relH === "margin" || relH === "page") && (relV === "margin" || relV === "page") && (posH === "left" || posH === "center" || posH === "right") && (posV === "top" || posV === "center" || posV === "bottom")) {
      meta.imagePosH = posH;
      meta.imagePosV = posV;
    }
  }
  return meta;
}
async function mediaDataUrl(zip, rels, rId, sourcePath = "word/document.xml") {
  const rel = rels.get(rId);
  if (!rel || rel.targetMode === "External") return null;
  const partPath = resolveRelationshipTargetPath(sourcePath, rel.target);
  return partPath ? mediaPartDataUrl(zip, partPath) : null;
}
var mediaDataUrlCache = /* @__PURE__ */ new WeakMap();
function mediaPartDataUrl(zip, partPath) {
  let cache = mediaDataUrlCache.get(zip);
  if (!cache) mediaDataUrlCache.set(zip, cache = /* @__PURE__ */ new Map());
  let pending = cache.get(partPath);
  if (!pending) {
    pending = readMediaPartDataUrl(zip, partPath);
    cache.set(partPath, pending);
  }
  return pending;
}
async function readMediaPartDataUrl(zip, partPath) {
  const file = zip.file(partPath);
  if (!file) return null;
  const mime = await imagePartMime(zip, partPath);
  if (!mime) return null;
  if (isMetafileMime(mime)) return metafileToDataUrl(await file.async("arraybuffer"), mime);
  if (isTiffMime(mime)) return tiffToDataUrlAsync(await file.async("arraybuffer"));
  return mediaPartSrc(zip, file, partPath, mime);
}
var lazyHashesByZip = /* @__PURE__ */ new WeakMap();
var unconvertedChunksByZip = /* @__PURE__ */ new WeakMap();
async function mediaPartSrc(zip, file, partPath, mime) {
  const declared = file._data?.uncompressedSize;
  if (declared === LAZY_MEDIA_PLACEHOLDER_BYTES) {
    const hash = lazyMediaHashOf(await file.async("uint8array"));
    if (hash) {
      let seen = lazyHashesByZip.get(zip);
      if (!seen) lazyHashesByZip.set(zip, seen = /* @__PURE__ */ new Set());
      seen.add(hash);
      return lazyMediaUrl(hash, partPath);
    }
  }
  return `data:${mime};base64,${await file.async("base64")}`;
}
async function resolvePicBullets(zip, numbering, picBullets) {
  if (picBullets.size === 0) return;
  const rels = await parseRels(zip, "word/_rels/numbering.xml.rels");
  const srcById = /* @__PURE__ */ new Map();
  for (const [id, rId] of picBullets) {
    const src = await mediaDataUrl(zip, rels, rId, "word/numbering.xml");
    if (src) srcById.set(id, src);
  }
  for (const def of numbering.values()) {
    for (const level of Object.values(def.levels)) {
      if (level.picBulletId === void 0 || level.picBulletSrc) continue;
      const src = srcById.get(level.picBulletId);
      if (src) level.picBulletSrc = src;
    }
  }
}
async function externalTxbxParts(documentXml, zip, rels, sourcePath = "word/document.xml") {
  const out = /* @__PURE__ */ new Map();
  for (const m of documentXml.matchAll(/<wps:txbx\b[^>]*\br:txbx="([^"]+)"/g)) {
    const rId = m[1];
    if (out.has(rId)) continue;
    const rel = rels.get(rId);
    if (!rel || rel.targetMode === "External") continue;
    const path = resolveRelationshipTargetPath(sourcePath, rel.target);
    const file = path ? zip.file(path) : null;
    if (file) out.set(rId, await file.async("string"));
  }
  return out;
}
async function tableBlipMedia(elements, documentXml, zip, rels, sourcePath = "word/document.xml") {
  const out = /* @__PURE__ */ new Map();
  const rIds = /* @__PURE__ */ new Set();
  for (const el of elements) {
    if (el.name !== "w:tbl" && el.name !== "w:sdt") continue;
    let slice = documentXml.slice(el.start, el.end);
    if (el.name === "w:sdt") {
      const from = slice.indexOf("<w:tbl");
      if (from === -1) continue;
      slice = slice.slice(from, slice.lastIndexOf("</w:tbl>") + "</w:tbl>".length);
    }
    for (const m of slice.matchAll(/<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']/g))
      rIds.add(m[1]);
    for (const m of slice.matchAll(/<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g)) rIds.add(m[1]);
  }
  for (const rId of rIds) {
    const rel = rels.get(rId);
    if (!rel) continue;
    if (rel.targetMode === "External" || /^https?:\/\//i.test(rel.target)) {
      out.set(rId, rel.target);
      continue;
    }
    const dataUrl = await mediaDataUrl(zip, rels, rId, sourcePath);
    if (dataUrl) out.set(rId, dataUrl);
  }
  return out;
}
var RICH_DRAWING_RE = /<c:chart|<cx:chart|<dgm:|r:dm=|<lc:lockedCanvas|<wps:wsp|<w:txbxContent/;
async function hasResolvablePicture(xml, ctx) {
  if (!/<a:blip[^>]*r:(?:embed|link)\s*=\s*["']|<v:imagedata[^>]*r:id\s*=\s*["']/.test(xml))
    return false;
  await resolveBlipMedia(xml, ctx);
  const media = ctx.mediaByRid;
  if (!media) return false;
  for (const m of xml.matchAll(
    /<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']|<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g
  )) {
    const rId = m[1] ?? m[2];
    if (rId && media.has(rId)) return true;
  }
  return false;
}
async function resolveBlipMedia(xml, ctx) {
  const media = ctx.mediaByRid;
  if (!media) return;
  const refs = [
    ...xml.matchAll(/<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/g),
    ...xml.matchAll(/<a:blip[^>]*r:link\s*=\s*["']([^"']+)["']/g),
    ...xml.matchAll(/<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g)
  ];
  for (const m of refs) {
    const rId = m[1];
    if (media.has(rId)) continue;
    const rel = ctx.rels.get(rId);
    if (!rel) continue;
    if (rel.targetMode === "External" || /^https?:\/\//i.test(rel.target)) {
      media.set(rId, rel.target);
      continue;
    }
    const dataUrl = await mediaDataUrl(
      ctx.zip,
      ctx.rels,
      rId,
      ctx.sourcePath ?? "word/document.xml"
    );
    if (dataUrl) media.set(rId, dataUrl);
  }
}
async function extractImage(xml, ctx) {
  const rId = /<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/.exec(xml)?.[1] ?? /<a:blip[^>]*r:link\s*=\s*["']([^"']+)["']/.exec(xml)?.[1];
  if (!rId) return null;
  const rel = ctx.rels.get(rId);
  if (!rel) return null;
  if (rel.targetMode === "External" || /^https?:\/\//i.test(rel.target)) {
    return rel.target;
  }
  const path = resolveRelationshipTargetPath(ctx.sourcePath ?? "word/document.xml", rel.target);
  return path ? mediaPartDataUrl(ctx.zip, path) : null;
}
function relPartPath(ctx, rId) {
  const rel = rId ? ctx.rels.get(rId) : void 0;
  if (!rel || rel.targetMode === "External") return null;
  return resolveRelationshipTargetPath(ctx.sourcePath ?? "word/document.xml", rel.target);
}
async function extractDiagramText(xml, ctx) {
  const path = relPartPath(ctx, /r:dm="([^"]+)"/.exec(xml)?.[1]);
  const file = path ? ctx.zip.file(path) : null;
  if (!file) return null;
  const dataXml = await file.async("string");
  const ptTexts = /* @__PURE__ */ new Map();
  for (const m of dataXml.matchAll(/<dgm:pt modelId="([^"]+)"([^>]*)>([\s\S]*?)<\/dgm:pt>/g)) {
    if (/type="(?:pres|parTrans|sibTrans)"/.test(m[2])) continue;
    const s = (m[3].match(/<a:t>[^<]*<\/a:t>/g) ?? []).map((t) => decodeEntities(t.slice(5, -6))).join("").trim();
    if (s) ptTexts.set(m[1], s);
  }
  const children = /* @__PURE__ */ new Map();
  const hasParent = /* @__PURE__ */ new Set();
  for (const m of dataXml.matchAll(/<dgm:cxn [^>]*\/?>/g)) {
    const tag2 = m[0];
    if (/type="(?!parOf")/.test(tag2)) continue;
    const src = /srcId="([^"]+)"/.exec(tag2)?.[1];
    const dst = /destId="([^"]+)"/.exec(tag2)?.[1];
    if (!src || !dst) continue;
    const ord = parseInt(/srcOrd="(\d+)"/.exec(tag2)?.[1] ?? "0", 10);
    if (!children.has(src)) children.set(src, []);
    children.get(src).push({ ord, id: dst });
    hasParent.add(dst);
  }
  const texts = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const t = ptTexts.get(id);
    if (t) texts.push(t);
    for (const c of (children.get(id) ?? []).sort((a, b) => a.ord - b.ord)) visit(c.id);
  };
  for (const root of children.keys()) if (!hasParent.has(root)) visit(root);
  for (const [id, t] of ptTexts) if (!seen.has(id)) texts.push(t);
  return texts.length > 0 ? texts.join("\n") : null;
}
function extractLockedCanvas(xml, ctx) {
  const ci = xml.indexOf("<lc:lockedCanvas");
  if (ci === -1) return null;
  const end = xml.indexOf("</lc:lockedCanvas>", ci);
  if (end === -1) return null;
  const extTags = [...xml.slice(0, ci).matchAll(/<wp:extent[^>]*\/?>/g)].map((m) => m[0]);
  const extTag = extTags[extTags.length - 1] ?? "";
  const extCx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extTag)?.[1] ?? "", 10);
  const extCy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extTag)?.[1] ?? "", 10);
  if (!Number.isFinite(extCx) || !Number.isFinite(extCy) || extCx <= 0 || extCy <= 0) return null;
  let parsed;
  try {
    parsed = xmlParser.parse(xml.slice(ci, end + "</lc:lockedCanvas>".length));
  } catch {
    return null;
  }
  const canvasNode = parsed.find((n) => nameOf(n) === "lc:lockedCanvas");
  if (!canvasNode) return null;
  const grpXfrm = findChild(findChild(canvasNode, "a:grpSpPr") ?? {}, "a:xfrm");
  const emuAttr = (node, name, fallback) => {
    const v = parseInt(attrsOf(node ?? {})[name] ?? "", 10);
    return Number.isFinite(v) ? v : fallback;
  };
  const chOffX = emuAttr(findChild(grpXfrm ?? {}, "a:chOff"), "x", 0);
  const chOffY = emuAttr(findChild(grpXfrm ?? {}, "a:chOff"), "y", 0);
  const chExtCx = emuAttr(findChild(grpXfrm ?? {}, "a:chExt"), "cx", extCx);
  const chExtCy = emuAttr(findChild(grpXfrm ?? {}, "a:chExt"), "cy", extCy);
  const scaleX = chExtCx > 0 ? extCx / chExtCx : 1;
  const scaleY = chExtCy > 0 ? extCy / chExtCy : 1;
  const shapes = [];
  for (const child of childrenOf(canvasNode)) {
    const name = nameOf(child);
    if (name !== "a:sp" && name !== "a:pic") continue;
    const spPr = findChild(child, "a:spPr");
    const xfrm = findChild(spPr ?? {}, "a:xfrm");
    const off = findChild(xfrm ?? {}, "a:off");
    const ext = findChild(xfrm ?? {}, "a:ext");
    if (!off || !ext) continue;
    const shape = {
      xPx: Math.round((emuAttr(off, "x", 0) - chOffX) * scaleX / EMU_PER_PX2),
      yPx: Math.round((emuAttr(off, "y", 0) - chOffY) * scaleY / EMU_PER_PX2),
      wPx: Math.round(emuAttr(ext, "cx", 0) * scaleX / EMU_PER_PX2),
      hPx: Math.round(emuAttr(ext, "cy", 0) * scaleY / EMU_PER_PX2)
    };
    if (shape.wPx <= 0 || shape.hPx <= 0) continue;
    const rot = parseInt(attrsOf(xfrm)["rot"] ?? "", 10);
    if (Number.isFinite(rot) && rot !== 0) shape.rotDeg = Math.round(rot / 6e4);
    const prst = attrsOf(findChild(spPr ?? {}, "a:prstGeom") ?? {})["prst"];
    if (prst && prst !== "rect") shape.prst = prst;
    if (name === "a:pic") {
      const rId = attrsOf(findChild(findChild(child, "a:blipFill") ?? {}, "a:blip") ?? {})["r:embed"];
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : void 0;
      if (dataUrl) shape.imageDataUrl = dataUrl;
    } else if (spPr && !findChild(spPr, "a:noFill")) {
      const fill = colorNodeHex(findChild(spPr, "a:solidFill"), ctx.themeColors) ?? gradFillApproxHex(spPr, ctx.themeColors);
      if (fill) shape.fillHex = fill;
    }
    const body = findChild(findChild(child, "a:txSp") ?? {}, "a:txBody");
    if (body) {
      const texts = [];
      let sizePt;
      let color;
      for (const p of findChildren(body, "a:p")) {
        const parts = [];
        for (const r of findChildren(p, "a:r")) {
          const t = findChild(r, "a:t");
          if (t) parts.push(decodeNumericCharRefs(textOf(t)));
          const rPr = findChild(r, "a:rPr");
          if (rPr && sizePt === void 0) {
            const sz = parseInt(attrsOf(rPr)["sz"] ?? "", 10);
            if (Number.isFinite(sz) && sz > 0) sizePt = Math.round(sz / 100);
            const c = colorNodeHex(findChild(rPr, "a:solidFill"), ctx.themeColors);
            if (c) color = c;
          }
        }
        if (parts.join("").trim() !== "") texts.push(parts.join(""));
      }
      if (texts.length > 0) {
        shape.texts = texts;
        if (sizePt) shape.fontSizePt = sizePt;
        if (color) shape.textColorHex = color;
      }
    }
    shapes.push(shape);
  }
  if (shapes.length === 0) return null;
  const textShapes = shapes.filter((s) => s.texts?.length && s.fontSizePt);
  const colGeom = (s) => {
    const fontPx = s.fontSizePt * 96 / 72;
    const charsPerLine = Math.max(1, Math.floor(s.wPx / (fontPx * 0.72)));
    const chars = (s.texts ?? []).join("").length;
    return { lines: Math.ceil(chars / charsPerLine), pitchPx: fontPx * 1.2 };
  };
  const overflowing = textShapes.filter((s) => {
    const g = colGeom(s);
    return g.lines * g.pitchPx > 2 * s.hPx;
  });
  if (overflowing.length > 0) {
    overflowing[0].yPx = 0;
    for (let i = 1; i < overflowing.length; i++) {
      const prev = overflowing[i - 1];
      const g = colGeom(prev);
      overflowing[i].yPx = Math.round(prev.yPx + Math.ceil(g.lines / 2) * g.pitchPx - 23);
    }
    for (const s of overflowing) {
      const g = colGeom(s);
      const chars = [...(s.texts ?? []).join("")];
      if (g.lines < chars.length) continue;
      const at = shapes.indexOf(s);
      if (at === -1) continue;
      const letters = chars.map((ch, i) => ({
        xPx: s.xPx,
        yPx: Math.round(s.yPx + i * g.pitchPx),
        wPx: s.wPx,
        hPx: Math.ceil(g.pitchPx),
        texts: [ch],
        ...s.fontSizePt ? { fontSizePt: s.fontSizePt } : {},
        ...s.textColorHex ? { textColorHex: s.textColorHex } : {}
      }));
      shapes.splice(at, 1, ...letters);
    }
    shapes.sort((a, b) => a.yPx - b.yPx);
  }
  return {
    widthPx: emuToPx(extCx),
    heightPx: emuToPx(extCy),
    shapes,
    canvas: true
  };
}
async function extractDiagramDrawing(xml, ctx) {
  const dmPath = relPartPath(ctx, /r:dm="([^"]+)"/.exec(xml)?.[1]);
  if (!dmPath) return null;
  const drawingPath = dmPath.replace(/data(\d*)\.xml$/, "drawing$1.xml");
  const file = drawingPath !== dmPath ? ctx.zip.file(drawingPath) : null;
  if (!file) return null;
  const dmAt = xml.indexOf('r:dm="');
  const extentTags = [
    ...(dmAt >= 0 ? xml.slice(0, dmAt) : xml).matchAll(/<wp:extent[^>]*\/?>/g)
  ].map((m) => m[0]);
  const extentTag = extentTags[extentTags.length - 1] ?? "";
  const extCx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
  const extCy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
  const extent = Number.isFinite(extCx) && Number.isFinite(extCy) ? [extCx, extCy] : void 0;
  const widthPx = extent ? Math.round(extent[0] / EMU_PER_PX2) : 0;
  const heightPx = extent ? Math.round(extent[1] / EMU_PER_PX2) : 0;
  if (!widthPx || !heightPx) return null;
  let parsed;
  try {
    parsed = xmlParser.parse(await file.async("string"));
  } catch {
    return null;
  }
  const relsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const rels = await parseRels(ctx.zip, relsPath);
  const mediaOf = async (rId) => {
    const rel = rels.get(rId);
    if (!rel || rel.targetMode === "External") return null;
    const path = resolveRelationshipTargetPath(drawingPath, rel.target);
    if (!path) return null;
    const f = ctx.zip.file(path);
    if (!f) return null;
    const mime = await imagePartMime(ctx.zip, path);
    if (!mime) return null;
    if (isMetafileMime(mime)) return metafileToDataUrl(await f.async("arraybuffer"), mime);
    return mediaPartSrc(ctx.zip, f, path, mime);
  };
  const sps = [];
  collectNodes(parsed, "dsp:sp", sps);
  const shapes = [];
  for (const sp of sps) {
    const spPr = findChild(sp, "dsp:spPr");
    if (!spPr) continue;
    const xfrm = findChild(spPr, "a:xfrm");
    const off = xfrm ? findChild(xfrm, "a:off") : void 0;
    const ext = xfrm ? findChild(xfrm, "a:ext") : void 0;
    if (!off || !ext) continue;
    const shape = {
      xPx: Math.round(parseInt(attrsOf(off)["x"] ?? "0", 10) / EMU_PER_PX2),
      yPx: Math.round(parseInt(attrsOf(off)["y"] ?? "0", 10) / EMU_PER_PX2),
      wPx: Math.round(parseInt(attrsOf(ext)["cx"] ?? "0", 10) / EMU_PER_PX2),
      hPx: Math.round(parseInt(attrsOf(ext)["cy"] ?? "0", 10) / EMU_PER_PX2)
    };
    const prst = attrsOf(findChild(spPr, "a:prstGeom") ?? {})["prst"];
    if (prst) shape.prst = prst;
    const isLine = prst === "line" || (prst?.includes("Connector") ?? false);
    if ((shape.wPx <= 0 || shape.hPx <= 0) && !(isLine && (shape.wPx > 0 || shape.hPx > 0)))
      continue;
    const rot = parseInt(attrsOf(xfrm)["rot"] ?? "", 10);
    if (Number.isFinite(rot) && rot !== 0) shape.rotDeg = Math.round(rot / 6e4);
    const ln = findChild(spPr, "a:ln");
    if (ln && !findChild(ln, "a:noFill")) {
      const lnHex = colorNodeHex(findChild(ln, "a:solidFill"), ctx.themeColors);
      if (lnHex) {
        shape.lnHex = lnHex;
        const w = parseInt(attrsOf(ln)["w"] ?? "", 10);
        shape.lnWPx = Number.isFinite(w) && w > 0 ? Math.max(1, Math.round(w / EMU_PER_PX2)) : 1;
      }
    }
    const blipFill = findChild(spPr, "a:blipFill");
    if (blipFill) {
      const rId = attrsOf(findChild(blipFill, "a:blip") ?? {})["r:embed"];
      const dataUrl = rId ? await mediaOf(rId) : null;
      if (dataUrl) {
        shape.imageDataUrl = dataUrl;
        const fr = /<a:fillRect\s[^>]*\/>/.exec(serializeXNode(blipFill))?.[0];
        if (fr) {
          const rect = {
            l: rectFrac(fr, "l"),
            t: rectFrac(fr, "t"),
            r: rectFrac(fr, "r"),
            b: rectFrac(fr, "b")
          };
          if (rect.l || rect.t || rect.r || rect.b) shape.fillRect = rect;
        }
      }
    } else {
      const solid = findChild(spPr, "a:solidFill");
      const srgb = solid ? attrsOf(findChild(solid, "a:srgbClr") ?? {})["val"] : void 0;
      const scheme = solid ? attrsOf(findChild(solid, "a:schemeClr") ?? {})["val"] : void 0;
      if (srgb) shape.fillHex = srgb;
      else if (scheme) {
        const theme = ctx.themeColors;
        shape.fillHex = theme && theme[scheme] || "9AB5E4";
      }
    }
    const body = findChild(sp, "dsp:txBody");
    if (body) {
      const texts = [];
      let sizePt;
      let color;
      for (const p of findChildren(body, "a:p")) {
        const parts = [];
        for (const r of findChildren(p, "a:r")) {
          const t = findChild(r, "a:t");
          if (t) parts.push(decodeNumericCharRefs(textOf(t)));
          const rPr = findChild(r, "a:rPr");
          if (rPr && sizePt === void 0) {
            const sz = parseInt(attrsOf(rPr)["sz"] ?? "", 10);
            if (Number.isFinite(sz) && sz > 0) sizePt = Math.round(sz / 100);
            const fill = findChild(rPr, "a:solidFill");
            const c = fill ? attrsOf(findChild(fill, "a:srgbClr") ?? {})["val"] : void 0;
            if (c) color = c;
          }
        }
        if (parts.join("").trim() !== "") texts.push(parts.join(""));
      }
      if (texts.length > 0) {
        shape.texts = texts;
        if (sizePt) shape.fontSizePt = sizePt;
        if (color) shape.textColorHex = color;
      }
    }
    shapes.push(shape);
  }
  return shapes.length > 0 ? { widthPx, heightPx, shapes } : null;
}
async function oleDisplay(xml, ctx) {
  const out = {};
  const progId = /<o:OLEObject[^>]*ProgID="([^"]+)"/.exec(xml)?.[1];
  if (progId) out.oleProgId = progId;
  const path = relPartPath(ctx, /<v:imagedata[^>]*r:id="([^"]+)"/.exec(xml)?.[1]);
  const file = path ? ctx.zip.file(path) : null;
  if (file && path) {
    const mime = await imagePartMime(ctx.zip, path);
    if (isMetafileMime(mime)) {
      const converted = await metafileToDataUrl(await file.async("arraybuffer"), mime);
      if (converted) out.imageDataUrl = converted;
    } else if (mime) {
      out.imageDataUrl = await mediaPartSrc(ctx.zip, file, path, mime);
    }
  }
  const style = /<v:shape [^>]*style="([^"]*)"/.exec(xml)?.[1] ?? "";
  const wPt = parseFloat(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1] ?? "");
  const hPt = parseFloat(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1] ?? "");
  const objAttrs = /<w:object\b[^>]*>/.exec(xml)?.[0] ?? "";
  const wTw = parseInt(/w:dxaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? "", 10);
  const hTw = parseInt(/w:dyaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? "", 10);
  const w = wPt > 0 ? wPt / 72 * 96 : wTw > 0 ? wTw / 15 : 0;
  const h = hPt > 0 ? hPt / 72 * 96 : hTw > 0 ? hTw / 15 : 0;
  if (w > 0) out.imageWidthPx = Math.round(w);
  if (h > 0) out.imageHeightPx = Math.round(h);
  const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1];
  if (jc === "center") out.imageAlign = "center";
  else if (jc === "right" || jc === "end") out.imageAlign = "right";
  return out;
}
async function extractChart(xml, ctx) {
  const rId = /<cx?:chart [^>]*r:id="([^"]+)"/.exec(xml)?.[1];
  const rel = rId ? ctx.rels.get(rId) : void 0;
  if (!rel || rel.targetMode === "External") return null;
  const path = resolveRelationshipTargetPath(ctx.sourcePath ?? "word/document.xml", rel.target);
  if (!path) return null;
  const file = ctx.zip.file(path);
  if (!file) return null;
  const partXml = await file.async("string");
  const display = parseChartPartXml(partXml, path, ctx.themeColors);
  if (display) {
    if (!partXml.includes("<cx:chartSpace")) ctx.chartParts[path] = partXml;
    const extentTag = /<wp:extent[^>]*\/?>/.exec(xml)?.[0] ?? "";
    const cx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
    const cy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? "", 10);
    if (Number.isFinite(cx) && cx > 0) display.widthPx = Math.round(cx / EMU_PER_PX2);
    if (Number.isFinite(cy) && cy > 0) display.heightPx = Math.round(cy / EMU_PER_PX2);
  }
  return display;
}

// vendor/genoffice/docx/patch.ts
import JSZip4 from "jszip";

// vendor/genoffice/docx/resource-cleanup.ts
var DOCUMENT_OWNED_REL_TYPES = /* @__PURE__ */ new Set([
  "chart",
  "diagramcolors",
  "diagramdata",
  "diagramdrawing",
  "diagramlayout",
  "diagramquickstyle",
  "hyperlink",
  "image",
  "oleobject"
]);
var RELATIONSHIP_TAG_RE = /<(?:[A-Za-z_][\w.-]*:)?Relationship\b[^>]*(?:\/\s*>|>\s*<\/(?:[A-Za-z_][\w.-]*:)?Relationship\s*>)/g;
var OVERRIDE_TAG_RE = /<(?:[A-Za-z_][\w.-]*:)?Override\b[^>]*(?:\/\s*>|>\s*<\/(?:[A-Za-z_][\w.-]*:)?Override\s*>)/g;
function xmlAttr(tag2, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag2);
  const value = match?.[1] ?? match?.[2];
  return value === void 0 ? void 0 : decodeXmlEntities2(value);
}
function decodeXmlEntities2(value) {
  const codePoint = (match, raw, radix) => {
    const value2 = parseInt(raw, radix);
    return Number.isInteger(value2) && value2 >= 0 && value2 <= 1114111 ? String.fromCodePoint(value2) : match;
  };
  return value.replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePoint(match, hex, 16)).replace(/&#(\d+);/g, (match, decimal) => codePoint(match, decimal, 10)).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function relationshipsOf(xml) {
  const relationships = [];
  for (const tag2 of xml.match(RELATIONSHIP_TAG_RE) ?? []) {
    const id = xmlAttr(tag2, "Id");
    const type = xmlAttr(tag2, "Type");
    const target = xmlAttr(tag2, "Target");
    if (!id || !type || !target) continue;
    relationships.push({
      id,
      type,
      target,
      external: xmlAttr(tag2, "TargetMode")?.toLowerCase() === "external"
    });
  }
  return relationships;
}
function relationshipTypeName(type) {
  return (type.slice(type.lastIndexOf("/") + 1) || type).toLowerCase();
}
function relationshipSourcePath(relsPath) {
  if (relsPath === "_rels/.rels") return "";
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(relsPath);
  return match ? `${match[1] ?? ""}${match[2]}` : null;
}
function relationshipPartPath(sourcePath) {
  const slash = sourcePath.lastIndexOf("/");
  const dir = slash >= 0 ? sourcePath.slice(0, slash + 1) : "";
  const filename = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
  return `${dir}_rels/${filename}.rels`;
}
function decodePartUri(uri) {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}
function normalizePartPath(path) {
  const parts = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}
function resolveTargetPath(sourcePath, target) {
  const withoutFragment = target.split("#", 1)[0];
  if (!withoutFragment || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(withoutFragment)) return null;
  const decoded = decodePartUri(withoutFragment);
  if (decoded.startsWith("/")) return normalizePartPath(decoded.slice(1));
  const slash = sourcePath.lastIndexOf("/");
  const dir = slash >= 0 ? sourcePath.slice(0, slash + 1) : "";
  return normalizePartPath(dir + decoded);
}
function isOwnedPart(path) {
  return path.startsWith("word/media/") || path.startsWith("word/charts/") || path.startsWith("word/embeddings/") || path.startsWith("word/diagrams/");
}
function referencedRelationshipIds(xml) {
  const prefixes = /* @__PURE__ */ new Set(["r"]);
  const namespaceRe = /\bxmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*\/relationships)"|'([^']*\/relationships)')/g;
  let namespace;
  while ((namespace = namespaceRe.exec(xml)) !== null) prefixes.add(namespace[1]);
  const ids = /* @__PURE__ */ new Set();
  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const attrRe = new RegExp(
      `\\b${escaped}:[A-Za-z_][\\w.-]*\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
      "g"
    );
    let attr;
    while ((attr = attrRe.exec(xml)) !== null) ids.add(decodeXmlEntities2(attr[1] ?? attr[2]));
  }
  const attributeRe = /\s[A-Za-z_][\w.:-]*\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let attribute;
  while ((attribute = attributeRe.exec(xml)) !== null) {
    const value = decodeXmlEntities2(attribute[1] ?? attribute[2]);
    if (/^rId[\w.-]*$/i.test(value)) ids.add(value);
  }
  return ids;
}
var DIAGRAM_TWIN_RE = /^(.*\/)(?:data|drawing)(\d+)\.xml$/;
function liveDiagramDrawingParts(relsXml, documentPath, referencedIds) {
  const live = /* @__PURE__ */ new Set();
  for (const tag2 of relsXml.match(RELATIONSHIP_TAG_RE) ?? []) {
    const id = xmlAttr(tag2, "Id");
    const type = xmlAttr(tag2, "Type");
    const target = xmlAttr(tag2, "Target");
    if (!id || !type || !target || !referencedIds.has(id)) continue;
    if (relationshipTypeName(type) !== "diagramdata") continue;
    const path = resolveTargetPath(documentPath, target);
    const twin = path ? DIAGRAM_TWIN_RE.exec(path) : null;
    if (twin) live.add(`${twin[1]}drawing${twin[2]}.xml`);
  }
  return live;
}
async function relationshipEdges(zip) {
  const edges = [];
  for (const path of Object.keys(zip.files)) {
    if (!path.endsWith(".rels")) continue;
    const source = relationshipSourcePath(path);
    const file = zip.file(path);
    if (source === null || !file) continue;
    for (const rel of relationshipsOf(await file.async("string"))) {
      if (rel.external) continue;
      const target = resolveTargetPath(source, rel.target);
      if (target) edges.push({ source, target });
    }
  }
  return edges;
}
function addReachableOwnedParts(starts, outgoing, allowed = null) {
  const reached = /* @__PURE__ */ new Set();
  const pending = [...starts];
  while (pending.length > 0) {
    const part = pending.pop();
    if (reached.has(part) || allowed && !allowed.has(part)) continue;
    reached.add(part);
    for (const target of outgoing.get(part) ?? []) {
      if (isOwnedPart(target) && (!allowed || allowed.has(target))) pending.push(target);
    }
  }
  return reached;
}
async function cleanupDocxOwnedResources(zip, documentPath) {
  const documentFile = zip.file(documentPath);
  const relsPath = relationshipPartPath(documentPath);
  const relsFile = zip.file(relsPath);
  if (!documentFile || !relsFile) return;
  const documentXml = await documentFile.async("string");
  const referencedIds = referencedRelationshipIds(documentXml);
  const candidateRoots = /* @__PURE__ */ new Set();
  const relsXml = await relsFile.async("string");
  const liveDrawings = liveDiagramDrawingParts(relsXml, documentPath, referencedIds);
  const cleanedRelsXml = relsXml.replace(RELATIONSHIP_TAG_RE, (tag2) => {
    const id = xmlAttr(tag2, "Id");
    const type = xmlAttr(tag2, "Type");
    if (!id || !type || referencedIds.has(id) || !DOCUMENT_OWNED_REL_TYPES.has(relationshipTypeName(type))) {
      return tag2;
    }
    const external = xmlAttr(tag2, "TargetMode")?.toLowerCase() === "external";
    const target = xmlAttr(tag2, "Target");
    const targetPath = !external && target ? resolveTargetPath(documentPath, target) : null;
    if (relationshipTypeName(type) === "diagramdrawing" && (!targetPath || !DIAGRAM_TWIN_RE.test(targetPath) || liveDrawings.has(targetPath))) {
      return tag2;
    }
    if (targetPath && isOwnedPart(targetPath)) candidateRoots.add(targetPath);
    return "";
  });
  if (cleanedRelsXml === relsXml) return;
  zip.file(relsPath, cleanedRelsXml, { date: relsFile.date });
  const edges = await relationshipEdges(zip);
  const outgoing = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const candidates = addReachableOwnedParts(
    [...candidateRoots].filter((path) => zip.file(path) !== null),
    outgoing
  );
  for (const path of [...candidates]) {
    if (!zip.file(path)) candidates.delete(path);
  }
  if (candidates.size === 0) return;
  const sharedRoots = /* @__PURE__ */ new Set();
  for (const edge of edges) {
    if (candidates.has(edge.target) && !candidates.has(edge.source)) sharedRoots.add(edge.target);
  }
  const retained = addReachableOwnedParts(sharedRoots, outgoing, candidates);
  const removed = /* @__PURE__ */ new Set();
  for (const path of candidates) {
    if (retained.has(path)) continue;
    removed.add(path);
    zip.remove(path);
    const dependencyRelsPath = relationshipPartPath(path);
    if (zip.file(dependencyRelsPath)) {
      removed.add(dependencyRelsPath);
      zip.remove(dependencyRelsPath);
    }
  }
  if (removed.size === 0) return;
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesFile = zip.file(contentTypesPath);
  if (!contentTypesFile) return;
  const contentTypesXml = await contentTypesFile.async("string");
  const cleanedContentTypesXml = contentTypesXml.replace(OVERRIDE_TAG_RE, (tag2) => {
    const partName = xmlAttr(tag2, "PartName");
    if (!partName) return tag2;
    const path = normalizePartPath(decodePartUri(partName.replace(/^\//, "")));
    return path && removed.has(path) ? "" : tag2;
  });
  if (cleanedContentTypesXml !== contentTypesXml) {
    zip.file(contentTypesPath, cleanedContentTypesXml, { date: contentTypesFile.date });
  }
}

// vendor/genoffice/docx/blank.ts
import JSZip3 from "jszip";
var XML_DECL2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
var DOC_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
var BLANK_BULLET_NUM_ID = "1";
var BLANK_ORDERED_NUM_ID = "2";
function tocStyle(level) {
  const ind = level > 1 ? `<w:ind w:left="${220 * (level - 1)}"/>` : "";
  return `<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="100"/>${ind}</w:pPr></w:style>`;
}
function headingStyle(level, sizeHalfPoints) {
  const hidden = level >= 3 ? "<w:semiHidden/><w:unhideWhenUsed/>" : "";
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/>${hidden}<w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${level <= 2 ? 240 : 160}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sizeHalfPoints}"/><w:szCs w:val="${sizeHalfPoints}"/></w:rPr></w:style>`;
}
var ACCENT_DARK = 'w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"';
var TEXT_BF = 'w:val="404040" w:themeColor="text1" w:themeTint="BF"';
var TEXT_A6 = 'w:val="595959" w:themeColor="text1" w:themeTint="A6"';
var TEXT_A5 = 'w:val="5A5A5A" w:themeColor="text1" w:themeTint="A5"';
function paraStyle(id, name, priority, pPr, rPr = "") {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="${priority}"/><w:qFormat/><w:pPr>${pPr}</w:pPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}</w:style>`;
}
function charStyle(id, name, priority, rPr) {
  return `<w:style w:type="character" w:styleId="${id}"><w:name w:val="${name}"/><w:uiPriority w:val="${priority}"/><w:qFormat/><w:rPr>${rPr}</w:rPr></w:style>`;
}
var QUICK_STYLES_XML = '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:uiPriority w:val="1"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' + paraStyle(
  "Title",
  "Title",
  10,
  '<w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/>',
  '<w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/>'
) + paraStyle(
  "Subtitle",
  "Subtitle",
  11,
  '<w:spacing w:after="160"/>',
  `<w:color ${TEXT_A6}/><w:spacing w:val="15"/><w:sz w:val="28"/><w:szCs w:val="28"/>`
) + charStyle("SubtleEmphasis", "Subtle Emphasis", 19, `<w:i/><w:iCs/><w:color ${TEXT_BF}/>`) + charStyle("Emphasis", "Emphasis", 20, "<w:i/><w:iCs/>") + charStyle("IntenseEmphasis", "Intense Emphasis", 21, `<w:i/><w:iCs/><w:color ${ACCENT_DARK}/>`) + charStyle("Strong", "Strong", 22, "<w:b/><w:bCs/>") + paraStyle(
  "Quote",
  "Quote",
  29,
  '<w:spacing w:before="200" w:after="480"/><w:jc w:val="center"/>',
  `<w:i/><w:iCs/><w:color ${TEXT_BF}/>`
) + paraStyle(
  "IntenseQuote",
  "Intense Quote",
  30,
  `<w:pBdr><w:top w:val="single" w:sz="4" w:space="10" w:color="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:bottom w:val="single" w:sz="4" w:space="10" w:color="2F5496" w:themeColor="accent1" w:themeShade="BF"/></w:pBdr><w:spacing w:before="360" w:after="440"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/>`,
  `<w:i/><w:iCs/><w:color ${ACCENT_DARK}/>`
) + charStyle("SubtleReference", "Subtle Reference", 31, `<w:smallCaps/><w:color ${TEXT_A5}/>`) + charStyle(
  "IntenseReference",
  "Intense Reference",
  32,
  `<w:b/><w:bCs/><w:smallCaps/><w:color ${ACCENT_DARK}/><w:spacing w:val="5"/>`
) + charStyle("BookTitle", "Book Title", 33, '<w:b/><w:bCs/><w:i/><w:iCs/><w:spacing w:val="5"/>') + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>';
var stylesXml = (eastAsiaFont) => XML_DECL2 + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"${eastAsiaFont ? ` w:eastAsia="${eastAsiaFont}"` : ""} w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` + headingStyle(1, 32) + headingStyle(2, 28) + headingStyle(3, 26) + headingStyle(4, 24) + headingStyle(5, 22) + headingStyle(6, 22) + QUICK_STYLES_XML + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' + Array.from({ length: 9 }, (_, i) => tocStyle(i + 1)).join("") + "</w:styles>";
function bulletLevels() {
  let xml = "";
  for (let ilvl = 0; ilvl < 5; ilvl++) {
    xml += `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>`;
  }
  return xml;
}
function decimalLevels() {
  let xml = "";
  for (let ilvl = 0; ilvl < 5; ilvl++) {
    xml += `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  }
  return xml;
}
var LVL_CHILD_ORDER = [
  "w:start",
  "w:numFmt",
  "w:lvlRestart",
  "w:pStyle",
  "w:isLgl",
  "w:suff",
  "w:lvlText",
  "w:lvlPicBulletId",
  "w:legacy",
  "w:lvlJc",
  "w:pPr",
  "w:rPr"
];
function splitChildren(inner) {
  const out = [];
  const re = /<([\w:]+)\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/\1>)/g;
  for (const m of inner.matchAll(re)) out.push([m[1], m[0]]);
  return out;
}
function innerOf(xml) {
  const open = xml.indexOf(">");
  const close = xml.lastIndexOf("</");
  return xml.endsWith("/>") || close < 0 ? "" : xml.slice(open + 1, close);
}
function mergeLevelXml(existing, l, ilvl) {
  const children = new Map(splitChildren(innerOf(existing)));
  const set = (name, xml) => {
    if (xml === null) children.delete(name);
    else children.set(name, xml);
  };
  set("w:start", `<w:start w:val="${l.start ?? 1}"/>`);
  set("w:numFmt", `<w:numFmt w:val="${escAttr(l.numFmt)}"/>`);
  if (l.lvlRestart !== void 0) set("w:lvlRestart", `<w:lvlRestart w:val="${l.lvlRestart}"/>`);
  if (l.pStyle !== void 0)
    set("w:pStyle", l.pStyle ? `<w:pStyle w:val="${escAttr(l.pStyle)}"/>` : null);
  if (l.isLgl !== void 0) set("w:isLgl", l.isLgl ? "<w:isLgl/>" : null);
  if (l.suff !== void 0) set("w:suff", l.suff === "tab" ? null : `<w:suff w:val="${l.suff}"/>`);
  set("w:lvlText", `<w:lvlText w:val="${escAttr(l.lvlText)}"/>`);
  if (l.picBulletId !== void 0)
    set("w:lvlPicBulletId", `<w:lvlPicBulletId w:val="${l.picBulletId}"/>`);
  set("w:lvlJc", `<w:lvlJc w:val="${l.lvlJc ?? "left"}"/>`);
  const pPr = new Map(splitChildren(innerOf(children.get("w:pPr") ?? "")));
  const hanging = Math.round(l.hanging ?? 360);
  pPr.set("w:ind", `<w:ind w:left="${Math.round(l.indentLeft)}" w:hanging="${hanging}"/>`);
  if (l.tabStop !== void 0)
    pPr.set("w:tabs", `<w:tabs><w:tab w:val="num" w:pos="${Math.round(l.tabStop)}"/></w:tabs>`);
  const pPrOrder = ["w:tabs", "w:ind"];
  const pPrXml = [...pPr.entries()].sort((a, b) => pPrOrder.indexOf(a[0]) - pPrOrder.indexOf(b[0])).map(([, xml]) => xml).join("");
  set("w:pPr", `<w:pPr>${pPrXml}</w:pPr>`);
  const rPr = new Map(splitChildren(innerOf(children.get("w:rPr") ?? "")));
  if (l.font !== void 0) {
    const f = escAttr(l.font);
    if (l.font)
      rPr.set(
        "w:rFonts",
        `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}" w:hint="default"/>`
      );
    else rPr.delete("w:rFonts");
  }
  const toggle = (name, on, xml) => {
    if (on === void 0) return;
    if (on) rPr.set(name, xml);
    else rPr.delete(name);
  };
  toggle("w:b", l.bold, "<w:b/>");
  toggle("w:i", l.italic, "<w:i/>");
  if (l.color !== void 0) {
    if (l.color) rPr.set("w:color", `<w:color w:val="${escAttr(l.color)}"/>`);
    else rPr.delete("w:color");
  }
  if (l.szHalfPoints !== void 0) {
    if (l.szHalfPoints) {
      rPr.set("w:sz", `<w:sz w:val="${l.szHalfPoints}"/>`);
      rPr.set("w:szCs", `<w:szCs w:val="${l.szHalfPoints}"/>`);
    } else {
      rPr.delete("w:sz");
      rPr.delete("w:szCs");
    }
  }
  const rPrOrder = ["w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:color", "w:sz", "w:szCs"];
  const rPrXml = [...rPr.entries()].sort((a, b) => {
    const ia = rPrOrder.indexOf(a[0]);
    const ib = rPrOrder.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }).map(([, xml]) => xml).join("");
  set("w:rPr", rPrXml ? `<w:rPr>${rPrXml}</w:rPr>` : null);
  const body = [...children.entries()].sort((a, b) => {
    const ia = LVL_CHILD_ORDER.indexOf(a[0]);
    const ib = LVL_CHILD_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }).map(([, xml]) => xml).join("");
  const openTag = /<w:lvl\b[^>]*>/.exec(existing)?.[0] ?? `<w:lvl w:ilvl="${ilvl}">`;
  return `${openTag.replace(/\/>$/, ">")}${body}</w:lvl>`;
}
var escAttr = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function customLevelXml(l, ilvl) {
  const parts = [`<w:start w:val="${l.start ?? 1}"/>`, `<w:numFmt w:val="${escAttr(l.numFmt)}"/>`];
  if (l.lvlRestart !== void 0) parts.push(`<w:lvlRestart w:val="${l.lvlRestart}"/>`);
  if (l.pStyle) parts.push(`<w:pStyle w:val="${escAttr(l.pStyle)}"/>`);
  if (l.isLgl) parts.push("<w:isLgl/>");
  if (l.suff && l.suff !== "tab") parts.push(`<w:suff w:val="${l.suff}"/>`);
  parts.push(`<w:lvlText w:val="${escAttr(l.lvlText)}"/>`);
  if (l.picBulletId !== void 0) parts.push(`<w:lvlPicBulletId w:val="${l.picBulletId}"/>`);
  parts.push(`<w:lvlJc w:val="${l.lvlJc ?? "left"}"/>`);
  const tabs = l.tabStop !== void 0 ? `<w:tabs><w:tab w:val="num" w:pos="${Math.round(l.tabStop)}"/></w:tabs>` : "";
  const hanging = Math.round(l.hanging ?? 360);
  parts.push(
    `<w:pPr>${tabs}<w:ind w:left="${Math.round(l.indentLeft)}" w:hanging="${hanging}"/></w:pPr>`
  );
  const rPr = [];
  if (l.font) {
    const f = escAttr(l.font);
    rPr.push(
      `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}" w:hint="default"/>`
    );
  }
  if (l.bold) rPr.push("<w:b/>");
  if (l.italic) rPr.push("<w:i/>");
  if (l.color) rPr.push(`<w:color w:val="${escAttr(l.color)}"/>`);
  if (l.szHalfPoints)
    rPr.push(`<w:sz w:val="${l.szHalfPoints}"/><w:szCs w:val="${l.szHalfPoints}"/>`);
  if (rPr.length) parts.push(`<w:rPr>${rPr.join("")}</w:rPr>`);
  return `<w:lvl w:ilvl="${ilvl}">${parts.join("")}</w:lvl>`;
}
function customLevels(levels) {
  return levels.map((l, ilvl) => customLevelXml(l, ilvl)).join("");
}
function numPicBulletXml(id, rId) {
  return `<w:numPicBullet w:numPicBulletId="${id}"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="152400" cy="152400"/><wp:docPr id="${id}" name="Picture bullet ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture bullet ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="152400" cy="152400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:numPicBullet>`;
}
function abstractNumXml(abstractNumId, kind, levels) {
  const body = levels?.length ? customLevels(levels) : kind === "bullet" ? bulletLevels() : decimalLevels();
  return `<w:abstractNum w:abstractNumId="${abstractNumId}">${body}</w:abstractNum>`;
}
var BLANK_NUMBERING_XML = XML_DECL2 + `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">${bulletLevels()}</w:abstractNum><w:abstractNum w:abstractNumId="1">${decimalLevels()}</w:abstractNum><w:num w:numId="${BLANK_BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="${BLANK_ORDERED_NUM_ID}"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
var NUMBERING_XML = BLANK_NUMBERING_XML;
var PAPER_TWIPS = {
  A4: { w: 11906, h: 16838 },
  Letter: { w: 12240, h: 15840 }
};
async function buildBlankDocx(options) {
  const zip = new JSZip3();
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL2}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `${XML_DECL2}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `${XML_DECL2}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
  );
  zip.file("word/styles.xml", stylesXml(options?.eastAsiaFont));
  zip.file("word/numbering.xml", NUMBERING_XML);
  const paper = PAPER_TWIPS[options?.paperSize ?? "A4"];
  const sectPr = `<w:sectPr><w:pgSz w:w="${paper.w}" w:h="${paper.h}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  zip.file(
    "word/document.xml",
    `${XML_DECL2}<w:document ${DOC_NS}><w:body><w:p/>${sectPr}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// vendor/genoffice/docx/field-balance.ts
function opaqueEnd2(xml, start) {
  if (xml.startsWith("<!--", start)) {
    const at = xml.indexOf("-->", start + 4);
    return at === -1 ? xml.length : at + 3;
  }
  if (xml.startsWith("<![CDATA[", start)) {
    const at = xml.indexOf("]]>", start + 9);
    return at === -1 ? xml.length : at + 3;
  }
  if (xml.startsWith("<?", start)) {
    const at = xml.indexOf("?>", start + 2);
    return at === -1 ? xml.length : at + 2;
  }
  if (!xml.startsWith("<!", start)) return null;
  let quote = "";
  let subsetDepth = 0;
  for (let index = start + 2; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      subsetDepth += 1;
    } else if (character === "]") {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === ">" && subsetDepth === 0) {
      return index + 1;
    }
  }
  return xml.length;
}
function tagEnd(xml, start) {
  let quote = "";
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return xml.length;
}
function nextTag(xml, cursor) {
  const start = xml.indexOf("<", cursor);
  if (start === -1) return null;
  const opaque = opaqueEnd2(xml, start);
  if (opaque !== null) return { start, end: opaque, text: "" };
  const end = tagEnd(xml, start);
  return { start, end, text: xml.slice(start, end) };
}
function fieldTokens(xml) {
  const tokens = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const tag2 = nextTag(xml, cursor);
    if (tag2 === null) break;
    cursor = tag2.end;
    if (tag2.text === "") continue;
    if (/^<w:p(?:\s|>)/.test(tag2.text)) {
      tokens.push({ start: tag2.start, kind: "p-open", selfClosing: tag2.text.endsWith("/>") });
    } else if (/^<\/w:p\s*>/.test(tag2.text)) {
      tokens.push({ start: tag2.start, kind: "p-close" });
    } else if (/^<w:fldChar\b/.test(tag2.text)) {
      const match = /\bw:fldCharType\s*=\s*(?:"(begin|separate|end)"|'(begin|separate|end)')/.exec(
        tag2.text
      );
      const fieldType = match?.[1] ?? match?.[2];
      if (fieldType) tokens.push({ start: tag2.start, kind: "field", fieldType });
    }
  }
  return tokens;
}
function runBounds(xml, at, scanFrom = 0) {
  let open = -1;
  let cursor = scanFrom;
  while (cursor < at) {
    const tag2 = nextTag(xml, cursor);
    if (tag2 === null) break;
    cursor = tag2.end;
    if (tag2.text === "" || tag2.start >= at) continue;
    if (/^<w:r(?:\s|>)/.test(tag2.text) && !tag2.text.endsWith("/>")) open = tag2.start;
    else if (/^<\/w:r\s*>/.test(tag2.text)) open = -1;
  }
  if (open === -1) return null;
  let closeCursor = at;
  while (closeCursor < xml.length) {
    const tag2 = nextTag(xml, closeCursor);
    if (tag2 === null) break;
    closeCursor = tag2.end;
    if (tag2.text !== "" && /^<\/w:r\s*>/.test(tag2.text)) return [open, tag2.end];
  }
  return null;
}
function balanceFieldChars(bodyXml) {
  if (!bodyXml.includes("w:fldCharType")) return bodyXml;
  const edits = [];
  const open = [];
  let depth = 0;
  let scanCursor = 0;
  for (const token of fieldTokens(bodyXml)) {
    if (token.kind === "p-close") {
      for (const field of open) {
        if (field.depth === depth && field.paraEnd === null) field.paraEnd = token.start;
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.kind === "p-open") {
      if (!token.selfClosing) depth += 1;
      continue;
    }
    if (token.fieldType === "begin") {
      open.push({ depth, paraEnd: null });
    } else if (token.fieldType === "end" && open.length > 0) {
      open.pop();
    } else {
      if (token.fieldType === "separate" && open.length > 0) continue;
      const bounds = runBounds(bodyXml, token.start, scanCursor);
      if (bounds) edits.push({ start: bounds[0], end: bounds[1], text: "" });
      scanCursor = token.start;
    }
  }
  for (const field of open) {
    const at = field.paraEnd ?? bodyXml.length;
    edits.push({ start: at, end: at, text: '<w:r><w:fldChar w:fldCharType="end"/></w:r>' });
  }
  if (edits.length === 0) return bodyXml;
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let tail = "";
  let pos = bodyXml.length;
  for (const edit of edits) {
    tail = edit.text + bodyXml.slice(edit.end, pos) + tail;
    pos = edit.start;
  }
  return bodyXml.slice(0, pos) + tail;
}

// vendor/genoffice/docx/style-upsert.ts
var STYLE_CHILD_ORDER = [
  "w:name",
  "w:aliases",
  "w:basedOn",
  "w:next",
  "w:link",
  "w:autoRedefine",
  "w:hidden",
  "w:uiPriority",
  "w:semiHidden",
  "w:unhideWhenUsed",
  "w:qFormat",
  "w:locked",
  "w:personal",
  "w:personalCompose",
  "w:personalReply",
  "w:rsid",
  "w:pPr",
  "w:rPr",
  "w:tblPr",
  "w:trPr",
  "w:tcPr",
  "w:tblStylePr"
];
function parseTag(xml) {
  const m = /^<([A-Za-z0-9:._-]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(xml);
  if (!m) throw new Error(`style-upsert: not an element: ${xml.slice(0, 40)}`);
  const attrs = /* @__PURE__ */ new Map();
  for (const a of m[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = a[2] !== void 0 ? a[2] : a[3].replace(/"/g, "&quot;");
    attrs.set(a[1], value);
  }
  return { name: m[1], attrs, selfClosing: m[3] === "/" };
}
function tag(name, attrs, inner) {
  const a = [...attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
  return inner === void 0 ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`;
}
function innerOf2(xml) {
  const { selfClosing } = parseTag(xml);
  if (selfClosing) return "";
  return xml.slice(xml.indexOf(">") + 1, xml.lastIndexOf("</"));
}
var Children = class {
  constructor(items, order) {
    this.items = items;
    this.order = order;
  }
  get(name) {
    return this.items.find((c) => c.name === name);
  }
  set(name, xml) {
    const at = this.items.findIndex((c) => c.name === name);
    if (xml === null) {
      if (at >= 0) this.items.splice(at, 1);
    } else if (at >= 0) this.items[at] = { name, xml };
    else this.items.push({ name, xml });
  }
  /** self-closing on/off element: true = present, false = w:val="0" */
  flag(name, on) {
    if (on === void 0) return;
    this.set(name, on ? `<${name}/>` : `<${name} w:val="0"/>`);
  }
  /** merge attributes into a self-closing element; null attribute values remove */
  attrs(name, patch) {
    const cur = this.get(name);
    const attrs = cur ? parseTag(cur.xml).attrs : /* @__PURE__ */ new Map();
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) attrs.delete(k);
      else attrs.set(k, v);
    }
    this.set(name, attrs.size === 0 ? null : tag(name, attrs));
  }
  toXml() {
    const rank = (n) => {
      const i = this.order.indexOf(n);
      return i < 0 ? this.order.length : i;
    };
    return [...this.items].sort((a, b) => rank(a.name) - rank(b.name)).map((c) => c.xml).join("");
  }
  get size() {
    return this.items.length;
  }
};
var num = (n) => {
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${String(n)}`);
  return String(Math.round(n));
};
function clampFontSizeHalfPoints(v) {
  if (Number.isNaN(v)) return 2;
  return Math.min(3276, Math.max(2, Math.round(v)));
}
function patchRun(children, rp) {
  children.flag("w:b", rp.bold);
  children.flag("w:bCs", rp.bold);
  children.flag("w:i", rp.italic);
  children.flag("w:iCs", rp.italic);
  children.flag("w:strike", rp.strike);
  children.flag("w:caps", rp.caps);
  children.flag("w:smallCaps", rp.smallCaps);
  if (rp.underline !== void 0)
    children.set("w:u", `<w:u w:val="${rp.underline ? "single" : "none"}"/>`);
  if (rp.color !== void 0) {
    children.set(
      "w:color",
      rp.color === null ? null : `<w:color w:val="${escapeXmlAttr(rp.color)}"/>`
    );
  }
  if (rp.highlight !== void 0) {
    children.set(
      "w:highlight",
      rp.highlight === null ? null : `<w:highlight w:val="${escapeXmlAttr(rp.highlight)}"/>`
    );
  }
  if (rp.sizeHalfPoints !== void 0) {
    const sz = rp.sizeHalfPoints === null ? null : clampFontSizeHalfPoints(rp.sizeHalfPoints);
    children.set("w:sz", sz === null ? null : `<w:sz w:val="${sz}"/>`);
    children.set("w:szCs", sz === null ? null : `<w:szCs w:val="${sz}"/>`);
  }
  const fonts = {};
  if (rp.font !== void 0) {
    const f = rp.font === null ? null : escapeXmlAttr(rp.font);
    Object.assign(fonts, {
      "w:ascii": f,
      "w:hAnsi": f,
      "w:asciiTheme": null,
      "w:hAnsiTheme": null
    });
  }
  if (rp.eastAsiaFont !== void 0) {
    fonts["w:eastAsia"] = rp.eastAsiaFont === null ? null : escapeXmlAttr(rp.eastAsiaFont);
    fonts["w:eastAsiaTheme"] = null;
  }
  if (Object.keys(fonts).length > 0) children.attrs("w:rFonts", fonts);
}
function patchPara(children, pp) {
  if (pp.numPr !== void 0) {
    children.set(
      "w:numPr",
      pp.numPr === null ? null : `<w:numPr><w:ilvl w:val="${pp.numPr.ilvl}"/><w:numId w:val="${pp.numPr.numId}"/></w:numPr>`
    );
  }
  if (pp.align !== void 0) {
    children.set(
      "w:jc",
      pp.align === null ? null : `<w:jc w:val="${pp.align === "justify" ? "both" : pp.align}"/>`
    );
  }
  const spacing = {};
  if (pp.spaceBeforeTwips !== void 0)
    spacing["w:before"] = pp.spaceBeforeTwips === null ? null : num(pp.spaceBeforeTwips);
  if (pp.spaceAfterTwips !== void 0)
    spacing["w:after"] = pp.spaceAfterTwips === null ? null : num(pp.spaceAfterTwips);
  if (pp.lineSpacing !== void 0) {
    spacing["w:line"] = pp.lineSpacing === null ? null : num(pp.lineSpacing * 240);
    spacing["w:lineRule"] = pp.lineSpacing === null ? null : "auto";
  }
  if (Object.keys(spacing).length > 0) children.attrs("w:spacing", spacing);
  const ind = {};
  if (pp.indentLeftTwips !== void 0) {
    ind["w:left"] = pp.indentLeftTwips === null ? null : num(pp.indentLeftTwips);
    ind["w:start"] = null;
  }
  if (pp.indentRightTwips !== void 0) {
    ind["w:right"] = pp.indentRightTwips === null ? null : num(pp.indentRightTwips);
    ind["w:end"] = null;
  }
  if (pp.firstLineTwips !== void 0) {
    const v = pp.firstLineTwips;
    ind["w:firstLine"] = v !== null && v > 0 ? num(v) : null;
    ind["w:hanging"] = v !== null && v < 0 ? num(-v) : null;
  }
  if (Object.keys(ind).length > 0) children.attrs("w:ind", ind);
  children.flag("w:keepNext", pp.keepNext);
  children.flag("w:keepLines", pp.keepLines);
  children.flag("w:pageBreakBefore", pp.pageBreakBefore);
  if (pp.outlineLevel !== void 0) {
    children.set(
      "w:outlineLvl",
      pp.outlineLevel === null ? null : `<w:outlineLvl w:val="${num(pp.outlineLevel - 1)}"/>`
    );
  }
}
function mergeStyleXml(existing, up) {
  const creating = existing === null;
  const attrs = creating ? /* @__PURE__ */ new Map([
    ["w:type", up.type ?? "paragraph"],
    ["w:styleId", escapeXmlAttr(up.styleId)],
    ["w:customStyle", "1"]
  ]) : parseTag(existing).attrs;
  const children = new Children(
    creating ? [] : splitXmlChildren(innerOf2(existing)),
    STYLE_CHILD_ORDER
  );
  const name = up.name ?? (creating ? up.styleId : void 0);
  if (name !== void 0) children.set("w:name", `<w:name w:val="${escapeXmlAttr(name)}"/>`);
  if (up.basedOn !== void 0) {
    children.set(
      "w:basedOn",
      up.basedOn === null ? null : `<w:basedOn w:val="${escapeXmlAttr(up.basedOn)}"/>`
    );
  }
  if (up.next !== void 0) {
    children.set("w:next", up.next === null ? null : `<w:next w:val="${escapeXmlAttr(up.next)}"/>`);
  }
  const quick = up.quickFormat ?? (creating ? true : void 0);
  if (quick !== void 0) children.set("w:qFormat", quick ? "<w:qFormat/>" : null);
  if (up.pPr) {
    const cur = children.get("w:pPr");
    const inner = new Children(cur ? splitXmlChildren(innerOf2(cur.xml)) : [], PPR_CHILD_ORDER);
    patchPara(inner, up.pPr);
    children.set("w:pPr", inner.size ? `<w:pPr>${inner.toXml()}</w:pPr>` : null);
  }
  if (up.rPr) {
    const cur = children.get("w:rPr");
    const inner = new Children(cur ? splitXmlChildren(innerOf2(cur.xml)) : [], RPR_CHILD_ORDER);
    patchRun(inner, up.rPr);
    children.set("w:rPr", inner.size ? `<w:rPr>${inner.toXml()}</w:rPr>` : null);
  }
  return tag("w:style", attrs, children.toXml());
}
function upsertStyleXml(xml, up) {
  const escapedId = up.styleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(
    `<w:style\\b[^>]*\\bw:styleId=(["'])${escapedId}\\1[^>]*(?:\\/>|>[\\s\\S]*?<\\/w:style>)`
  );
  const match = existing.exec(xml);
  const styleXml = mergeStyleXml(match?.[0] ?? null, up);
  return match ? xml.replace(existing, () => styleXml) : xml.replace("</w:styles>", `${styleXml}</w:styles>`);
}
function mergeDefaultFontsXml(xml, fonts) {
  const declaration = xml.slice(0, xml.indexOf("<w:styles"));
  const root = xml.slice(xml.indexOf("<w:styles"));
  const styles = new Children(splitXmlChildren(innerOf2(root)), [
    "w:docDefaults",
    "w:latentStyles",
    "w:style"
  ]);
  const defaults = new Children(
    splitXmlChildren(innerOf2(styles.get("w:docDefaults")?.xml ?? "<w:docDefaults/>")),
    ["w:rPrDefault", "w:pPrDefault"]
  );
  const runDefault = new Children(
    splitXmlChildren(innerOf2(defaults.get("w:rPrDefault")?.xml ?? "<w:rPrDefault/>")),
    ["w:rPr"]
  );
  const run2 = new Children(
    splitXmlChildren(innerOf2(runDefault.get("w:rPr")?.xml ?? "<w:rPr/>")),
    RPR_CHILD_ORDER
  );
  patchRun(run2, fonts);
  runDefault.set("w:rPr", `<w:rPr>${run2.toXml()}</w:rPr>`);
  defaults.set("w:rPrDefault", `<w:rPrDefault>${runDefault.toXml()}</w:rPrDefault>`);
  styles.set("w:docDefaults", `<w:docDefaults>${defaults.toXml()}</w:docDefaults>`);
  return declaration + tag("w:styles", parseTag(root).attrs, styles.toXml());
}

// vendor/genoffice/docx/patch.ts
var RELATIONSHIP_ID_NUMBER = /\bId\s*=\s*(["'])rId(\d+)\1/g;
var RELATIONSHIP_ID = /\bId\s*=\s*(["'])([^"']*)\1/;
var RELATIONSHIP_TARGET = /\bTarget\s*=\s*(["'])([^"']*)\1/;
var RELATIONSHIP_TAG = /<Relationship\b[^>]*\/>/g;
var DRAWING_DOCPR_ID = /<wp:docPr\s[^>]*?\bid\s*=\s*(["'])(\d+)\1/g;
var BOOKMARK_ID = /<w:bookmark(?:Start|End)\s[^>]*?\bid\s*=\s*(["'])(\d+)\1/g;
var DOCPR_ID_BASE = 9e3;
var SETTINGS_CHILD_ORDER = [
  "writeProtection",
  "view",
  "zoom",
  "removePersonalInformation",
  "removeDateAndTime",
  "doNotDisplayPageBoundaries",
  "displayBackgroundShape",
  "printPostScriptOverText",
  "printFractionalCharacterWidth",
  "printFormsData",
  "embedTrueTypeFonts",
  "embedSystemFonts",
  "saveSubsetFonts",
  "saveFormsData",
  "mirrorMargins",
  "alignBordersAndEdges",
  "bordersDoNotSurroundHeader",
  "bordersDoNotSurroundFooter",
  "gutterAtTop",
  "hideSpellingErrors",
  "hideGrammaticalErrors",
  "activeWritingStyle",
  "proofState",
  "formsDesign",
  "attachedTemplate",
  "linkStyles",
  "stylePaneFormatFilter",
  "stylePaneSortMethod",
  "documentType",
  "mailMerge",
  "revisionView",
  "trackChanges",
  "doNotTrackMoves",
  "doNotTrackFormatting",
  "documentProtection",
  "autoFormatOverride",
  "styleLockTheme",
  "styleLockQFSet",
  "defaultTabStop",
  "autoHyphenation",
  "consecutiveHyphenLimit",
  "hyphenationZone",
  "doNotHyphenateCaps",
  "showEnvelope",
  "summaryLength",
  "clickAndTypeStyle",
  "defaultTableStyle",
  "evenAndOddHeaders",
  "bookFoldRevPrinting",
  "bookFoldPrinting",
  "bookFoldPrintingSheets",
  "drawingGridHorizontalSpacing",
  "drawingGridVerticalSpacing",
  "displayHorizontalDrawingGridEvery",
  "displayVerticalDrawingGridEvery",
  "doNotUseMarginsForDrawingGridOrigin",
  "drawingGridHorizontalOrigin",
  "drawingGridVerticalOrigin",
  "doNotShadeFormData",
  "noPunctuationKerning",
  "characterSpacingControl",
  "printTwoOnOne",
  "strictFirstAndLastChars",
  "noLineBreaksAfter",
  "noLineBreaksBefore",
  "savePreviewPicture",
  "doNotValidateAgainstSchema",
  "saveInvalidXml",
  "ignoreMixedContent",
  "alwaysShowPlaceholderText",
  "doNotDemarcateInvalidXml",
  "saveXmlDataOnly",
  "useXSLTWhenSaving",
  "saveThroughXslt",
  "showXMLTags",
  "alwaysMergeEmptyNamespace",
  "updateFields",
  "hdrShapeDefaults",
  "footnotePr",
  "endnotePr",
  "compat",
  "docVars",
  "rsids",
  "mathPr",
  "uiCompat97To2003",
  "attachedSchema",
  "themeFontLang",
  "clrSchemeMapping",
  "doNotIncludeSubdocsInStats",
  "doNotAutoCompressPictures",
  "forceUpgrade",
  "captions",
  "readModeInkLockDown",
  "smartTagType",
  "schemaLibrary",
  "shapeDefaults",
  "doNotEmbedSmartTags",
  "decimalSymbol",
  "listSeparator"
];
var ELEMENT_LOCAL_NAME = /<(?:[A-Za-z0-9._-]+:)?([A-Za-z0-9._-]+)[\s/>]/g;
function settingsChildRank(localName) {
  return SETTINGS_CHILD_ORDER.indexOf(localName);
}
function insertSettingsChild(xml, localName, childXml) {
  const rank = settingsChildRank(localName);
  for (const m of xml.matchAll(ELEMENT_LOCAL_NAME)) {
    if (settingsChildRank(m[1]) > rank) {
      const at = m.index;
      return xml.slice(0, at) + childXml + xml.slice(at);
    }
  }
  const close = xml.match(/<\/(?:[A-Za-z0-9._-]+:)?settings>/);
  if (close?.index !== void 0) {
    return xml.slice(0, close.index) + childXml + xml.slice(close.index);
  }
  return xml.replace(/(<([A-Za-z0-9._-]+:)?settings\b[^>]*>)/, `$1${childXml}`);
}
var relTagWithId = (id) => new RegExp(`<Relationship\\s[^>]*\\bId\\s*=\\s*(["'])${id}\\1[^>]*/>`);
var RELATIONSHIP_TAG_MARKER = /<Relationship\s/;
var RELATIONSHIP_TAG_ID = /\bId\s*=\s*(["'])(rId\d+)\1/g;
var occupiedRelIds = (relsXml) => {
  const taken = /* @__PURE__ */ new Set();
  let pos = 0;
  while (pos < relsXml.length) {
    const gt = relsXml.indexOf(">", pos);
    if (gt === -1) break;
    if (relsXml[gt - 1] === "/") {
      const chunk = relsXml.slice(pos, gt);
      const marker = chunk.search(RELATIONSHIP_TAG_MARKER);
      if (marker !== -1) {
        RELATIONSHIP_TAG_ID.lastIndex = marker;
        let m;
        while ((m = RELATIONSHIP_TAG_ID.exec(chunk)) !== null) taken.add(m[2]);
      }
    }
    pos = gt + 1;
  }
  return taken;
};
var nextFreeRelId = (relsXml) => {
  const taken = occupiedRelIds(relsXml);
  let n = 1;
  while (taken.has(`rId${n}`)) n++;
  return `rId${n}`;
};
var HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
var IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
var HF_REL_TYPE = {
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
};
var NUMBERING_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
var COMMENTS_EXT_REL_TYPE = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
var COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
var SETTINGS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings";
var CHART_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
var CHART_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
var XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function replaceAbstractNumLevel(xml, abstractNumId, ilvl, level) {
  const absRe = new RegExp(
    `<w:abstractNum [^>]*w:abstractNumId="${abstractNumId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?</w:abstractNum>`
  );
  const abs = absRe.exec(xml);
  if (!abs) return xml;
  const lvlRe = new RegExp(
    `<w:lvl [^>]*w:ilvl="${ilvl}"[^>]*>[\\s\\S]*?</w:lvl>|<w:lvl [^>]*w:ilvl="${ilvl}"[^>]*/>`
  );
  let body = abs[0];
  const existing = lvlRe.exec(body)?.[0];
  if (existing) body = body.replace(existing, mergeLevelXml(existing, level, ilvl));
  else {
    const lvlXml = customLevelXml(level, ilvl);
    const later = new RegExp(`<w:lvl [^>]*w:ilvl="(\\d)"`, "g");
    let insertAt = body.lastIndexOf("</w:abstractNum>");
    for (const m of body.matchAll(later)) {
      if (parseInt(m[1], 10) > ilvl) {
        insertAt = m.index;
        break;
      }
    }
    body = body.slice(0, insertAt) + lvlXml + body.slice(insertAt);
  }
  return xml.replace(abs[0], body);
}
var IMAGE_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif"
};
var EMU_PER_PX3 = 9525;
var CORE_PROPS_PATH = "docProps/core.xml";
function patchCoreProps(xml, savedAt) {
  const iso = (savedAt ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/\.\d{3}Z$/, "Z");
  let out = xml.replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${iso}$2`);
  out = out.replace(/(<cp:revision>)(\d+)(<\/cp:revision>)/, (_m, open, n, close) => {
    const next = parseInt(n, 10) + 1;
    return Number.isFinite(next) ? `${open}${next}${close}` : `${open}${n}${close}`;
  });
  return out === xml ? null : out;
}
async function saveDocx(parsed, finalBlocks, options = {}) {
  const { documentXml, originalBytes, bodyContentStart, bodyContentEnd } = parsed.internal;
  const { elements, opaqueRegions } = parsed.extras;
  const scrubPersonalInfo = options.removePersonalInfo ?? parsed.removePersonalInfo ?? false;
  const visibleOriginalOrder = parsed.blocks.filter((b) => !b.hidden).map((b) => b.docxIndex);
  const isUnchanged = finalBlocks.length === visibleOriginalOrder.length && finalBlocks.every(
    (fb, i) => fb.kind === "original" && fb.docxIndex === visibleOriginalOrder[i] && fb.revision === void 0
  ) && options.section === void 0 && options.trailingSectPr === void 0 && options.zoteroDocumentData === void 0 && options.sectionStartType === void 0 && options.pgNumType === void 0 && options.pageColor === void 0 && options.header === void 0 && options.footer === void 0 && options.headerFirst === void 0 && options.footerFirst === void 0 && options.headerEven === void 0 && options.footerEven === void 0 && options.titlePg === void 0 && (options.sectionHf === void 0 || options.sectionHf.length === 0) && (options.sectionHfUnlink === void 0 || options.sectionHfUnlink.length === 0) && options.numbering === void 0 && options.defaultFonts === void 0 && (options.styleUpserts === void 0 || options.styleUpserts.length === 0) && options.evenAndOddHeaders === void 0 && options.mirrorMargins === void 0 && options.comments === void 0 && options.protection === void 0 && options.writeProtection === void 0 && options.removePersonalInfo === void 0 && options.footnotes === void 0 && options.endnotes === void 0 && options.watermark === void 0 && options.inks === void 0 && options.sources === void 0 && options.themeFonts === void 0 && options.themeColors === void 0 && (options.partXml === void 0 || Object.keys(options.partXml).length === 0) && (options.partBinary === void 0 || Object.keys(options.partBinary).length === 0);
  if (isUnchanged && !scrubPersonalInfo) return originalBytes;
  const zip = await loadDocxZip(originalBytes);
  assertZipWithinLimits(zip);
  const docPath = await resolveMainDocumentPath(zip) ?? "word/document.xml";
  const customPropertiesEntry = zip.file(CUSTOM_PROPERTIES_PATH);
  const shouldWriteZoteroData = options.zoteroDocumentData !== void 0 && (options.zoteroDocumentData !== "" || customPropertiesEntry !== null);
  const customPropertiesXml = shouldWriteZoteroData ? patchZoteroDocumentDataXml(
    customPropertiesEntry ? await customPropertiesEntry.async("string") : null,
    options.zoteroDocumentData
  ) : null;
  const customPropertiesIsNew = customPropertiesXml !== null && customPropertiesEntry === null;
  const rootRelsPath = "_rels/.rels";
  let rootRelsXml = null;
  if (customPropertiesIsNew) {
    const rootRelsEntry = zip.file(rootRelsPath);
    if (rootRelsEntry) {
      rootRelsXml = await rootRelsEntry.async("string");
      if (!rootRelsXml.includes(CUSTOM_PROPERTIES_REL_TYPE)) {
        const rId = `rId${maxRelId(rootRelsXml) + 1}`;
        rootRelsXml = rootRelsXml.replace(
          "</Relationships>",
          `<Relationship Id="${rId}" Type="${CUSTOM_PROPERTIES_REL_TYPE}" Target="${CUSTOM_PROPERTIES_PATH}"/></Relationships>`
        );
      }
    }
  }
  const relsPath = docPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const relsFile = zip.file(relsPath);
  let relsXml = relsFile ? await relsFile.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const newRels = [];
  let nextRelNum = maxRelId(relsXml) + 1;
  const allocateHyperlinkRel = (href) => {
    const existing = newRels.find((r) => r.external && r.target === href);
    if (existing) return existing.rId;
    const rId = `rId${nextRelNum++}`;
    newRels.push({ rId, type: HYPERLINK_REL_TYPE, target: href, external: true });
    return rId;
  };
  const genCtx = {
    headingStyleIds: parsed.headingStyleIds,
    listParagraphStyleId: parsed.listParagraphStyleId,
    allocateHyperlinkRel,
    allocateBookmarkId: nextBookmarkIdAllocator(documentXml)
  };
  const newMedia = [];
  const usedExtensions = /* @__PURE__ */ new Set();
  const mediaRelByContent = /* @__PURE__ */ new Map();
  const mediaPathByContent = /* @__PURE__ */ new Map();
  let imageSeq = nextImageSeq(zip);
  let docPrSeq = nextDocPrSeq(zip, documentXml);
  const landMedia = (image) => {
    if (image.sourcePart) return image.sourcePart;
    const contentKey = `${image.mime}:${image.base64}`;
    let mediaPath = mediaPathByContent.get(contentKey);
    if (mediaPath === void 0) {
      const ext = IMAGE_EXT[image.mime];
      mediaPath = `word/media/aidocs${imageSeq++}.${ext}`;
      newMedia.push({ path: mediaPath, base64: image.base64 });
      usedExtensions.add(ext);
      mediaPathByContent.set(contentKey, mediaPath);
    }
    return mediaPath;
  };
  const embedImageMedia = (image) => {
    const contentKey = image.sourcePart ? `part:${image.sourcePart}` : `${image.mime}:${image.base64}`;
    let rId = mediaRelByContent.get(contentKey);
    if (rId === void 0) {
      const mediaPath = landMedia(image);
      rId = `rId${nextRelNum++}`;
      newRels.push({
        rId,
        type: IMAGE_REL_TYPE,
        target: mediaPath.replace(/^word\//, ""),
        external: false
      });
      mediaRelByContent.set(contentKey, rId);
    }
    return rId;
  };
  const embedImage = (image) => {
    const rId = embedImageMedia(image);
    const cx = Math.max(1, Math.round(image.widthPx * EMU_PER_PX3));
    const cy = Math.max(1, Math.round(image.heightPx * EMU_PER_PX3));
    const rot = image.rotDeg ? (Math.round(image.rotDeg) % 360 + 360) % 360 : 0;
    const rad = rot * Math.PI / 180;
    const bw = Math.abs(cx * Math.cos(rad)) + Math.abs(cy * Math.sin(rad));
    const bh = Math.abs(cx * Math.sin(rad)) + Math.abs(cy * Math.cos(rad));
    const eeX = Math.max(0, Math.round((bw - cx) / 2));
    const eeY = Math.max(0, Math.round((bh - cy) / 2));
    const docPrId = DOCPR_ID_BASE + ++docPrSeq;
    const ps = image.paraSpacing;
    const spacingAttrs = [];
    if (ps?.beforeTwips && ps.beforeTwips > 0)
      spacingAttrs.push(`w:before="${Math.round(ps.beforeTwips)}"`);
    if (ps?.afterTwips !== void 0 && ps.afterTwips >= 0)
      spacingAttrs.push(`w:after="${Math.round(ps.afterTwips)}"`);
    if (ps?.lineTwips && ps.lineRule)
      spacingAttrs.push(`w:line="${Math.round(ps.lineTwips)}"`, `w:lineRule="${ps.lineRule}"`);
    const spacing = spacingAttrs.length > 0 ? `<w:spacing ${spacingAttrs.join(" ")}/>` : "";
    const jc = image.align && image.align !== "left" ? `<w:jc w:val="${image.align}"/>` : "";
    const pPr = spacing || jc ? `<w:pPr>${spacing}${jc}</w:pPr>` : "";
    const xml = `<w:p>${pPr}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="${eeX}" t="${eeY}" r="${eeX}" b="${eeY}"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}"${image.altText ? ` descr="${escapeXmlAttr(image.altText)}"` : ""}/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm${rot ? ` rot="${rot * 6e4}"` : ""}${image.flipH ? ' flipH="1"' : ""}${image.flipV ? ' flipV="1"' : ""}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    return image.wrap ? applyImageWrap(xml, image.wrap, image.posOffsetEmu, void 0, image.zOrder) : xml;
  };
  const embedImages = (images) => {
    const paras = images.map(embedImage);
    if (paras.length <= 1) return paras[0] ?? "";
    const runOf = (para) => para.slice(para.indexOf("<w:r>"), para.lastIndexOf("</w:p>"));
    const first = paras[0];
    return first.slice(0, first.lastIndexOf("</w:p>")) + paras.slice(1).map(runOf).join("") + "</w:p>";
  };
  const newChartParts = [];
  const newChartWorkbooks = [];
  let chartDocPrId = 8e3;
  const embedChart = async (chart, extentPx) => {
    let n = 1;
    while (zip.file(`word/charts/chart${n}.xml`) || newChartParts.some((p) => p.path === `word/charts/chart${n}.xml`)) {
      n++;
    }
    const path = `word/charts/chart${n}.xml`;
    const rId = `rId${nextRelNum++}`;
    newRels.push({ rId, type: CHART_REL_TYPE, target: `charts/chart${n}.xml`, external: false });
    const wbBase64 = await buildChartWorkbookXlsxBase64(chart.categories, chart.series);
    const xlsxPath = `word/charts/embeddings/workbook${n}.xlsx`;
    const wbRId = "rId1";
    const chartRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${wbRId}" Type="${CHART_WORKBOOK_REL_TYPE}" Target="embeddings/workbook${n}.xlsx"/></Relationships>`;
    newChartParts.push({ path, xml: buildChartPartXml(chart, wbRId) });
    newChartWorkbooks.push({
      xlsxPath,
      relsPath: `word/charts/_rels/chart${n}.xml.rels`,
      relsXml: chartRelsXml,
      base64: wbBase64
    });
    const docPrId = chartDocPrId++;
    const cx = extentPx ? Math.max(1, Math.round(extentPx.w * 9525)) : 5486400;
    const cy = extentPx ? Math.max(1, Math.round(extentPx.h * 9525)) : 3200400;
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="Chart ${docPrId}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };
  const inksByBlock = /* @__PURE__ */ new Map();
  for (const ink of options.inks ?? []) {
    const list = inksByBlock.get(ink.blockIndex);
    if (list) list.push(ink);
    else inksByBlock.set(ink.blockIndex, [ink]);
  }
  let inkSeq = 1;
  const inkRunXml = (ink) => {
    const mediaPath = `word/media/${INK_MEDIA_PREFIX}${inkSeq++}.png`;
    const rId = `rId${nextRelNum++}`;
    newRels.push({
      rId,
      type: IMAGE_REL_TYPE,
      target: mediaPath.replace(/^word\//, ""),
      external: false
    });
    newMedia.push({ path: mediaPath, base64: ink.base64 });
    usedExtensions.add("png");
    return anchoredInkRunXml(ink, rId, 9e3 + inkSeq);
  };
  const sectBlock = parsed.blocks.find((b) => b.hidden && b.originalXml?.includes("<w:sectPr"));
  const trailingSectPr = sectBlock?.originalXml ?? "";
  const relTargets = /* @__PURE__ */ new Map();
  if (relsXml) {
    for (const tag2 of relsXml.match(RELATIONSHIP_TAG) ?? []) {
      const id = RELATIONSHIP_ID.exec(tag2)?.[2];
      const target = RELATIONSHIP_TARGET.exec(tag2)?.[2];
      if (id && target) relTargets.set(id, target);
    }
  }
  const hfParts = [];
  const hfRefTags = [];
  const hfOverrides = [];
  const hfRelsOut = /* @__PURE__ */ new Map();
  const savedSectPr = options.section ? applySectionSettings(options.trailingSectPr ?? trailingSectPr, options.section) : options.trailingSectPr ?? trailingSectPr;
  const sectAttr = (tag2, key) => {
    const el = tag2.exec(savedSectPr)?.[0];
    const v = el ? new RegExp(`\\sw:${key}="(-?\\d+)"`).exec(el)?.[1] : void 0;
    return v ? parseInt(v, 10) : null;
  };
  const pgW = sectAttr(/<w:pgSz\b[^>]*>/, "w");
  const pgH = sectAttr(/<w:pgSz\b[^>]*>/, "h");
  const marginBoxPt = pgW && pgH ? {
    widthPt: (pgW - (sectAttr(/<w:pgMar\b[^>]*>/, "left") ?? 1440) - (sectAttr(/<w:pgMar\b[^>]*>/, "right") ?? 1440)) / 20,
    heightPt: (pgH - (sectAttr(/<w:pgMar\b[^>]*>/, "top") ?? 1440) - (sectAttr(/<w:pgMar\b[^>]*>/, "bottom") ?? 1440)) / 20
  } : null;
  const watermarkXmlFor = async (watermark, partPath, originalXml) => {
    if (watermark === void 0) return void 0;
    const relsPath2 = partPath.replace(/^word\/([^/]+)$/, "word/_rels/$1.rels");
    const relsFile2 = zip.file(relsPath2);
    let relsXml2 = await relsFile2?.async("string") ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let relsChanged2 = false;
    const old = originalXml ? readPictureWatermark(originalXml) : null;
    if (old && (originalXml.match(new RegExp(`r:id\\s*=\\s*(["'])${old.rId}\\1`, "g")) ?? []).length === 1) {
      const before = relsXml2;
      relsXml2 = relsXml2.replace(relTagWithId(old.rId), "");
      relsChanged2 = relsXml2 !== before;
    }
    let xml;
    if (watermark === null) xml = "";
    else if (!isPictureWatermark(watermark)) xml = watermarkParagraphXml(watermark);
    else {
      const mediaPath = landMedia(watermark.image);
      const rId = nextFreeRelId(relsXml2);
      relsXml2 = relsXml2.replace(
        "</Relationships>",
        `<Relationship Id="${rId}" Type="${IMAGE_REL_TYPE}" Target="${mediaPath.replace(/^word\//, "")}"/></Relationships>`
      );
      relsChanged2 = true;
      xml = pictureWatermarkParagraphXml(watermark, rId, marginBoxPt);
    }
    if (relsChanged2) hfRelsOut.set(relsPath2, relsXml2);
    return xml;
  };
  const planHeaderFooter = async (kind, hf, watermark = void 0, hfType = "default", watermarkOnly = false) => {
    if (hf === void 0) return;
    const refs = hfReferenceTags(trailingSectPr, kind);
    const existing = refs.find((r) => hfReferenceType(r) === hfType) ?? (hfType === "default" ? refs.find((r) => hfReferenceType(r) === "odd") ?? refs.find((r) => hfReferenceType(r) === void 0) : void 0);
    const rId = existing ? hfReferenceRId(existing) : void 0;
    const target = rId ? relTargets.get(rId) : void 0;
    if (target) {
      const path = resolveRelationshipTargetPath(docPath, target);
      if (!path) return;
      const file = zip.file(path);
      const originalXml = file ? await file.async("string") : null;
      const wmXml = kind === "header" ? await watermarkXmlFor(watermark, path, originalXml) : void 0;
      let partXml = null;
      if (watermarkOnly && kind === "header" && originalXml && wmXml !== void 0) {
        partXml = patchWatermarkInPart(originalXml, wmXml);
      }
      if (partXml === null) partXml = headerFooterPartXml(kind, hf, wmXml, originalXml);
      hfParts.push({ path, xml: partXml });
    } else {
      let n = 1;
      while (zip.file(`word/${kind}${n}.xml`) || hfParts.some((p) => p.path === `word/${kind}${n}.xml`))
        n++;
      const filename = `${kind}${n}.xml`;
      const wmXml = kind === "header" ? await watermarkXmlFor(watermark, `word/${filename}`, null) : void 0;
      const partXml = headerFooterPartXml(kind, hf, wmXml);
      const newRId = `rId${nextRelNum++}`;
      newRels.push({ rId: newRId, type: HF_REL_TYPE[kind], target: filename, external: false });
      hfParts.push({ path: `word/${filename}`, xml: partXml });
      hfRefTags.push(`<w:${kind}Reference w:type="${hfType}" r:id="${newRId}"/>`);
      hfOverrides.push(
        `<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`
      );
    }
  };
  const effectiveHeader = options.header ?? (options.watermark !== void 0 ? { text: parsed.headerText ?? "" } : void 0);
  await planHeaderFooter(
    "header",
    effectiveHeader,
    options.watermark,
    "default",
    options.header === void 0
  );
  await planHeaderFooter("footer", options.footer);
  await planHeaderFooter("header", options.headerFirst, void 0, "first");
  await planHeaderFooter("footer", options.footerFirst, void 0, "first");
  await planHeaderFooter("header", options.headerEven, void 0, "even");
  await planHeaderFooter("footer", options.footerEven, void 0, "even");
  const sectionRefTags = /* @__PURE__ */ new Map();
  const unlinkSectionHf = (xml, docxIndex) => {
    let out2 = xml;
    for (const u of options.sectionHfUnlink ?? []) {
      if (u.lastBlockIndex !== docxIndex) continue;
      out2 = removeHfReference(out2, u.kind, u.variant ?? "default");
    }
    return out2;
  };
  for (const edit of options.sectionHf ?? []) {
    const block = parsed.blocks.find((b) => b.docxIndex === edit.lastBlockIndex);
    const sectPr = block?.originalXml?.match(/<w:sectPr[^>]*\/>|<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
    const refs = hfReferenceTags(sectPr, edit.kind);
    const variant = edit.variant ?? "default";
    const existing = refs.find((r) => hfReferenceType(r) === variant) ?? (variant === "default" ? refs.find((r) => hfReferenceType(r) === "odd") ?? refs.find((r) => hfReferenceType(r) === void 0) : void 0);
    const rId = existing ? hfReferenceRId(existing) : void 0;
    const target = rId ? relTargets.get(rId) : void 0;
    if (target) {
      const path = resolveRelationshipTargetPath(docPath, target);
      if (!path) continue;
      const file = zip.file(path);
      const originalXml = file ? await file.async("string") : null;
      hfParts.push({ path, xml: headerFooterPartXml(edit.kind, edit.hf, void 0, originalXml) });
    } else {
      const partXml = headerFooterPartXml(edit.kind, edit.hf);
      let n = 1;
      while (zip.file(`word/${edit.kind}${n}.xml`) || hfParts.some((p) => p.path === `word/${edit.kind}${n}.xml`))
        n++;
      const filename = `${edit.kind}${n}.xml`;
      const newRId = `rId${nextRelNum++}`;
      newRels.push({ rId: newRId, type: HF_REL_TYPE[edit.kind], target: filename, external: false });
      hfParts.push({ path: `word/${filename}`, xml: partXml });
      hfOverrides.push(
        `<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${edit.kind}+xml"/>`
      );
      const tags = sectionRefTags.get(edit.lastBlockIndex) ?? [];
      tags.push(`<w:${edit.kind}Reference w:type="${variant}" r:id="${newRId}"/>`);
      sectionRefTags.set(edit.lastBlockIndex, tags);
    }
  }
  const numberingPath = "word/numbering.xml";
  let numberingXmlOut = null;
  let numberingIsNew = false;
  let numberingRelsOut = null;
  if ((options.numbering?.newDefs?.length ?? 0) > 0 || (options.numbering?.restartNums?.length ?? 0) > 0 || (options.numbering?.levelEdits?.length ?? 0) > 0 || (options.numbering?.picBullets?.length ?? 0) > 0) {
    const file = zip.file(numberingPath);
    let xml = file ? await file.async("string") : null;
    if (xml === null) {
      xml = BLANK_NUMBERING_XML;
      numberingIsNew = true;
      newRels.push({
        rId: `rId${nextRelNum++}`,
        type: NUMBERING_REL_TYPE,
        target: "numbering.xml",
        external: false
      });
    }
    let maxAbs = -1;
    for (const m of xml.matchAll(/<w:abstractNum [^>]*w:abstractNumId="(\d+)"/g)) {
      maxAbs = Math.max(maxAbs, parseInt(m[1], 10));
    }
    const absXmls = [];
    const numXmls = [];
    const pendingAbs = /* @__PURE__ */ new Map();
    for (const def of options.numbering?.newDefs ?? []) {
      const absId = String(++maxAbs);
      pendingAbs.set(`pending-${def.numId}`, absId);
      absXmls.push(abstractNumXml(absId, def.kind, def.levels));
      numXmls.push(`<w:num w:numId="${def.numId}"><w:abstractNumId w:val="${absId}"/></w:num>`);
    }
    for (const r of options.numbering?.restartNums ?? []) {
      const absId = pendingAbs.get(r.abstractNumId) ?? r.abstractNumId;
      if (absId.startsWith("pending-")) continue;
      const overrides = Object.entries(r.startOverrides).map(
        ([ilvl, v]) => `<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="${v}"/></w:lvlOverride>`
      ).join("");
      numXmls.push(
        `<w:num w:numId="${r.numId}"><w:abstractNumId w:val="${absId}"/>${overrides}</w:num>`
      );
    }
    for (const edit of options.numbering?.levelEdits ?? []) {
      if (edit.abstractNumId.startsWith("pending-")) continue;
      xml = replaceAbstractNumLevel(xml, edit.abstractNumId, edit.ilvl, edit.level);
    }
    if ((options.numbering?.picBullets?.length ?? 0) > 0) {
      const relsPath2 = "word/_rels/numbering.xml.rels";
      const relsFile2 = zip.file(relsPath2);
      let relsXml2 = relsFile2 ? await relsFile2.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      let relNum = 1;
      for (const m of relsXml2.matchAll(RELATIONSHIP_ID_NUMBER))
        relNum = Math.max(relNum, parseInt(m[2], 10) + 1);
      const picXmls = [];
      for (const pic of options.numbering?.picBullets ?? []) {
        const mediaPath = landMedia(pic);
        const rId = `rId${relNum++}`;
        relsXml2 = relsXml2.replace(
          "</Relationships>",
          `<Relationship Id="${rId}" Type="${IMAGE_REL_TYPE}" Target="${escapeXmlAttr(mediaPath.replace(/^word\//, ""))}"/></Relationships>`
        );
        picXmls.push(numPicBulletXml(pic.id, rId));
      }
      xml = /<w:abstractNum[\s>]/.test(xml) ? xml.replace(/<w:abstractNum[\s>]/, (m) => picXmls.join("") + m) : xml.replace("</w:numbering>", `${picXmls.join("")}</w:numbering>`);
      numberingRelsOut = { path: relsPath2, xml: relsXml2, isNew: !relsFile2 };
    }
    if (absXmls.length > 0) {
      xml = /<w:num[\s>]/.test(xml) ? xml.replace(/<w:num[\s>]/, (m) => absXmls.join("") + m) : xml.replace("</w:numbering>", `${absXmls.join("")}</w:numbering>`);
    }
    xml = xml.replace("</w:numbering>", `${numXmls.join("")}</w:numbering>`);
    numberingXmlOut = xml;
  }
  const stylesPath = "word/styles.xml";
  let stylesXmlOut = null;
  if ((options.styleUpserts?.length ?? 0) > 0 || options.defaultFonts !== void 0) {
    const file = zip.file(stylesPath);
    let xml = file ? await file.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>';
    for (const up of options.styleUpserts ?? []) xml = upsertStyleXml(xml, up);
    stylesXmlOut = options.defaultFonts ? mergeDefaultFontsXml(xml, options.defaultFonts) : xml;
  }
  const commentsPath = "word/comments.xml";
  const commentsExtPath = "word/commentsExtended.xml";
  let commentsXml = null;
  let commentsIsNew = false;
  let commentsExtXml = null;
  let commentsExtIsNew = false;
  if (options.comments) {
    let paraSeq = 1;
    const withParaIds = options.comments.map(
      (c) => c.paraId ? c : {
        ...c,
        paraId: (268435456 + paraSeq++ * 4369 + parseInt(c.id, 10)).toString(16).toUpperCase().padStart(8, "0")
      }
    );
    const commentsFile = zip.file(commentsPath);
    commentsXml = buildCommentsXml(
      withParaIds,
      commentsFile ? await commentsFile.async("string") : null
    );
    if (!zip.file(commentsPath)) {
      commentsIsNew = true;
      newRels.push({
        rId: `rId${nextRelNum++}`,
        type: COMMENTS_REL_TYPE,
        target: "comments.xml",
        external: false
      });
    }
    const needExt = zip.file(commentsExtPath) !== null || withParaIds.some((c) => c.parentId !== void 0 || c.done !== void 0);
    if (needExt) {
      commentsExtXml = buildCommentsExtendedXml(withParaIds);
      if (!zip.file(commentsExtPath)) {
        commentsExtIsNew = true;
        newRels.push({
          rId: `rId${nextRelNum++}`,
          type: COMMENTS_EXT_REL_TYPE,
          target: "commentsExtended.xml",
          external: false
        });
      }
    }
  }
  const notesParts = [];
  const planNotes = async (kind, notes) => {
    if (!notes) return;
    const path = NOTE_PART_PATH[kind];
    const file = zip.file(path);
    const originalXml = file ? await file.async("string") : null;
    notesParts.push({ path, xml: buildNotesXml(kind, notes, originalXml), isNew: !file, kind });
    if (!file) {
      newRels.push({
        rId: `rId${nextRelNum++}`,
        type: NOTE_REL_TYPE[kind],
        target: path.replace(/^word\//, ""),
        external: false
      });
    }
  };
  await planNotes("footnote", options.footnotes);
  await planNotes("endnote", options.endnotes);
  let sourcesPart = null;
  if (options.sources) {
    const existing = await findSourcesPart(zip);
    const xml = buildSourcesXml(
      options.sources,
      existing ? await zip.file(existing).async("string") : null
    );
    if (existing) {
      const n = /item(\d+)\.xml$/.exec(existing)?.[1] ?? "1";
      sourcesPart = { path: existing, propsPath: `customXml/itemProps${n}.xml`, xml, isNew: false };
    } else {
      let n = 1;
      while (zip.file(`customXml/item${n}.xml`)) n++;
      sourcesPart = {
        path: `customXml/item${n}.xml`,
        propsPath: `customXml/itemProps${n}.xml`,
        xml,
        isNew: true
      };
      newRels.push({
        rId: `rId${nextRelNum++}`,
        type: CUSTOM_XML_REL_TYPE,
        target: `../customXml/item${n}.xml`,
        external: false
      });
    }
  }
  let themePart = null;
  if (options.themeFonts || options.themeColors) {
    const themeFile = zip.file(THEME_PART_PATH);
    if (themeFile) {
      let xml = await themeFile.async("string");
      if (options.themeFonts) xml = applyThemeFonts(xml, options.themeFonts);
      if (options.themeColors) xml = applyThemeColors(xml, options.themeColors);
      themePart = { xml, isNew: false };
    } else {
      themePart = {
        xml: buildThemeXml(
          options.themeFonts ?? { major: "Calibri Light", minor: "Calibri", eastAsia: "" },
          options.themeColors ?? {}
        ),
        isNew: true
      };
      newRels.push({
        rId: `rId${nextRelNum++}`,
        type: THEME_REL_TYPE,
        target: "theme/theme1.xml",
        external: false
      });
    }
  }
  const retainedIndexes = /* @__PURE__ */ new Set();
  for (const block of finalBlocks) {
    if (block.kind === "original") retainedIndexes.add(block.docxIndex);
    else if ((block.kind === "xml" || block.kind === "generated") && block.docxIndex !== void 0) {
      retainedIndexes.add(block.docxIndex);
    }
  }
  for (const block of parsed.blocks) {
    if (block.hidden && block.docxIndex !== null) retainedIndexes.add(block.docxIndex);
  }
  const sdtShellByIndex = /* @__PURE__ */ new Map();
  for (const block of parsed.blocks) {
    if (block.sdtShell && block.docxIndex !== null)
      sdtShellByIndex.set(block.docxIndex, block.sdtShell);
  }
  const insideSdtShell = (index, region) => {
    const shell = sdtShellByIndex.get(index);
    const element = elements[index];
    if (!shell || !element) return false;
    return region.end <= element.start + shell.openXml.length || region.start >= element.end - shell.closeXml.length;
  };
  const opaqueBefore = /* @__PURE__ */ new Map();
  const opaqueAfter = /* @__PURE__ */ new Map();
  const nestedOpaque = /* @__PURE__ */ new Map();
  const detachedOpaque = [];
  for (const region of opaqueRegions) {
    if (region.start < bodyContentStart || region.end > bodyContentEnd) continue;
    const containingIndex = elements.findIndex(
      (element) => region.start >= element.start && region.end <= element.end
    );
    const xml = documentXml.slice(region.start, region.end);
    if (containingIndex !== -1) {
      if (insideSdtShell(containingIndex, region)) continue;
      if (retainedIndexes.has(containingIndex)) {
        const regions = nestedOpaque.get(containingIndex) ?? [];
        regions.push(xml);
        nestedOpaque.set(containingIndex, regions);
      } else {
        detachedOpaque.push(xml);
      }
      continue;
    }
    let afterIndex = -1;
    let beforeIndex = -1;
    for (let index = 0; index < elements.length; index++) {
      if (elements[index].end <= region.start) afterIndex = index;
      if (elements[index].start >= region.end) {
        beforeIndex = index;
        break;
      }
    }
    if (afterIndex !== -1 && retainedIndexes.has(afterIndex)) {
      const regions = opaqueAfter.get(afterIndex) ?? [];
      regions.push(xml);
      opaqueAfter.set(afterIndex, regions);
    } else if (beforeIndex !== -1 && retainedIndexes.has(beforeIndex)) {
      const regions = opaqueBefore.get(beforeIndex) ?? [];
      regions.push(xml);
      opaqueBefore.set(beforeIndex, regions);
    } else {
      detachedOpaque.push(xml);
    }
  }
  const parts = [...detachedOpaque];
  for (let i = 0; i < finalBlocks.length; i++) {
    const fb = finalBlocks[i];
    let xml;
    let fbDocxIndex;
    if (fb.kind === "original") {
      const el = elements[fb.docxIndex];
      if (!el) throw new Error(`invalid docxIndex ${fb.docxIndex}`);
      xml = documentXml.slice(el.start, el.end);
      fbDocxIndex = fb.docxIndex;
    } else if (fb.kind === "generated") {
      if (fb.docxIndex !== void 0) fbDocxIndex = fb.docxIndex;
      xml = generateParagraphXml(fb.block, genCtx);
      if (fb.block.sdtShell) {
        xml = fb.block.sdtShell.openXml + xml + fb.block.sdtShell.closeXml;
      }
    } else if (fb.kind === "xml") {
      xml = fb.xml;
      fbDocxIndex = fb.docxIndex;
      if (fb.replaceImage) xml = retargetImageBlip(xml, embedImageMedia(fb.replaceImage));
    } else if (fb.kind === "chart") {
      xml = await embedChart(fb.chart, fb.extentPx);
    } else if (fb.kind === "images") {
      xml = embedImages(fb.images);
    } else {
      xml = embedImage(fb.image);
    }
    const refTags = fbDocxIndex !== void 0 ? sectionRefTags.get(fbDocxIndex) : void 0;
    if (refTags && refTags.length > 0) {
      xml = injectIntoSectPr(xml, refTags.join(""));
    }
    if (fbDocxIndex !== void 0) xml = unlinkSectionHf(xml, fbDocxIndex);
    if (options.inks !== void 0) xml = stripInkRuns(xml);
    const blockInks = inksByBlock.get(i);
    if (blockInks && /^<w:p[\s/>]/.test(xml)) {
      const injected = injectInkRunsIntoParagraph(xml, blockInks.map(inkRunXml).join(""));
      if (injected !== null) xml = injected;
    }
    if (fb.revision && !new RegExp(`^<w:${fb.revision.kind}(?:\\s|>)`).test(xml)) {
      const revision = fb.revision;
      const attrs = ` w:id="${escapeXmlAttr(revision.id ?? "0")}" w:author="${escapeXmlAttr(revision.author)}"` + (revision.date ? ` w:date="${escapeXmlAttr(revision.date)}"` : "");
      xml = `<w:${revision.kind}${attrs}>${xml}</w:${revision.kind}>`;
    }
    if (fbDocxIndex !== void 0 && fb.kind !== "original") {
      const nested = (nestedOpaque.get(fbDocxIndex) ?? []).join("");
      if (nested) xml = insertBeforeClosingTag(xml, nested);
    }
    if (fbDocxIndex !== void 0) {
      const leadingOpaque = (opaqueBefore.get(fbDocxIndex) ?? []).join("");
      const trailingOpaque = (opaqueAfter.get(fbDocxIndex) ?? []).join("");
      if (leadingOpaque || trailingOpaque) xml = leadingOpaque + xml + trailingOpaque;
    }
    parts.push(xml);
  }
  for (const block of parsed.blocks) {
    if (block.hidden && block.docxIndex !== null) {
      const el = elements[block.docxIndex];
      let xml = documentXml.slice(el.start, el.end);
      if (xml.includes("<w:sectPr")) {
        if (options.trailingSectPr) xml = options.trailingSectPr;
        if (options.section) xml = applySectionSettings(xml, options.section);
        if (options.sectionStartType) xml = applySectionStartType(xml, options.sectionStartType);
        if (options.pgNumType)
          xml = applyPageNumType(xml, options.pgNumType.fmt, options.pgNumType.start);
        if (options.titlePg !== void 0) xml = applyTitlePg(xml, options.titlePg);
        if (hfRefTags.length > 0) {
          xml = injectIntoSectPr(xml, hfRefTags.join(""));
        }
        xml = unlinkSectionHf(xml, block.docxIndex);
      }
      const index = block.docxIndex;
      if (index !== null) {
        const leadingOpaque = (opaqueBefore.get(index) ?? []).join("");
        const trailingOpaque = (opaqueAfter.get(index) ?? []).join("");
        if (leadingOpaque || trailingOpaque) xml = leadingOpaque + xml + trailingOpaque;
      }
      parts.push(xml);
    }
  }
  let newDocumentXml = documentXml.slice(0, bodyContentStart) + balanceFieldChars(parts.join("")) + documentXml.slice(bodyContentEnd);
  if (options.hfAllSections && hfRefTags.length > 0) {
    newDocumentXml = newDocumentXml.replace(
      /(<w:sectPr(?:\s[^>]*)?>)(?!<w:headerReference|<w:footerReference)/g,
      `$1${hfRefTags.join("")}`
    );
  }
  if (options.comments !== void 0) {
    newDocumentXml = removeDeletedCommentMarkers(
      newDocumentXml,
      new Set(options.comments.map((comment) => comment.id))
    );
  }
  if (newDocumentXml.includes("<m:") && !/<w:document[^>]*xmlns:m=/.test(newDocumentXml)) {
    newDocumentXml = newDocumentXml.replace(
      /<w:document /,
      '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
    );
  }
  if (options.pageColor !== void 0) {
    newDocumentXml = applyPageColor(newDocumentXml, options.pageColor);
  }
  const settingsPath = "word/settings.xml";
  let settingsXml = null;
  let settingsIsNew = false;
  if (options.pageColor || options.protection !== void 0 || options.writeProtection !== void 0 || options.removePersonalInfo !== void 0 || options.evenAndOddHeaders !== void 0 || options.mirrorMargins !== void 0) {
    const file = zip.file(settingsPath);
    let xml;
    let touched = false;
    if (file) {
      xml = await file.async("string");
    } else {
      xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>';
      settingsIsNew = true;
      touched = true;
      newRels.push({
        rId: `rId${nextRelNum++}`,
        type: SETTINGS_REL_TYPE,
        target: "settings.xml",
        external: false
      });
    }
    if (options.pageColor && !xml.includes("<w:displayBackgroundShape")) {
      xml = insertSettingsChild(xml, "displayBackgroundShape", "<w:displayBackgroundShape/>");
      touched = true;
    }
    if (options.protection !== void 0) {
      xml = applyProtection(xml, options.protection);
      touched = true;
    }
    if (options.removePersonalInfo !== void 0) {
      xml = applyRemovePersonalInfo(xml, options.removePersonalInfo);
      touched = true;
    }
    if (options.writeProtection !== void 0) {
      xml = applyWriteProtection(xml, options.writeProtection);
      touched = true;
    }
    if (options.evenAndOddHeaders !== void 0) {
      xml = applyEvenAndOddHeaders(xml, options.evenAndOddHeaders);
      touched = true;
    }
    if (options.mirrorMargins !== void 0) {
      xml = applySettingsFlag(xml, "w:mirrorMargins", options.mirrorMargins);
      touched = true;
    }
    if (touched) settingsXml = xml;
  }
  let relsChanged = false;
  if (newRels.length > 0 && relsXml) {
    const inserts = newRels.map(
      (r) => `<Relationship Id="${escapeXmlAttr(r.rId)}" Type="${r.type}" Target="${escapeXmlAttr(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`
    ).join("");
    relsXml = relsXml.replace("</Relationships>", `${inserts}</Relationships>`);
    relsChanged = true;
  }
  const contentTypesPath = "[Content_Types].xml";
  let contentTypesXml = null;
  const hasNewParts = usedExtensions.size > 0 || hfOverrides.length > 0 || newChartParts.length > 0 || newChartWorkbooks.length > 0 || settingsIsNew || commentsIsNew || commentsExtIsNew || numberingIsNew || notesParts.some((p) => p.isNew) || sourcesPart?.isNew || themePart?.isNew || customPropertiesIsNew;
  if (hasNewParts) {
    const file = zip.file(contentTypesPath);
    if (file) {
      contentTypesXml = await file.async("string");
      const addOverride = (partName, contentType) => {
        if (!contentTypesXml.includes(`PartName="${partName}"`)) {
          contentTypesXml = contentTypesXml.replace(
            "</Types>",
            `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`
          );
        }
      };
      for (const ext of usedExtensions) {
        if (!new RegExp(`Extension="${ext}"`).test(contentTypesXml)) {
          const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
          contentTypesXml = contentTypesXml.replace(
            "</Types>",
            `<Default Extension="${ext}" ContentType="${mime}"/></Types>`
          );
        }
      }
      for (const override of hfOverrides) {
        const partName = /PartName="([^"]+)"/.exec(override)?.[1] ?? "";
        if (!contentTypesXml.includes(`PartName="${partName}"`)) {
          contentTypesXml = contentTypesXml.replace("</Types>", `${override}</Types>`);
        }
      }
      if (commentsIsNew) {
        addOverride(
          "/word/comments.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
        );
      }
      if (commentsExtIsNew) {
        addOverride(
          "/word/commentsExtended.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"
        );
      }
      if (settingsIsNew) {
        addOverride(
          "/word/settings.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"
        );
      }
      if (numberingIsNew) {
        addOverride(
          "/word/numbering.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"
        );
      }
      for (const part of newChartParts) addOverride(`/${part.path}`, CHART_CONTENT_TYPE);
      for (const wb of newChartWorkbooks) addOverride(`/${wb.xlsxPath}`, XLSX_CONTENT_TYPE);
      for (const part of notesParts) {
        if (part.isNew) addOverride(`/${part.path}`, NOTE_CONTENT_TYPE[part.kind]);
      }
      if (sourcesPart?.isNew) {
        addOverride(
          `/${sourcesPart.propsPath}`,
          "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
        );
      }
      if (themePart?.isNew) addOverride(`/${THEME_PART_PATH}`, THEME_CONTENT_TYPE);
      if (customPropertiesIsNew) {
        addOverride(`/${CUSTOM_PROPERTIES_PATH}`, CUSTOM_PROPERTIES_CONTENT_TYPE);
      }
    }
  }
  const coreEntry = zip.file(CORE_PROPS_PATH);
  const coreXmlOut = coreEntry ? patchCoreProps(await coreEntry.async("string"), options.savedAt) : null;
  const out = new JSZip4();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      out.folder(name);
      continue;
    }
    const hfPart = hfParts.find((p) => p.path === name);
    if (name === docPath) {
      out.file(name, newDocumentXml, { date: entry.date });
    } else if (hfPart) {
      out.file(name, hfPart.xml, { date: entry.date });
    } else if (hfRelsOut.has(name)) {
      out.file(name, hfRelsOut.get(name), { date: entry.date });
    } else if (name === relsPath && relsChanged && relsXml) {
      out.file(name, relsXml, { date: entry.date });
    } else if (name === contentTypesPath && contentTypesXml !== null) {
      out.file(name, contentTypesXml, { date: entry.date });
    } else if (name === rootRelsPath && rootRelsXml !== null) {
      out.file(name, rootRelsXml, { date: entry.date });
    } else if (name === settingsPath && settingsXml !== null) {
      out.file(name, settingsXml, { date: entry.date });
    } else if (name === commentsPath && commentsXml !== null) {
      out.file(name, commentsXml, { date: entry.date });
    } else if (name === commentsExtPath && commentsExtXml !== null) {
      out.file(name, commentsExtXml, { date: entry.date });
    } else if (name === numberingPath && numberingXmlOut !== null) {
      out.file(name, numberingXmlOut, { date: entry.date });
    } else if (numberingRelsOut && name === numberingRelsOut.path) {
      out.file(name, numberingRelsOut.xml, { date: entry.date });
    } else if (name === stylesPath && stylesXmlOut !== null) {
      out.file(name, stylesXmlOut, { date: entry.date });
    } else if (notesParts.some((p) => p.path === name)) {
      out.file(name, notesParts.find((p) => p.path === name).xml, { date: entry.date });
    } else if (sourcesPart && name === sourcesPart.path) {
      out.file(name, sourcesPart.xml, { date: entry.date });
    } else if (themePart && name === THEME_PART_PATH) {
      out.file(name, themePart.xml, { date: entry.date });
    } else if (name === CUSTOM_PROPERTIES_PATH && customPropertiesXml !== null) {
      out.file(name, customPropertiesXml, { date: entry.date });
    } else if (name === CORE_PROPS_PATH && coreXmlOut !== null) {
      out.file(name, coreXmlOut, { date: entry.date });
    } else if (options.partXml && options.partXml[name] !== void 0) {
      out.file(name, options.partXml[name], { date: entry.date });
    } else if (options.partBinary && options.partBinary[name] !== void 0) {
      out.file(name, options.partBinary[name], { base64: true, date: entry.date });
    } else {
      out.file(name, await entry.async("uint8array"), { date: entry.date });
    }
  }
  for (const media of newMedia) {
    out.file(media.path, media.base64, { base64: true });
  }
  for (const part of hfParts) {
    if (!zip.file(part.path)) out.file(part.path, part.xml);
  }
  for (const [path, xml] of hfRelsOut) {
    if (!zip.file(path)) out.file(path, xml);
  }
  if (relsChanged && relsXml && !zip.file(relsPath)) {
    out.file(relsPath, relsXml);
  }
  if (commentsIsNew && commentsXml !== null) {
    out.file(commentsPath, commentsXml);
  }
  if (commentsExtIsNew && commentsExtXml !== null) {
    out.file(commentsExtPath, commentsExtXml);
  }
  if (numberingIsNew && numberingXmlOut !== null) {
    out.file(numberingPath, numberingXmlOut);
  }
  if (numberingRelsOut?.isNew) {
    out.file(numberingRelsOut.path, numberingRelsOut.xml);
  }
  if (stylesXmlOut !== null && !zip.file(stylesPath)) {
    out.file(stylesPath, stylesXmlOut);
  }
  if (settingsIsNew && settingsXml !== null) {
    out.file(settingsPath, settingsXml);
  }
  for (const part of newChartParts) {
    out.file(part.path, part.xml);
  }
  for (const wb of newChartWorkbooks) {
    if (!zip.file(wb.relsPath)) {
      out.file(wb.relsPath, wb.relsXml);
    }
    out.file(wb.xlsxPath, wb.base64, { base64: true });
  }
  for (const part of notesParts) {
    if (part.isNew) out.file(part.path, part.xml);
  }
  if (sourcesPart?.isNew) {
    out.file(sourcesPart.path, sourcesPart.xml);
    out.file(sourcesPart.propsPath, buildSourcesItemPropsXml());
    const relsName = sourcesPart.path.replace(/^customXml\//, "").replace(/\.xml$/, "");
    out.file(
      `customXml/_rels/${relsName}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="${sourcesPart.propsPath.replace(/^customXml\//, "")}"/></Relationships>`
    );
  }
  if (themePart?.isNew) {
    out.file(THEME_PART_PATH, themePart.xml);
  }
  if (customPropertiesIsNew && customPropertiesXml !== null) {
    out.file(CUSTOM_PROPERTIES_PATH, customPropertiesXml);
  }
  await cleanupDocxOwnedResources(out, docPath);
  if (scrubPersonalInfo) await scrubPersonalMetadata(out);
  return out.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}
function insertBeforeClosingTag(xml, content) {
  const close = xml.lastIndexOf("</");
  return close === -1 ? xml + content : xml.slice(0, close) + content + xml.slice(close);
}
function opaqueMarkupEnd(xml, start) {
  if (xml.startsWith("<!--", start)) {
    const at = xml.indexOf("-->", start + 4);
    return at === -1 ? xml.length : at + 3;
  }
  if (xml.startsWith("<![CDATA[", start)) {
    const at = xml.indexOf("]]>", start + 9);
    return at === -1 ? xml.length : at + 3;
  }
  if (xml.startsWith("<?", start)) {
    const at = xml.indexOf("?>", start + 2);
    return at === -1 ? xml.length : at + 2;
  }
  if (!xml.startsWith("<!", start)) return null;
  let quote = "";
  let subsetDepth = 0;
  for (let index = start + 2; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      subsetDepth += 1;
    } else if (character === "]") {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === ">" && subsetDepth === 0) {
      return index + 1;
    }
  }
  return xml.length;
}
function xmlTagEnd(xml, start) {
  let quote = "";
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return xml.length;
}
function removeDeletedCommentMarkers(xml, liveIds) {
  let out = "";
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start === -1) return out + xml.slice(cursor);
    out += xml.slice(cursor, start);
    const opaqueEnd3 = opaqueMarkupEnd(xml, start);
    if (opaqueEnd3 !== null) {
      out += xml.slice(start, opaqueEnd3);
      cursor = opaqueEnd3;
      continue;
    }
    const end = xmlTagEnd(xml, start);
    const tag2 = xml.slice(start, end);
    const match = /^<w:(commentRangeStart|commentRangeEnd|commentReference)\b/.exec(tag2);
    const id = /\bw:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag2);
    if (match && id && !liveIds.has(id[1] ?? id[2])) {
      const name = match[1];
      if (tag2.endsWith("/>")) {
        cursor = end;
        continue;
      }
      const close = new RegExp(`^\\s*</w:${name}\\s*>`).exec(xml.slice(end));
      if (close) {
        cursor = end + close[0].length;
        continue;
      }
    }
    out += tag2;
    cursor = end;
  }
  return out;
}
function withWatermarkNs(openTag) {
  let out = openTag;
  for (const ns of [
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:v="urn:schemas-microsoft-com:vml"',
    'xmlns:o="urn:schemas-microsoft-com:office:office"',
    'xmlns:w10="urn:schemas-microsoft-com:office:word"'
  ]) {
    if (!out.includes(ns.split("=")[0] + "=")) out = out.replace(/>$/, ` ${ns}>`);
  }
  return out;
}
function patchWatermarkInPart(originalXml, watermarkXml) {
  const open = /<w:hdr[^>]*>/.exec(originalXml)?.[0];
  if (!open) return null;
  const openIdx = originalXml.indexOf(open);
  const closeIdx = originalXml.lastIndexOf("</w:hdr>");
  if (closeIdx < 0) return null;
  const prefix = originalXml.slice(0, openIdx);
  const inner = originalXml.slice(openIdx + open.length, closeIdx);
  const kept = splitXmlChildren(inner).filter((c) => !isWatermarkChild(c));
  const rootOpen = watermarkXml ? withWatermarkNs(open) : open;
  return `${prefix}${rootOpen}${watermarkXml}${kept.map((c) => c.xml).join("")}</w:hdr>`;
}
function headerFooterPartXml(kind, hf, watermarkXml = void 0, originalXml = null) {
  const root = kind === "header" ? "w:hdr" : "w:ftr";
  const textRun = (t) => t ? `<w:r><w:t xml:space="preserve">${escapeXmlText(t)}</w:t></w:r>` : "";
  const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const numPagesField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  let content;
  if (hf.paras) {
    const hasPageMark = hf.paras.some(
      (p) => [p.runs, ...p.cells?.flatMap((c) => c.paras) ?? []].some(
        (rs) => rs.some((r) => r.text.includes(PAGE_MARK))
      )
    );
    let pageEmitted = !hf.pageNumber || hasPageMark;
    content = hf.paras.filter((para) => !para.cells && !(para.lineOnly && originalXml && para.runs.length === 0)).map((para) => {
      const pPr = mergePPrFormat("<w:pPr/>", para);
      let runs = "";
      for (const run2 of para.runs) {
        if (run2.text.includes(TOTAL_PAGES_MARK) || run2.text.includes(PAGE_MARK) || !pageEmitted && run2.text.includes("#")) {
          run2.text.split(TOTAL_PAGES_MARK).forEach((seg, k) => {
            if (k > 0) runs += numPagesField;
            if (seg.includes(PAGE_MARK)) {
              seg.split(PAGE_MARK).forEach((piece, j) => {
                if (j > 0) runs += pageField;
                if (piece) runs += inlineRunsXml([{ ...run2, text: piece }]);
              });
            } else if (!pageEmitted && seg.includes("#")) {
              const [before, ...rest] = seg.split("#");
              runs += inlineRunsXml(before ? [{ ...run2, text: before }] : []) + pageField + inlineRunsXml(rest.join("#") ? [{ ...run2, text: rest.join("#") }] : []);
              pageEmitted = true;
            } else if (seg) {
              runs += inlineRunsXml([{ ...run2, text: seg }]);
            }
          });
        } else {
          runs += inlineRunsXml([run2]);
        }
      }
      return `<w:p>${pPr}${runs}</w:p>`;
    }).join("");
    if (!pageEmitted) content += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${pageField}</w:p>`;
  } else {
    const textWithTotal = (t) => t.split(TOTAL_PAGES_MARK).map(textRun).join(numPagesField);
    const runs = [];
    if (hf.text.includes(PAGE_MARK)) {
      runs.push(hf.text.split(PAGE_MARK).map(textWithTotal).join(pageField));
    } else if (hf.pageNumber && hf.text.includes("#")) {
      const [before, ...rest] = hf.text.split("#");
      runs.push(textWithTotal(before), pageField, textWithTotal(rest.join("#")));
    } else {
      if (hf.text) runs.push(textWithTotal(hf.text + (hf.pageNumber ? " " : "")));
      if (hf.pageNumber) runs.push(pageField);
    }
    content = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs.join("")}</w:p>`;
  }
  const body = `${watermarkXml ?? ""}${content}`;
  if (originalXml) {
    const open = new RegExp(`<${root}[^>]*>`).exec(originalXml)?.[0];
    const closeIdx = originalXml.lastIndexOf(`</${root}>`);
    if (open && closeIdx >= 0) {
      const openIdx = originalXml.indexOf(open);
      const children = splitXmlChildren(originalXml.slice(openIdx + open.length, closeIdx));
      const isProtectedPara = (xml) => /<w:drawing[\s>]|<w:pict[\s>]|<w:object[\s>]/.test(xml);
      const isTextPara = (c) => c.name === "w:p" && !isWatermarkChild(c) && !isProtectedPara(c.xml);
      if (children.some((c) => !isTextPara(c))) {
        const parts = [];
        let injected = false;
        for (const c of children) {
          if (isTextPara(c)) {
            if (!injected) {
              parts.push(body);
              injected = true;
            }
          } else if (isWatermarkChild(c) && watermarkXml !== void 0) {
          } else {
            parts.push(c.xml);
          }
        }
        if (!injected) parts.unshift(body);
        const rootOpen = watermarkXml ? withWatermarkNs(open) : open;
        return `${originalXml.slice(0, openIdx)}${rootOpen}${parts.join("")}</${root}>`;
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"${WATERMARK_NS}>${body}</${root}>`;
}
var COMMENTS_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
function buildCommentsXml(comments, originalXml) {
  const originals = /* @__PURE__ */ new Map();
  if (originalXml) {
    for (const m of originalXml.match(/<w:comment\s[^>]*>[\s\S]*?<\/w:comment>/g) ?? []) {
      const id = /w:id="([^"]+)"/.exec(m)?.[1];
      if (id) originals.set(id, { text: commentPlainText(m), xml: m });
    }
  }
  const body = comments.map((c) => {
    const orig = originals.get(c.id);
    if (orig && orig.text === c.text) return orig.xml;
    if (orig) {
      const patched = patchParagraphTexts(orig.xml, c.text);
      if (patched !== null) return patched;
    }
    const attrs = `w:id="${escapeXmlAttr(c.id)}" w:author="${escapeXmlAttr(c.author)}"` + (c.initials ? ` w:initials="${escapeXmlAttr(c.initials)}"` : "") + (c.date ? ` w:date="${escapeXmlAttr(c.date)}"` : "");
    const lines = c.text.split("\n");
    const paras = lines.map((line, i) => {
      const pid = i === lines.length - 1 && c.paraId ? ` w14:paraId="${escapeXmlAttr(c.paraId)}"` : "";
      return `<w:p${pid}><w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`;
    }).join("");
    return `<w:comment ${attrs}>${paras}</w:comment>`;
  }).join("");
  const ns = rootAttributes(originalXml, "w:comments", COMMENTS_NS, {
    w14: "http://schemas.microsoft.com/office/word/2010/wordml"
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${ns}>${body}</w:comments>`;
}
function buildCommentsExtendedXml(comments) {
  const paraIdOf = new Map(comments.map((c) => [c.id, c.paraId]));
  const body = comments.filter((c) => c.paraId).map((c) => {
    const parentParaId = c.parentId ? paraIdOf.get(c.parentId) : void 0;
    return `<w15:commentEx w15:paraId="${escapeXmlAttr(c.paraId)}"` + (parentParaId ? ` w15:paraIdParent="${escapeXmlAttr(parentParaId)}"` : "") + ` w15:done="${c.done ? "1" : "0"}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">${body}</w15:commentsEx>`;
}
function commentPlainText(commentXml) {
  const paras = [];
  const pRe = /<w:p(?:\s[^>]*)?\/>|<w:p[\s>][\s\S]*?<\/w:p>/g;
  let p;
  while ((p = pRe.exec(commentXml)) !== null) {
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(p[0])) !== null) texts.push(t[1]);
    paras.push(
      texts.join("").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    );
  }
  return paras.join("\n");
}
function applyProtection(xml, protection) {
  let out = xml.replace(
    /<w:documentProtection(?=[\s/>])[^>]*?(?:\/\s*>|>\s*<\/w:documentProtection\s*>)/,
    ""
  );
  if (protection) {
    const crypt = protection.hash ? ` w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="${protection.algorithmSid ?? 14}" w:cryptSpinCount="${protection.spinCount ?? 1e5}" w:hash="${escapeXmlAttr(protection.hash)}"` + (protection.salt ? ` w:salt="${escapeXmlAttr(protection.salt)}"` : "") : "";
    const tag2 = `<w:documentProtection w:edit="${escapeXmlAttr(protection.edit)}"` + (protection.enforced ? ' w:enforcement="1"' : "") + crypt + "/>";
    out = insertSettingsChild(out, "documentProtection", tag2);
  }
  return out;
}
function applyWriteProtection(xml, wp) {
  let out = xml.replace(
    /<w:writeProtection(?=[\s/>])[^>]*?(?:\/\s*>|>\s*<\/w:writeProtection\s*>)/,
    ""
  );
  if (wp && (wp.recommended || wp.hash)) {
    const crypt = wp.hash ? ` w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="${wp.algorithmSid ?? 14}" w:cryptSpinCount="${wp.spinCount ?? 1e5}" w:hash="${escapeXmlAttr(wp.hash)}"` + (wp.salt ? ` w:salt="${escapeXmlAttr(wp.salt)}"` : "") : "";
    const tag2 = `<w:writeProtection${wp.recommended ? ' w:recommended="1"' : ""}${crypt}/>`;
    out = insertSettingsChild(out, "writeProtection", tag2);
  }
  return out;
}
function applyRemovePersonalInfo(xml, on) {
  const prefixes = namespacePrefixes(xml, WORDPROCESSINGML_NAMESPACES);
  const prefix = prefixes.find(Boolean) ?? (prefixes.includes("") ? "" : "w");
  const propertyName = prefix ? `${prefix}:removePersonalInformation` : "removePersonalInformation";
  const escapedProperty = regexEscape(propertyName);
  const out = xml.replace(
    new RegExp(`<${escapedProperty}\\b[^>]*(?:\\/\\s*>|>\\s*<\\/${escapedProperty}\\s*>)`, "g"),
    ""
  );
  if (!on) return out;
  return insertSettingsChild(out, "removePersonalInformation", `<${propertyName}/>`);
}
var WORDPROCESSINGML_NAMESPACES = [
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main"
];
var CORE_PROPERTIES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
var DUBLIN_CORE_NAMESPACE = "http://purl.org/dc/elements/1.1/";
var EXTENDED_PROPERTIES_NAMESPACES = [
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
  "http://purl.oclc.org/ooxml/officeDocument/extendedProperties"
];
var PEOPLE_NAMESPACE = "http://schemas.microsoft.com/office/word/2012/wordml";
var regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mapXmlStartTags(xml, rewrite) {
  let out = "";
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) return out + xml.slice(cursor);
    out += xml.slice(cursor, start);
    const opaqueEnd3 = opaqueMarkupEnd(xml, start);
    if (opaqueEnd3 !== null) {
      out += xml.slice(start, opaqueEnd3);
      cursor = opaqueEnd3;
      continue;
    }
    const end = xmlTagEnd(xml, start);
    const tag2 = xml.slice(start, end);
    out += tag2.startsWith("</") || tag2.startsWith("<!") ? tag2 : rewrite(tag2);
    cursor = end;
  }
  return out;
}
function namespacePrefixes(xml, namespaces) {
  const wanted = new Set(namespaces);
  const found = /* @__PURE__ */ new Set();
  const declaration = /\bxmlns(?::([A-Za-z_][\w.-]*))?\s*=\s*(["'])([^"']*)\2/g;
  let match;
  while ((match = declaration.exec(xml)) !== null) {
    if (wanted.has(match[3])) found.add(match[1] ?? "");
  }
  return [...found];
}
function replaceQualifiedAttributes(xml, prefixes, replacements) {
  const qualifiedPrefixes = prefixes.filter(Boolean);
  if (qualifiedPrefixes.length === 0) return xml;
  const prefixPattern = qualifiedPrefixes.map(regexEscape).join("|");
  const localPattern = Object.keys(replacements).map(regexEscape).join("|");
  const attribute = new RegExp(
    `(\\b(?:${prefixPattern}):(${localPattern})\\s*=\\s*)(["'])([\\s\\S]*?)\\3`,
    "g"
  );
  return mapXmlStartTags(
    xml,
    (tag2) => tag2.replace(
      attribute,
      (_whole, start, localName, quote) => `${start}${quote}${replacements[localName]}${quote}`
    )
  );
}
function replaceUnqualifiedAttributes(xml, replacements) {
  const localPattern = Object.keys(replacements).map(regexEscape).join("|");
  const attribute = new RegExp(`(\\s(${localPattern})\\s*=\\s*)(["'])([\\s\\S]*?)\\3`, "g");
  return mapXmlStartTags(
    xml,
    (tag2) => tag2.replace(
      attribute,
      (_whole, start, localName, quote) => `${start}${quote}${replacements[localName]}${quote}`
    )
  );
}
function clearQualifiedElements(xml, namespaces, localNames) {
  const qNames = namespacePrefixes(xml, namespaces).flatMap(
    (prefix) => localNames.map((localName) => prefix ? `${prefix}:${localName}` : localName)
  );
  let out = xml;
  for (const qName of qNames) {
    const escaped = regexEscape(qName);
    out = out.replace(
      new RegExp(`(<${escaped}\\b[^>]*>)[\\s\\S]*?(<\\/${escaped}\\s*>)`, "g"),
      "$1$2"
    );
  }
  return out;
}
function scrubWordprocessingMetadata(xml) {
  const prefixes = namespacePrefixes(xml, WORDPROCESSINGML_NAMESPACES);
  if (prefixes.length === 0) return xml;
  const replacements = { author: "Author", initials: "A" };
  return replaceUnqualifiedAttributes(
    replaceQualifiedAttributes(xml, prefixes, replacements),
    replacements
  );
}
function scrubPeopleMetadata(xml) {
  const prefixes = namespacePrefixes(xml, [PEOPLE_NAMESPACE]);
  if (prefixes.length === 0) return xml;
  let out = xml;
  for (const prefix of prefixes) {
    const qName = prefix ? `${prefix}:person` : "person";
    const escaped = regexEscape(qName);
    out = out.replace(
      new RegExp(`<${escaped}\\b[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/${escaped}\\s*>)`, "g"),
      ""
    );
  }
  return out;
}
async function scrubPersonalMetadata(zip) {
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.xml$/i.test(name)) continue;
    const isCustomData = name.startsWith("customXml/") || name === "docProps/custom.xml";
    const isCore = name === CORE_PROPS_PATH;
    const isApp = name === "docProps/app.xml";
    const isPeople = name === "word/people.xml";
    if (isCustomData) continue;
    const original = await entry.async("string");
    let scrubbed = scrubWordprocessingMetadata(original);
    if (isCore) {
      scrubbed = clearQualifiedElements(scrubbed, [DUBLIN_CORE_NAMESPACE], ["creator"]);
      scrubbed = clearQualifiedElements(scrubbed, [CORE_PROPERTIES_NAMESPACE], ["lastModifiedBy"]);
    }
    if (isApp) {
      scrubbed = clearQualifiedElements(scrubbed, EXTENDED_PROPERTIES_NAMESPACES, [
        "Manager",
        "Company"
      ]);
    }
    if (isPeople) scrubbed = scrubPeopleMetadata(scrubbed);
    if (scrubbed !== original) zip.file(name, scrubbed, { date: entry.date });
  }
}
function removeHfReference(sectXml, kind, variant) {
  return sectXml.replace(new RegExp(`<w:${kind}Reference\\b[^>]*/>`, "g"), (tag2) => {
    const m = /\bw:type=(?:"([^"]+)"|'([^']*)')/.exec(tag2);
    const type = m?.[1] ?? m?.[2];
    const isDefault = type === void 0 || type === "default" || type === "odd";
    return (variant === "default" ? isDefault : type === variant) ? "" : tag2;
  });
}
function applySettingsFlag(xml, tag2, on) {
  const out = xml.replace(new RegExp(`<${tag2}(?=[\\s/>])[^>]*>(?:<\\/${tag2}>)?`), "");
  if (!on) return out;
  return insertSettingsChild(out, tag2.slice(tag2.indexOf(":") + 1), `<${tag2}/>`);
}
function applyEvenAndOddHeaders(xml, on) {
  const out = xml.replace(/<w:evenAndOddHeaders(?=[\s/>])[^>]*>(?:<\/w:evenAndOddHeaders>)?/, "");
  return on ? insertSettingsChild(out, "evenAndOddHeaders", "<w:evenAndOddHeaders/>") : out;
}
function applyPageColor(documentXml, color) {
  let xml = documentXml.replace(
    /<w:background[^>]*\/>|<w:background[^>]*>[\s\S]*?<\/w:background>/g,
    ""
  );
  if (color) {
    xml = xml.replace(/(<w:document[^>]*>)/, `$1<w:background w:color="${escapeXmlAttr(color)}"/>`);
  }
  return xml;
}
function maxRelId(relsXml) {
  if (!relsXml) return 1e3;
  let max = 0;
  for (const match of relsXml.matchAll(RELATIONSHIP_ID_NUMBER)) {
    const n = parseInt(match[2], 10);
    if (n > max) max = n;
  }
  return max;
}
function nextImageSeq(zip) {
  let max = 0;
  for (const name of Object.keys(zip.files)) {
    const m = /^word\/media\/aidocs(\d+)\./.exec(name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}
function maxDocPrId(documentXml) {
  let max = 0;
  for (const m of documentXml.matchAll(DRAWING_DOCPR_ID)) max = Math.max(max, parseInt(m[2], 10));
  return max;
}
function nextBookmarkIdAllocator(documentXml) {
  let next = maxBookmarkId(documentXml) + 1;
  return () => next++;
}
function maxBookmarkId(documentXml) {
  let max = 0;
  for (const m of documentXml.matchAll(BOOKMARK_ID)) max = Math.max(max, parseInt(m[2], 10));
  return max;
}
function nextDocPrSeq(zip, documentXml) {
  return Math.max(nextImageSeq(zip), maxDocPrId(documentXml) - DOCPR_ID_BASE);
}
function retargetImageBlip(xml, rId) {
  const blip = /<a:blip\b[^>]*\/?>/.exec(xml);
  if (!blip) return xml;
  let tag2 = blip[0];
  if (/r:embed="/.test(tag2))
    tag2 = tag2.replace(/r:embed="[^"]*"/, `r:embed="${rId}"`).replace(/\s+r:link="[^"]*"/, "");
  else if (/r:link="/.test(tag2)) tag2 = tag2.replace(/r:link="[^"]*"/, `r:embed="${rId}"`);
  else tag2 = tag2.replace(/<a:blip\b/, `<a:blip r:embed="${rId}"`);
  return (xml.slice(0, blip.index) + tag2 + xml.slice(blip.index + blip[0].length)).replace(/<a:srcRect\b[^>]*\/>/, "").replace(/<a:fillRect\b[^>]+\/>/, "<a:fillRect/>").replace(/<a:ext\b[^>]*>\s*<\w+:svgBlip\b[\s\S]*?<\/a:ext>/, "").replace(/<a:extLst>\s*<\/a:extLst>/, "");
}
export {
  buildBlankDocx,
  parseDocx,
  patchParagraphTexts,
  saveDocx
};
