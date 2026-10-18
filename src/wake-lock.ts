const PREF_KEY = "opencode-pocket-wake-lock";
const activeSources = new Set<string>();
let sentinel: any = null;
let pendingRequest: Promise<void> | null = null;
let resyncRequested = false;
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

function shouldHoldWakeLock() {
  return wakeLockEnabled() &&
    activeSources.size > 0 &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    wakeLockSupported();
}

async function syncWakeLock() {
  if (!shouldHoldWakeLock()) {
    await releaseWakeLock();
    return;
  }

  // A pending browser permission/request must not outlive the active turn.
  // Coalesce concurrent status changes into one outstanding request.
  if (sentinel) return;
  if (pendingRequest) {
    resyncRequested = true;
    return;
  }
  const request = (async () => {
    let acquired: any;
    try {
      acquired = await (navigator as any).wakeLock.request("screen");
    } catch {
      return; // Unsupported/denied/low-battery browsers degrade cleanly.
    }
    if (!shouldHoldWakeLock()) {
      try {
        await acquired.release();
      } catch {
        // The browser may already have released it.
      }
      return;
    }
    sentinel = acquired;
    acquired.addEventListener?.("release", () => {
      if (sentinel === acquired) sentinel = null;
    }, { once: true });
  })();
  pendingRequest = request;
  try {
    await request;
  } finally {
    if (pendingRequest === request) {
      pendingRequest = null;
      const rerun = resyncRequested;
      resyncRequested = false;
      // A new turn may have started while an old acquisition was releasing.
      if (rerun && shouldHoldWakeLock() && !sentinel) void syncWakeLock();
    }
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
