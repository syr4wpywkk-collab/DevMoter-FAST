const CSP = [
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'"
].join("; ");

export const STATIC_SECURITY_HEADERS = Object.freeze({
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), geolocation=(), payment=(), usb=(), serial=(), hid=()"
});

export function staticSecurityHeaders(contentType) {
  return {
    ...STATIC_SECURITY_HEADERS,
    "content-type": contentType
  };
}
