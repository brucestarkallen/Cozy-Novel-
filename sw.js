/* Cozy Novel — the service worker caches nothing.
 *
 * A fix you cannot see because a stale copy was served is a fix that was never
 * made, so every file comes from the phone's server, every time. It exists so
 * the app can sit on the home screen — and to retire the first Cozy Novel's
 * worker, which served its own saved copy of the old app. When it takes over
 * from that one, it clears the old copies and reloads any open page into the
 * new app, so nobody is left looking at the old one. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const names = await caches.keys();
  const old = names.filter((n) => n.startsWith('cozynovel.'));
  await Promise.all(old.map((n) => caches.delete(n)));
  await self.clients.claim();
  if (old.length) {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Never waited on here: a page's reload is answered through this worker,
     * which is not active until this returns — waiting would hold both forever. */
    for (const page of pages) page.navigate(page.url).catch(() => { /* it reloads on its next visit */ });
  }
})()));
self.addEventListener('fetch', () => { /* straight to the network, always */ });
