const CACHE = "devmoter-fast-v20";
const SHELL = ["/", "/manifest.webmanifest"];

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
  if (new URL(request.url).pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request, { cache: "no-store" })
      .then(response => {
        if (response.ok) {
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
  const target = new URL(event.notification?.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate(target);
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
