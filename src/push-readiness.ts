export type PushReadinessState = "ready" | "unsupported" | "unregistered" | "denied" | "error";

export type PushReadiness = {
  state: PushReadinessState;
  registration?: ServiceWorkerRegistration;
};

type ServiceWorkerLike = Pick<ServiceWorkerContainer, "getRegistration" | "ready">;

export function boundedPushWait<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("Service worker readiness timed out")), timeoutMs);
    promise.then(resolve, reject).finally(() => globalThis.clearTimeout(timer));
  });
}

export async function inspectPushReadiness(
  serviceWorker: ServiceWorkerLike | null,
  permission: NotificationPermission | null,
  timeoutMs = 3000
): Promise<PushReadiness> {
  if (!serviceWorker || typeof serviceWorker.getRegistration !== "function" || !serviceWorker.ready) {
    return { state: "unsupported" };
  }
  if (permission === "denied") return { state: "denied" };

  try {
    const existing = await boundedPushWait(serviceWorker.getRegistration(), timeoutMs);
    if (!existing) return { state: "unregistered" };
    const registration = await boundedPushWait(Promise.resolve(serviceWorker.ready), timeoutMs);
    return { state: "ready", registration };
  } catch {
    return { state: "error" };
  }
}
