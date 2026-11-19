const CACHE = "devmoter-fast-v21";
const SHELL = ["/", "/manifest.webmanifest"];

function isSameOriginUrl(url) {
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === self.location.origin;
}

function resolveNotificationTarget(rawUrl) {
  const fallback = new URL("/", self.location.origin).href;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return fallback;
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    return isSameOriginUrl(parsed) ? parsed.href : fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isSameOriginUrl(url)) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/login.html" || url.pathname === "/login.js") return;

  event.respondWith(
    fetch(request, { cache: "no-store" })
      .then(response => {
        if (response.ok && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});


self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let notification = {
      title: "DevMoter",
      body: "Your coding agent needs attention.",
      url: "/"
    };

    try {
      const subscription = await self.registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/pending", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          cache: "no-store"
        });
        if (response.ok) {
          const payload = await response.json();
          if (payload?.notification) notification = payload.notification;
        }
      }
    } catch {
      // Keep the privacy-preserving fallback.
    }

    await self.registration.showNotification(notification.title || "DevMoter", {
      body: notification.body || "Your coding agent needs attention.",
      tag: `devmoter:${notification.url || "/"}`,
      data: { url: notification.url || "/" }
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = resolveNotificationTarget(event.notification?.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      let clientUrl;
      try {
        clientUrl = new URL(client.url);
      } catch {
        continue;
      }
      if (!isSameOriginUrl(clientUrl)) continue;
      await client.navigate(target);
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
