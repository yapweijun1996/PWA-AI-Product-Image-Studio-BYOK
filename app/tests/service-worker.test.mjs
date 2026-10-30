import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const origin = 'https://studio.example';
const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;

function environment() {
  const stores = new Map();
  let clients = [];
  let denyMetadataWrites = false;
  let beforeDelete = null;
  let lockTail = Promise.resolve();
  const navigator = { locks: { request(_name, action) {
    const result = lockTail.then(action);
    lockTail = result.catch(() => {});
    return result;
  } } };
  const messages = [];
  const registration = { active: null, installing: null, waiting: null };
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { if (beforeDelete) await beforeDelete(name); return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async delete(request) { return entries.delete(key(request)); },
        async put(request, response) {
          if (denyMetadataWrites && name === 'image-studio-worker-meta-v1') throw new Error('quota');
          entries.set(key(request), response.clone());
        },
        async addAll(requests) {
          for (const request of requests) entries.set(key(request), new Response(`${name}: ${new URL(request.url, origin).pathname}`));
        },
      };
    },
  };
  class Request {
    constructor(path) { this.url = new URL(path, origin).href; this.method = 'GET'; this.mode = 'same-origin'; }
  }
  class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close() {} };
      this.port2 = { postMessage: (value) => queueMicrotask(() => this.port1.onmessage?.({ data: value })) };
    }
  }
  function worker(id, assets) {
    const listeners = new Map();
    const self = {
      location: new URL(origin), registration, navigator,
      clients: {
        async matchAll() { return clients.map((id) => ({ id, postMessage(value) { messages.push({ id, value }); } })); },
        async claim() {},
      },
      addEventListener(name, listener) { listeners.set(name, listener); },
      skipWaiting() {},
    };
    const script = source.replace('__BUILD_ID__', JSON.stringify(id)).replace('__SHELL_FILES__', JSON.stringify(['/index.html', ...assets]));
    runInNewContext(script, { self, caches, Request, Response, URL, Error, MessageChannel, setTimeout, clearTimeout, fetch: async () => new Response('network', { status: 404 }) });
    const active = { postMessage(data, ports) { listeners.get('message')({ data, ports }); } };
    return {
      async lifecycle(name) {
        let pending;
        listeners.get(name)({ waitUntil(promise) { pending = promise; } });
        await pending;
        if (name === 'activate') registration.active = active;
      },
      async fetch(path, mode = 'same-origin') {
        let response;
        listeners.get('fetch')({ request: { url: new URL(path, origin).href, method: 'GET', mode }, respondWith(promise) { response = promise; } });
        return response ? await response : null;
      },
      async cleanup(sourceId, scriptPath = `/assets/${id}.js`) {
        let pending, result;
        listeners.get('message')({ data: { type: 'CLEAR_OLD_SHELL_CACHES', scriptUrl: new URL(scriptPath, origin).href }, source: { id: sourceId }, ports: [{ postMessage(value) { result = value; } }], waitUntil(promise) { pending = promise; } });
        await pending;
        return result;
      },
    };
  }
  return { caches, worker, messages, registration, navigator, setClients(ids) { clients = ids; }, denyMetadataWrites(value) { denyMetadataWrites = value; }, onDelete(callback) { beforeDelete = callback; } };
}

test('old static assets survive updates and navigation remains readable when metadata writes fail', async () => {
  const env = environment();
  const a = env.worker('a', ['/assets/mask-a.js']);
  await a.lifecycle('install');
  await a.lifecycle('activate');
  env.setClients(['old-editor', 'new-tab']);
  const b = env.worker('b', ['/assets/mask-b.js']);
  await b.lifecycle('install');
  await b.lifecycle('activate');
  assert.ok((await env.caches.keys()).includes('image-studio-shell-a'));
  assert.equal(await (await b.fetch('/assets/mask-a.js')).text(), 'image-studio-shell-a: /assets/mask-a.js');
  assert.equal(await b.fetch('/api/v2/session'), null);
  assert.equal(await b.fetch('/assets/mask-a.js?private=1'), null);
  env.denyMetadataWrites(true);
  assert.equal(await (await b.fetch('/products/new', 'navigate')).text(), 'image-studio-shell-b: /index.html');
});

test('shell limit pauses a new install without deleting existing versions', async () => {
  const env = environment();
  const active = env.worker('active', ['/assets/current.js']);
  await active.lifecycle('install');
  await active.lifecycle('activate');
  for (let i = 0; i < 7; i++) await env.caches.open(`image-studio-shell-old-${i}`);
  env.setClients(['editor']);
  const next = env.worker('next', ['/assets/next.js']);
  await assert.rejects(next.lifecycle('install'), /user-reviewed cleanup/);
  assert.equal((await env.caches.keys()).filter((name) => name.startsWith('image-studio-shell-')).length, 8);
  assert.equal(env.messages[0].value.type, 'SHELL_CACHE_LIMIT');
});

test('manual cleanup refuses other windows or pending updates and only removes old shell caches', async () => {
  const env = environment();
  const a = env.worker('a', ['/assets/a.js']);
  await a.lifecycle('install');
  await a.lifecycle('activate');
  const b = env.worker('b', ['/assets/b.js']);
  await b.lifecycle('install');
  await b.lifecycle('activate');
  const unrelated = await env.caches.open('other-app-data');
  await unrelated.put('/private', new Response('kept'));
  env.setClients(['editor', 'other']);
  assert.equal((await b.cleanup('editor')).ok, false);
  assert.ok((await env.caches.keys()).includes('image-studio-shell-a'));
  env.setClients(['editor']);
  env.registration.waiting = {};
  assert.equal((await b.cleanup('editor')).ok, false);
  env.registration.waiting = null;
  assert.equal((await b.cleanup('wrong-client')).ok, false);
  const stale = await b.cleanup('editor', '/assets/a.js');
  assert.equal(stale.ok, false);
  assert.match(stale.message, /current app version/);
  assert.ok((await env.caches.keys()).includes('image-studio-shell-a'));
  const result = await b.cleanup('editor');
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.ok(!(await env.caches.keys()).includes('image-studio-shell-a'));
  assert.ok((await env.caches.keys()).includes('image-studio-shell-b'));
  assert.equal(await (await unrelated.match('/private')).text(), 'kept');
});

test('cleanup and a cooperative reinstall of the same build cannot delete its new cache', async () => {
  const env = environment();
  const a = env.worker('a', ['/assets/a.js']);
  await a.lifecycle('install');
  await a.lifecycle('activate');
  const b = env.worker('b', ['/assets/b.js']);
  await b.lifecycle('install');
  await b.lifecycle('activate');
  env.setClients(['editor']);
  let reached;
  const entered = new Promise((resolve) => { reached = resolve; });
  let release;
  const resume = new Promise((resolve) => { release = resolve; });
  env.onDelete(async (name) => {
    if (name === 'image-studio-shell-a') { reached(); await resume; }
  });
  const cleanup = b.cleanup('editor');
  await entered;
  const reinstall = a.lifecycle('install');
  release();
  assert.equal((await cleanup).ok, true);
  await reinstall;
  const aCache = await env.caches.open('image-studio-shell-a');
  assert.equal(await (await aCache.match('/assets/a.js')).text(), 'image-studio-shell-a: /assets/a.js');
});

test('cleanup fails closed without Web Locks while normal navigation remains available', async () => {
  const env = environment();
  const a = env.worker('a', ['/assets/a.js']);
  await a.lifecycle('install');
  await a.lifecycle('activate');
  const b = env.worker('b', ['/assets/b.js']);
  await b.lifecycle('install');
  await b.lifecycle('activate');
  env.setClients(['editor']);
  env.navigator.locks = undefined;
  const result = await b.cleanup('editor');
  assert.equal(result.ok, false);
  assert.match(result.message, /unavailable/);
  assert.ok((await env.caches.keys()).includes('image-studio-shell-a'));
  assert.equal(await (await b.fetch('/products/new', 'navigate')).text(), 'image-studio-shell-b: /index.html');
});

test('a legacy rollback can migrate once at the limit, then requires confirmed cleanup', async () => {
  const env = environment();
  const newer = env.worker('newer', ['/assets/newer.js']);
  await newer.lifecycle('install');
  await newer.lifecycle('activate');
  for (let i = 0; i < 7; i++) await env.caches.open(`image-studio-shell-old-${i}`);
  env.registration.active = { postMessage() { throw new Error('legacy has no protocol'); } };
  const migration = env.worker('migration', ['/assets/migration.js']);
  await migration.lifecycle('install');
  await migration.lifecycle('activate');
  assert.equal((await env.caches.keys()).filter((name) => name.startsWith('image-studio-shell-')).length, 9);
  env.setClients(['editor']);
  const next = env.worker('next', ['/assets/next.js']);
  await assert.rejects(next.lifecycle('install'), /user-reviewed cleanup/);
  assert.equal(env.messages.at(-1).value.type, 'SHELL_CACHE_LIMIT');
  const result = await migration.cleanup('editor');
  assert.equal(result.ok, true);
  assert.equal(result.removed, 8);
  await next.lifecycle('install');
  await next.lifecycle('activate');
  for (let i = 0; i < 6; i++) await env.caches.open(`image-studio-shell-again-${i}`);
  env.registration.active = { postMessage() { throw new Error('legacy has no protocol'); } };
  const secondMigration = env.worker('migration-again', ['/assets/migration-again.js']);
  await secondMigration.lifecycle('install');
  assert.ok((await env.caches.keys()).includes('image-studio-shell-migration-again'));
});

test('cap notice reports when safe cleanup is unavailable', async () => {
  const env = environment();
  const active = env.worker('active', ['/assets/active.js']);
  await active.lifecycle('install');
  await active.lifecycle('activate');
  for (let i = 0; i < 7; i++) await env.caches.open(`image-studio-shell-old-${i}`);
  env.setClients(['editor']);
  env.navigator.locks = undefined;
  const next = env.worker('next', ['/assets/next.js']);
  await assert.rejects(next.lifecycle('install'), /user-reviewed cleanup/);
  assert.equal(env.messages.at(-1).value.cleanupAvailable, false);
});
