const PREF_KEY = "opencode-pocket-wake-lock";
const activeSources = new Set<string>();
let sentinel: any = null;
let visibilityInstalled = false;

export function wakeLockSupported() {
  return typeof navigator !== "undefined" && Boolean((navigator as any).wakeLock?.request);
}

export function wakeLockEnabled() {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

async function releaseWakeLock() {
  const current = sentinel;
  sentinel = null;
  if (current) {
    try {
      await current.release();
    } catch {
      // Already released by the browser.
    }
  }
}

async function syncWakeLock() {
  if (
    !wakeLockEnabled() ||
    !activeSources.size ||
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    !wakeLockSupported()
  ) {
    await releaseWakeLock();
    return;
  }

  if (sentinel) return;
  try {
    sentinel = await (navigator as any).wakeLock.request("screen");
    sentinel.addEventListener?.("release", () => {
      sentinel = null;
    }, { once: true });
  } catch {
    sentinel = null;
  }
}

function installVisibilityListener() {
  if (visibilityInstalled || typeof document === "undefined") return;
  visibilityInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void releaseWakeLock();
    else void syncWakeLock();
  });
  window.addEventListener("pagehide", () => void releaseWakeLock());
}

export function setWakeLockEnabled(enabled: boolean) {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // Storage can be unavailable in private browsing.
  }
  installVisibilityListener();
  void syncWakeLock();
}

export function setWakeLockExecutionActive(source: string, active: boolean) {
  if (active) activeSources.add(source);
  else activeSources.delete(source);
  installVisibilityListener();
  void syncWakeLock();
}
