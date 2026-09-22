export function redactSecretsInText(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) {
    const normalized = String(secret || "");
    if (normalized) text = text.split(normalized).join("[REDACTED]");
  }
  return text;
}
