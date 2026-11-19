// Pure helpers for the Automation tab: display only, no requests.

export const RUN_RESULT_STATUSES = Object.freeze({
  success: ["completed"],
  failed: ["failed"],
  running: ["queued", "running"]
});

export const RUN_RESULT_FILTERS = Object.freeze(["all", "success", "failed", "running"]);

export function filterRunsByResult(runs, filter) {
  const list = Array.isArray(runs) ? runs : [];
  const statuses = Object.hasOwn(RUN_RESULT_STATUSES, filter) ? RUN_RESULT_STATUSES[filter] : null;
  return statuses ? list.filter(run => statuses.includes(String(run?.status))) : list.slice();
}

// Device-local date, time and timezone name, e.g. "Nov 20, 2026, 9:00 PM GMT+9".
export function formatLocalRunTime(value, locale = undefined, timeZone = undefined) {
  const date = new Date(typeof value === "number" || typeof value === "string" ? value : NaN);
  if (!Number.isFinite(date.getTime())) return "";
  const options = {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(timeZone ? { timeZone } : {})
  };
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

// "scheduled" | "paused" | "invalid" | "none". Paused wins only when the rule
// itself is valid, so a broken rule is never shown as merely paused.
export function scheduleNextRunView(schedule) {
  const state = String(schedule?.nextRunState || "");
  if (state === "invalid") return { state: "invalid", at: null };
  if (state === "paused" || schedule?.enabled === false) return { state: "paused", at: null };
  const at = Number(schedule?.nextRunAt);
  if (state === "scheduled" && Number.isFinite(at) && at > 0) return { state: "scheduled", at };
  if (state === "none") return { state: "none", at: null };
  return { state: "invalid", at: null };
}
