/* Build-time constants are replaced by the Vite shell-worker plugin. */
const CACHE_PREFIX = 'image-studio-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${__BUILD_ID__}`;
const SHELL_FILES = __SHELL_FILES__;
const SHELL_PATHS = new Set(SHELL_FILES);
const MAX_SHELLS = 8;
const META_CACHE = 'image-studio-worker-meta-v1';
const ACTIVE_KEY = '/__image-studio-active-shell__';
const MIGRATION_KEY = '/__image-studio-shell-migration__';

async function activeShell() {
  const response = await (await caches.open(META_CACHE)).match(ACTIVE_KEY);
  const name = response && await response.text();
  return name && name.startsWith(CACHE_PREFIX) && (await caches.keys()).includes(name) ? name : null;
}

async function withShellLock(action, required = false) {
  const locks = self.navigator && self.navigator.locks;
  if (!locks) {
    if (required) throw new Error('Safe cache cleanup is unavailable in this browser.');
    return action();
  }
  return locks.request('image-studio-shell-cache-v1', action);
}

async function supportsCleanup(worker) {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'function') { resolve(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer); channel.port1.close();
      resolve(event.data?.protocol === 1 ? event.data : null);
    };
    try { worker.postMessage({ type: 'CACHE_PROTOCOL_CHECK' }, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); resolve(null); }
  });
}

async function cachedShellAsset(request) {
  const current = await caches.open(CACHE_NAME);
  const found = await current.match(request);
  if (found) return found;
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || name === CACHE_NAME) continue;
    const old = await (await caches.open(name)).match(request);
    if (old) return old;
  }
  return fetch(request);
}

async function clearOldShells(event) {
  const reply = event.ports && event.ports[0];
  if (!reply) return;
  try {
    const removed = await withShellLock(async () => {
      const script = new URL(event.data.scriptUrl);
      if (script.origin !== self.location.origin || script.search || !script.pathname.endsWith('.js') ||
          !SHELL_PATHS.has(script.pathname) || !(await (await caches.open(CACHE_NAME)).match(script.href))) {
        throw new Error('Reload this tab to the current app version before clearing old caches.');
      }
      const allowed = async () => {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        return event.source && clients.length === 1 && clients[0].id === event.source.id &&
          !self.registration.installing && !self.registration.waiting && await activeShell() === CACHE_NAME;
      };
      if (!(await allowed())) throw new Error('Close other app tabs and wait for any update to finish.');
      const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
      for (const name of names) {
        if (!(await allowed())) throw new Error('App tabs or the active update changed; cleanup stopped.');
        await caches.delete(name);
      }
      await (await caches.open(META_CACHE)).delete(MIGRATION_KEY);
      return names.length;
    }, true);
    reply.postMessage({ ok: true, removed });
  } catch (error) {
    reply.postMessage({ ok: false, message: error instanceof Error ? error.message : 'Old app caches could not be cleared.' });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(withShellLock(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
    let migration = false;
    if (!names.includes(CACHE_NAME) && names.length >= MAX_SHELLS && self.registration.active) {
      const metadata = await caches.open(META_CACHE);
      const protocol = await supportsCleanup(self.registration.active);
      if (protocol) {
        await metadata.delete(MIGRATION_KEY);
      } else if (!(await metadata.match(MIGRATION_KEY))) {
        migration = true;
      }
      if (!migration) {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'SHELL_CACHE_LIMIT', cleanupAvailable: protocol?.cleanupAvailable === true });
        throw new Error('Old application caches require user-reviewed cleanup before updating.');
      }
    }
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(SHELL_FILES.map((path) => new Request(path, {
        cache: 'reload',
        credentials: 'omit',
      })));
    } catch (error) {
      // A failed install must not consume a version slot. Delete only a cache
      // created by this install, while cooperative installers share the lock.
      if (!names.includes(CACHE_NAME) && self.navigator?.locks) {
        try { await caches.delete(CACHE_NAME); } catch { /* Preserve the install failure. */ }
      }
      throw error;
    }
    if (migration) await (await caches.open(META_CACHE)).put(MIGRATION_KEY, new Response('1'));
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(withShellLock(async () => {
    await (await caches.open(META_CACHE)).put(ACTIVE_KEY, new Response(CACHE_NAME));
    await self.clients.claim();
  }));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  else if (event.data?.type === 'CACHE_PROTOCOL_CHECK') event.ports?.[0]?.postMessage({ protocol: 1, cleanupAvailable: Boolean(self.navigator && self.navigator.locks) });
  else if (event.data?.type === 'CLEAR_OLD_SHELL_CACHES') event.waitUntil(clearOldShells(event));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Navigation is read-only so quota exhaustion cannot prevent opening the app.
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match('/index.html')) || fetch(request)));
  } else if (!url.search && (SHELL_PATHS.has(url.pathname) || /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(url.pathname))) {
    // A claimed old client may still need its own hashed worker or module.
    event.respondWith(cachedShellAsset(request));
  }
});
