// Farmer service worker — Web Push only. Kept intentionally minimal: it does
// not cache or intercept fetches (the app is not a PWA offline target), it only
// exists so the browser can deliver OS-level notifications while the app tab is
// closed.

self.addEventListener("push", (event) => {
	if (!event.data) return;
	let payload;
	try {
		payload = event.data.json();
	} catch {
		payload = { title: "Farmer", body: event.data.text() };
	}
	const title = payload.title || "Farmer";
	const options = {
		body: payload.body || "",
		icon: "/Icon.svg",
		badge: "/Icon.svg",
		tag: payload.tag,
		data: { url: payload.url || "/" },
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = (event.notification.data && event.notification.data.url) || "/";
	event.waitUntil(
		(async () => {
			const clientList = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			// Focus an existing tab and navigate it if one is open; otherwise open
			// a fresh window at the deep link.
			for (const client of clientList) {
				if ("focus" in client) {
					await client.focus();
					if ("navigate" in client && url) {
						try {
							await client.navigate(url);
						} catch {
							// cross-origin or detached — ignore, focus is enough
						}
					}
					return;
				}
			}
			if (self.clients.openWindow) {
				await self.clients.openWindow(url);
			}
		})(),
	);
});
