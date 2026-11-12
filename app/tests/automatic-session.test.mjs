import {indexedDB} from "fake-indexeddb";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
globalThis.window = new EventTarget();globalThis.indexedDB=indexedDB;
Object.defineProperty(globalThis.navigator,"locks",{configurable:true,value:{request:async(name,options,callback)=>(typeof options==='function'?options:callback)({name})}});
const server = await createServer({
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: "custom",
});
after(() => server.close());
const keys = await server.ssrLoadModule("/src/browserByok.ts"),
  sessions = await server.ssrLoadModule("/src/automaticSession.ts"),
  imaging = await server.ssrLoadModule("/src/autoImaging.ts");
test("automatic uploads restore one-time permission and retain an optional monthly estimate limit", async () => {
  assert.equal(sessions.automaticSessionStatus(),null);
  await keys.saveBrowserKey("sk-synthetic-auto-session-test");
  assert.equal(sessions.automaticSessionStatus(),null);
  await assert.rejects(()=>keys.saveUploadAuthorization(false));
  await keys.saveUploadAuthorization(true,"0.10");
  const run=()=>({id:crypto.randomUUID(),items:[{id:crypto.randomUUID(),estimatedUSD:"0.059000"}]});
  assert.ok(await sessions.reserveAutomaticRun(run()));
  await assert.rejects(()=>sessions.reserveAutomaticRun(run()),/monthly/);
  keys.clearBrowserKey();assert.equal(sessions.automaticSessionStatus(),null);
  await keys.restoreSavedBrowserKey();assert.ok(sessions.automaticSessionStatus());
  assert.equal((await sessions.monthlyAutomaticUsage()).reservedMicros,59000);
  await keys.forgetBrowserKey();assert.equal(sessions.automaticSessionStatus(),null);
});
test("automatic foreground checks reject empty, invalid or tiny selections", () => {
  assert.throws(() => imaging.matteBounds(new Float32Array(16), 4, 4));
  assert.throws(() => imaging.matteBounds(new Float32Array([NaN]), 1, 1));
  assert.throws(() => imaging.matteBounds(new Float32Array(4), 2, 3));
  const a = new Float32Array(100);
  for (let y = 2; y <= 7; y++) for (let x = 3; x <= 8; x++) a[y * 10 + x] = 1;
  assert.deepEqual(imaging.matteBounds(a, 10, 10), {
    left: 3,
    top: 2,
    right: 8,
    bottom: 7,
  });
});

test("automatic downloads reject missing machine evidence and resealed invalid image data", async () => {
  const store = await server.ssrLoadModule("/src/automaticStore.ts");
  await assert.rejects(() =>
    store.checkedOutput({
      status: "READY",
      output: new Blob(["bad"], { type: "image/png" }),
    }),
  );
  const blob = new Blob(["not-an-image"], { type: "image/png" }),
    hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  await assert.rejects(() =>
    store.checkedOutput({
      status: "READY",
      output: blob,
      sha256: hash,
      qa: { status: "AUTOMATIC_CHECKS_PASSED", outputSha256: hash },
    }),
  );
});
