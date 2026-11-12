// Upgrade only while no old/new automatic upload owns the shared lease. Ordinary
// v3 reads never acquire this lease, avoiding upload/credential lock recursion.
let initializing: Promise<void> | null = null;
const targets = [
  ["image-studio-credentials", ["credentials", "usage"]],
  ["image-studio-automatic", ["runs"]],
] as const;
async function versions() {
  if (typeof indexedDB.databases !== "function")
    throw new Error("UPGRADE_CHECK_UNAVAILABLE");
  return indexedDB.databases();
}
async function upgrade(name: string, stores: readonly string[]) {
  await new Promise<void>((resolve, reject) => {
    let blocked = false;
    const r = indexedDB.open(name, 3);
    r.onupgradeneeded = () => {
      if (blocked) {
        r.transaction?.abort();
        return;
      }
      for (const store of stores)
        if (!r.result.objectStoreNames.contains(store))
          r.result.createObjectStore(
            store,
            store === "runs" || store === "usage"
              ? { keyPath: "id" }
              : undefined,
          );
    };
    r.onsuccess = () => {
      r.result.close();
      if (!blocked) resolve();
    };
    r.onerror = () => reject(new Error("LOCAL_UPGRADE_FAILED"));
    r.onblocked = () => {
      blocked = true;
      reject(new Error("UPGRADE_CLOSE_IDLE_TABS"));
    };
  });
}
export async function prepareAutomaticStores() {
  const existing = await versions();
  if (
    targets.every(([name]) =>
      existing.some((db) => db.name === name && db.version === 3),
    )
  )
    return;
  if (initializing) return initializing;
  if (!navigator.locks) throw new Error("SAFE_COORDINATION_REQUIRED");
  initializing = navigator.locks
    .request(
      "studio-automatic-upload-v1",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error("UPGRADE_WAIT_FOR_UPLOAD");
        const current = await versions();
        if (
          targets.some(
            ([name]) =>
              (current.find((db) => db.name === name)?.version ?? 0) > 3,
          )
        )
          throw new Error("NEWER_APP_REQUIRED");
        for (const [name, stores] of targets) {
          const version = current.find((db) => db.name === name)?.version;
          if (version !== undefined && version > 3)
            throw new Error("NEWER_APP_REQUIRED");
          if (version !== 3) await upgrade(name, stores);
        }
      },
    )
    .finally(() => {
      initializing = null;
    });
  return initializing;
}
