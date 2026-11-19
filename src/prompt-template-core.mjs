// Pure helpers for prompt templates: variable discovery, expansion, search and
// composer insertion. Nothing here sends or runs a prompt.

const VARIABLE = /\{\{\s*([\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,63}?)\s*\}\}/gu;

/** Variable names in first-appearance order, without duplicates. */
export function extractVariables(body) {
  const names = [];
  for (const match of String(body ?? "").matchAll(VARIABLE)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Replace {{name}} with the given values in a single pass, so a value that
 * itself contains {{...}} is never expanded again. Variables without a
 * non-blank value stay in the text and are reported in `missing`.
 */
export function expandTemplate(body, values = {}) {
  const missing = [];
  const text = String(body ?? "").replace(VARIABLE, (placeholder, name) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (typeof value === "string" && value.trim()) return value;
    if (!missing.includes(name)) missing.push(name);
    return placeholder;
  });
  return { text, missing };
}

function fold(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

/** Case-insensitive partial match on name and description; every word must match. */
export function searchTemplates(templates, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...templates];
  return templates.filter(template => {
    const haystack = fold(template.name) + "\n" + fold(template.description);
    return words.every(word => haystack.includes(word));
  });
}

/** Global templates plus those of one project; other projects never leak in. */
export function templatesForScope(templates, projectId) {
  const scope = projectId || null;
  return templates.filter(template => (template.projectId || null) === null || template.projectId === scope);
}

/** A non-blank draft must never be replaced without the user choosing to. */
export function draftNeedsConfirmation(draft) {
  return String(draft ?? "").trim().length > 0;
}

/** mode "replace" discards the draft; "append" keeps it above the inserted text. */
export function mergeIntoDraft(draft, text, mode) {
  const current = String(draft ?? "");
  if (mode === "append" && current.trim()) return current.replace(/\s+$/, "") + "\n\n" + text;
  return text;
}
