export const SECRET_PATTERNS = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: "GitHub fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g },
  { name: "OpenAI-style key", regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g },
  { name: "AWS access key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9_-])/g },
  { name: "Slack app token", regex: /\bxapp-\d-[A-Za-z0-9-]{20,}(?![A-Za-z0-9_-])/g },
  { name: "Slack webhook", regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{20,}/g },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g },
  { name: "npm token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "Stripe secret key", regex: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/g },
  { name: "GitLab token", regex: /\bglpat-[0-9A-Za-z_-]{20,}(?![A-Za-z0-9_-])/g }
];

const PLACEHOLDER = /fake|example|placeholder|dummy/i;

const SENSITIVE_NAME = /(^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|\.htpasswd|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.[^/]*)?|.*\.(?:pem|key|p12|pfx|p8|jks|keystore|mobileprovision|ppk|kdbx))$/i;
const ALLOWED_ENV_TEMPLATE = /(^|\/)\.env\.(?:example|sample|template)$/i;

export function isSensitivePath(path) {
  return !ALLOWED_ENV_TEMPLATE.test(path) && SENSITIVE_NAME.test(path);
}

// Every match is checked, so a placeholder earlier in a file cannot hide a
// real credential later in the same file.
export function findSecrets(body) {
  const found = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    for (const match of String(body).matchAll(regex)) {
      if (!PLACEHOLDER.test(match[0])) {
        found.push(name);
        break;
      }
    }
  }
  return found;
}

export function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}
