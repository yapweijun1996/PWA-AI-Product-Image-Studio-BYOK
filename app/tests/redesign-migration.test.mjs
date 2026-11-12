import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
test("active old uploads defer database upgrades and retain completed bytes", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, ""),
    require = createRequire(root + "/package.json");
  const { IDBFactory } = await import(require.resolve("fake-indexeddb"));
  globalThis.indexedDB = new IDBFactory();
  globalThis.window = new EventTarget();
  let active = true,
    lease = false,
    checks = 0;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (name, arg, fn) => {
        const cb = typeof arg === "function" ? arg : fn;
        if (name !== "studio-automatic-upload-v1") return cb();
        checks++;
        if (active || lease) return cb(null);
        lease = true;
        try {
          return await cb({ name });
        } finally {
          lease = false;
        }
      },
    },
  });
  async function open(name, version) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, version);
      r.onupgradeneeded = () => {
        for (const store of name.includes("credentials")
          ? ["credentials", "usage"]
          : ["runs"])
          r.result.createObjectStore(
            store,
            store === "credentials" ? undefined : { keyPath: "id" },
          );
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function put(db, store, value, key) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      if (key === undefined) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  let db = await open("image-studio-credentials", 2);
  await put(db, "credentials", "sk-synthetic-old-migration-key", "openai");
  db.close();
  db = await open("image-studio-automatic", 2);
  await put(db, "runs", { id: "old-active", status: "SUBMITTED" });
  db.close();
  const { prepareAutomaticStores } = await import(
    root + "/src/automaticMigration.ts"
  );
  await assert.rejects(
    () => prepareAutomaticStores(),
    /UPGRADE_WAIT_FOR_UPLOAD/,
  );
  assert.ok((await indexedDB.databases()).every((d) => d.version === 2));
  db = await open("image-studio-automatic", 2);
  await put(db, "runs", {
    id: "old-active",
    status: "READY",
    output: new Blob(["retained-old-output"]),
  });
  db.close();
  active = false;
  await prepareAutomaticStores();
  assert.ok((await indexedDB.databases()).every((d) => d.version === 3));
  db = await open("image-studio-automatic", 3);
  const saved = await new Promise((resolve) => {
    const r = db.transaction("runs").objectStore("runs").get("old-active");
    r.onsuccess = () => resolve(r.result);
  });
  assert.equal(saved.status, "READY");
  assert.equal(await saved.output.text(), "retained-old-output");
  db.close();
  await assert.rejects(
    () => open("image-studio-automatic", 2),
    (e) => e.name === "VersionError",
  );
  const before = checks;
  active = true;
  const { readStoredCredential } = await import(
    root + "/src/browserCredentialStore.ts"
  );
  assert.ok(await readStoredCredential());
  assert.equal(checks, before);
});
