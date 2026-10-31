// Read one cookie by name from the Cookie header. Never builds an object keyed
// by client-supplied cookie names, so a cookie called "__proto__" or
// "constructor" cannot reach any object property.
export function readCookie(req, name) {
  const wanted = String(name);
  const header = req?.headers?.cookie;
  const raw = Array.isArray(header) ? header.join(";") : String(header || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index).trim() !== wanted) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      // A malformed value never authenticates.
      return "";
    }
  }
  return "";
}
