import { fullyDecodePath } from "./security-helpers.mjs";

/**
 * Decode a client path exactly once and return that canonical value, or null
 * when the path cannot be canonicalized: an undecodable escape, or DOUBLE
 * encoding — decoding the result again would change it (e.g. %252f decodes
 * once to %2f, again to /), which would let DevMoter classify a different
 * route than a decoding upstream serves. An accepted canonical path never
 * contains "%": any remaining escape would either decode further or fail to
 * decode, and both cases are rejected here.
 *
 * The decoded path must also be free of separator/dot ambiguity: an empty
 * segment ("//" anywhere) or a "." / ".." segment is rejected, because a
 * URL-normalizing upstream could collapse those into a different route than
 * the one DevMoter classified. Running the check after decoding covers the
 * percent-encoded forms (%2f, %2e) as well. Both the proxy target builder
 * and the adapter dispatch share this function, so a variant rejected here
 * can never fall through unclassified.
 */
export function normalizeProxyRoutePath(rawPath) {
  rawPath = String(rawPath || "").split("?", 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (fullyDecodePath(rawPath) !== decoded) return null;
  if (decoded.includes("//")) return null;
  if (decoded.split("/").some(segment => segment === "." || segment === "..")) return null;
  return decoded.replace(/\/+$/, "") || "/";
}
