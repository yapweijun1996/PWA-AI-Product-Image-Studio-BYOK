/* Build-time constants are replaced by the Vite shell-worker plugin. */
const CACHE_NAME = `image-studio-shell-${__BUILD_ID__}`;
const SHELL_FILES = __SHELL_FILES__;
const SHELL_PATHS = new Set(SHELL_FILES);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES.map((path) => new Request(path, {
      cache: 'reload',
      credentials: 'omit',
    })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('image-studio-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Keep HTML and hashed assets on the same active build until the user
    // explicitly activates a waiting update.
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match('/index.html')) || fetch(request)));
  } else if (!url.search && SHELL_PATHS.has(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match(request)) || fetch(request)));
  }
});
