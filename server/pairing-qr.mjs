import { randomBytes } from "node:crypto";
import qrcode from "../vendor/qrcode-generator/qrcode.mjs";

export function isPairingToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function makePairingQR(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  let origin;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    origin = parsed.origin;
  } catch { return null; }
  const token = randomBytes(32).toString("base64url");
  const url = origin + "/#devmoter-pair=" + token;
  const qr = qrcode(0, "M");
  qr.addData(url, "Byte");
  qr.make();
  return { origin, token, url, dataUrl: qr.createDataURL(5, 20) };
}
