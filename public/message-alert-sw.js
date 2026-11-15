/* Foreground-only BidBlitz notifications: no push subscription or background polling. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const relative = event.notification.data && event.notification.data.url;
  if (typeof relative !== "string" || !/^\/messages\/[0-9a-f-]{36}$/i.test(relative)) return;
  const target = new URL(relative, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.navigate(target);
        await existing.focus();
        return;
      }
      await self.clients.openWindow(target);
    })
  );
});
