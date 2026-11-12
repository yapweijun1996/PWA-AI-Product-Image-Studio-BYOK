import type { AutomaticMode, AutomaticLayout } from "../automatic-policy.mjs";
import type { StudioStyleId } from "../studio-policy.mjs";
import type { AutoForeground } from "./autoImaging";
import { inspectImageHeader } from "./imageHeader";
import { sha256 } from "./prepareSource";
export type AutoItem = {
  id: string;
  style: StudioStyleId;
  prompt: string;
  estimatedUSD: string;
  status: "PENDING" | "SUBMITTED" | "UNKNOWN" | "FAILED" | "READY" | "NOT_SENT";
  error?: string;
  reviewedAt?: string;
  provenance?: { policyVersion?: string; mode: AutomaticMode; operation: "local-detail" | "generated-scene-composite" | "reference-edit"; visualAssessment: "NOT_ASSESSED"; layout: AutomaticLayout; detailRoi?: { x: number; y: number; width: number; height: number }; detailUpscaled?: boolean; detailLimitation?: string; artworkLayer?: "local-full-text-free-ad-v1" };
  scene?: Blob;
  output?: Blob;
  sha256?: string;
  qa?: {
    status: "AUTOMATIC_CHECKS_PASSED";
    sourceSha256: string;
    foregroundSha256?: string;
    sceneSha256?: string;
    outputSha256: string;
    checkedAt: string;
    humanReview: false;
    visualAssessment?: "NOT_ASSESSED";
  };
};
export type AutoRun = {
  version: 1;
  mode?: AutomaticMode;
  referenceImages?: { sha256: string; width: number; height: number; mimeType: "image/png" }[];
  capabilities?: AutoForeground["capabilities"];
  id: string;
  filename: string;
  source: Blob;
  sourceSha256: string;
  createdAt: string;
  state: "PREPARING" | "RUNNING" | "COMPLETE" | "STOPPED";
  foreground?: AutoForeground;
  items: AutoItem[];
  estimatedUSD: string;
  sessionId: string;
  message?: string;
  unsavedOutputs?: true;
};
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const r = indexedDB.open("image-studio-automatic", 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("runs")) r.result.createObjectStore("runs", { keyPath: "id" });
    };
    r.onsuccess = () => { if (blocked) { r.result.close(); return; } r.result.onversionchange = () => r.result.close(); resolve(r.result); };
    r.onerror = () => reject(new Error("Local result storage is unavailable."));
    r.onblocked = () => { blocked = true; reject(new Error("Close other app tabs before continuing.")); };
  });
}
export async function saveAutoRun(run: AutoRun) {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("runs", "readwrite");
      tx.objectStore("runs").put(run);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            "Could not save results. No further image requests were sent.",
          ),
        );
    });
  } finally {
    database.close();
  }
}
export async function listAutoRuns(): Promise<AutoRun[]> {
  const database = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction("runs"),
        r = tx.objectStore("runs").getAll();
      r.onsuccess = () =>
        resolve(
          r.result.sort((a: AutoRun, b: AutoRun) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
      r.onerror = () => reject(new Error("Saved results could not be loaded."));
    });
  } finally {
    database.close();
  }
}
export async function checkedOutput(item: AutoItem) {
  if (
    item.status !== "READY" ||
    item.qa?.status !== "AUTOMATIC_CHECKS_PASSED" ||
    item.qa.outputSha256 !== item.sha256 ||
    !item.output ||
    !item.sha256 ||
    (await sha256(new Uint8Array(await item.output.arrayBuffer()))) !==
      item.sha256
  )
    throw new Error("This saved image failed its integrity check.");
  if (item.output.type !== "image/png" || item.output.size > 12 * 1024 * 1024)
    throw new Error("This saved image failed its format check.");
  const header = inspectImageHeader(
    new Uint8Array(await item.output.arrayBuffer()),
  );
  if (
    header.mimeType !== "image/png" ||
    header.width !== 1024 ||
    header.height !== 1024
  )
    throw new Error("This saved image failed its dimensions check.");
  return item.output;
}
