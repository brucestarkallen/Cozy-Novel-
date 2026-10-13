const PREFIX = "cozynovel.assets.";
const CACHE = PREFIX + "1.1.0";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./css/studio.css",
  "./js/app.js",
  "./js/config.js",
  "./js/core/ids.js",
  "./js/core/digest.js",
  "./js/core/schema.js",
  "./js/storage/database.js",
  "./js/storage/coordination.js",
  "./js/storage/repository.js",
  "./js/storage/backup.js",
  "./js/storage/sync.js",
  "./js/novel/operations.js",
  "./js/context/assemble.js",
  "./js/context/scope.js",
  "./js/context/index.js",
  "./js/ai/providers/adapters.js",
  "./js/ai/prompts/templates.js",
  "./js/ai/jobs.js",
  "./js/ai/analysis.js",
  "./js/rp/session.js",
  "./js/story/entities.js",
  "./js/story/reading.js",
  "./js/export/manuscript.js",
  "./js/ui/dom.js",
  "./js/ui/library.js",
  "./js/ui/settings.js",
  "./js/ui/story.js",
  "./js/ui/rp.js",
  "./js/ui/manuscript.js",
  "./js/ui/partner.js",
];
const owned = new Set(
  ASSETS.map((path) => new URL(path, self.registration.scope).href),
);
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(ASSETS);
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.owner === "cozyNovel" && event.data?.type === "activate")
    self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !owned.has(event.request.url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(event.request)) || fetch(event.request);
    })(),
  );
});
