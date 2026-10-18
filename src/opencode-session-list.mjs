export function normalizeOpenCodeSessionList(value) {
  if (!Array.isArray(value)) {
    throw new Error("OpenCode returned an invalid session list");
  }
  return value.filter(session =>
    session && typeof session.id === "string" && session.id.length > 0
  );
}
