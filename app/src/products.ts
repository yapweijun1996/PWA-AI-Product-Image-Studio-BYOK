import validateProduct from 'virtual:product-validator';
import validateGenerationJob from 'virtual:generation-job-validator';
import validateQaReport from 'virtual:qa-report-validator';
import { evaluateVisualReview, validateReviewFindings, type ReviewScores, type ReviewChecks, type ReviewVariant, type VisualReviewEvaluation, type StyleReviewChecks, type ReviewFinding } from './visualReviewRules';
import { sha256, type PreparedSource } from './prepareSource';
import { inspectImageHeader } from './imageHeader';
import { STUDIO_MAX_PNG_BYTES, STUDIO_PROMPT, STUDIO_MODEL, STUDIO_PROMPT_VERSION, STUDIO_QUALITY,
  STUDIO_SIZE, STUDIO_PRICING_SNAPSHOT, STUDIO_MAX_RETRY_AFTER_SECONDS, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION,
  studioBuildPrompt, studioEstimateUSD, studioObservedUSD } from '../studio-policy.mjs';
import { renderStrictComposite, recipeMapping, type StrictRecipe, type StrictRect, type ProtectedEvidence } from './strictComposite';

export type Fact = {
  factId: string;
  name: string;
  value: string;
  origin: 'USER_CONFIRMED' | 'VISIBLE_SOURCE';
  confirmed: boolean;
  sourceAssetId?: string | null;
};

export type Product = {
  schemaVersion: '1.0.0';
  productId: string;
  sku: string;
  name: string;
  category: string;
  rightsAcknowledged: boolean;
  facts: Fact[];
  sourceAssets: Array<{
    assetId: string;
    sha256: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    cameraView: 'FRONT' | 'BACK' | 'SIDE' | 'TOP' | 'UNKNOWN';
    filename: string;
  }>;
  brandLock: {
    mode: 'STRICT' | 'BALANCED' | 'CREATIVE';
    protectedText: string[];
    forbiddenChanges: string[];
    maskAssetId: string | null;
    lockedColors?: string[];
  };
  createdAt: string;
  updatedAt: string;
};

const DB_NAME = 'product-image-studio';

function notifyProductChanged(productId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel('product-image-studio-changes');
    try { channel.postMessage(productId); } finally { channel.close(); }
  } catch { /* Notifications are advisory; the committed transaction remains authoritative. */ }
}
const DB_VERSION = 1;
let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const products = db.createObjectStore('products', { keyPath: 'productId' });
      products.createIndex('sku', 'sku', { unique: true });
      products.createIndex('updatedAt', 'updatedAt');
      for (const [name, key, indexes] of [
        ['sourceAssets', 'assetId', ['productId', 'sha256']],
        ['masks', 'maskId', ['sourceAssetId', 'version']],
        ['jobs', 'jobId', ['productId', 'status', 'createdAt']],
        ['attempts', 'attemptId', ['jobId', 'status', 'submittedAt']],
        ['generatedAssets', 'assetId', ['attemptId', 'productId']],
        ['qaReports', 'qaId', ['assetId', 'createdAt']],
        ['userSettings', 'key', []],
        ['migrations', 'version', ['appliedAt']],
      ] as Array<[string, string, string[]]>) {
        const store = db.createObjectStore(name, { keyPath: key });
        for (const index of indexes) store.createIndex(index, index);
      }
      request.transaction!.objectStore('migrations').add({ version: DB_VERSION, appliedAt: new Date().toISOString() });
    };
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('Storage upgrade is blocked by another open tab. Close the other tab and try again.'));
    };
    request.onerror = () => reject(request.error?.name === 'VersionError'
      ? new Error('This workspace requires a newer version of the app. No data was changed.')
      : request.error ?? new Error('Could not open local storage.'));
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
  });
  connection = pending.catch((error: unknown) => { connection = null; throw error; });
  return connection;
}

function checkedProduct(value: unknown): Product {
  if (!validateProduct(value)) throw new Error('A stored project is invalid or requires a newer app. No data was changed.');
  return value as Product;
}

function quotaError(): Error { return new Error('Local storage is full. Free space or back up your data before trying again.'); }

function transactionError(transaction: IDBTransaction): Error {
  if (transaction.error?.name === 'ConstraintError') return new Error('A project with this SKU already exists.');
  if (transaction.error?.name === 'QuotaExceededError') return quotaError();
  return transaction.error ?? new Error('Local storage failed. No changes were saved.');
}

export async function listProducts(): Promise<Product[]> {
  const db = await openDatabase();
  const records = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction('products', 'readonly');
    const request = tx.objectStore('products').getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(transactionError(tx));
  });
  return records.map(checkedProduct).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getProduct(id: string): Promise<Product | null> {
  const db = await openDatabase();
  const record = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('products', 'readonly');
    const request = tx.objectStore('products').get(id);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(transactionError(tx));
  });
  return record === undefined ? null : checkedProduct(record);
}

export async function createProduct(input: { sku: string; name: string; category: string; rightsAcknowledged: boolean }): Promise<Product> {
  const now = new Date().toISOString();
  const product: Product = {
    schemaVersion: '1.0.0', productId: crypto.randomUUID(), sku: input.sku.trim(),
    name: input.name.trim(), category: input.category.trim(), rightsAcknowledged: input.rightsAcknowledged,
    facts: [], sourceAssets: [], brandLock: { mode: 'STRICT', protectedText: [], forbiddenChanges: [], maskAssetId: null },
    createdAt: now, updatedAt: now,
  };
  if (!input.rightsAcknowledged || !validateProduct(product)) throw new Error('Enter valid product details and confirm your rights.');
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite');
    tx.objectStore('products').add(product);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(transactionError(tx));
  });
  return product;
}

async function updateProduct(productId: string, change: (product: Product) => Product): Promise<Product> {
  const db = await openDatabase();
  return new Promise<Product>((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    const request = store.get(productId);
    let result: Product;
    let failure: Error | undefined;
    request.onsuccess = () => {
      try {
        if (request.result === undefined) throw new Error('This project no longer exists.');
        const product = checkedProduct(request.result);
        result = { ...change(product), updatedAt: new Date().toISOString() };
        if (!validateProduct(result)) throw new Error('The change does not satisfy the product contract.');
        store.put(result);
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Could not save the project.');
        tx.abort();
      }
    };
    tx.oncomplete = () => { notifyProductChanged(productId); resolve(result); };
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

export function addConfirmedFact(productId: string, name: string, value: string): Promise<Product> {
  const fact: Fact = { factId: crypto.randomUUID(), name: name.trim(), value: value.trim(), origin: 'USER_CONFIRMED', confirmed: true };
  if (!fact.name || fact.name.length > 100 || !fact.value || fact.value.length > 1000) {
    return Promise.reject(new Error('Enter a valid fact name and value.'));
  }
  return updateProduct(productId, (product) => ({ ...product, facts: [...product.facts, fact] }));
}

export function removeFact(productId: string, factId: string): Promise<Product> {
  return updateProduct(productId, (product) => {
    if (!product.facts.some((fact) => fact.factId === factId)) throw new Error('This fact no longer exists.');
    return { ...product, facts: product.facts.filter((fact) => fact.factId !== factId) };
  });
}

export async function saveSource(productId: string, source: PreparedSource, cameraView: Product['sourceAssets'][number]['cameraView']): Promise<Product> {
  const db = await openDatabase();
  return new Promise<Product>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets'], 'readwrite');
    const products = tx.objectStore('products');
    const sources = tx.objectStore('sourceAssets');
    const request = products.get(productId);
    let result: Product;
    let failure: Error | undefined;
    request.onsuccess = () => {
      try {
        if (request.result === undefined) throw new Error('This project no longer exists.');
        const product = checkedProduct(request.result);
        if (!product.rightsAcknowledged) throw new Error('Confirm your rights before saving a source.');
        if (product.sourceAssets.some((asset) => asset.sha256 === source.metadata.sha256)) throw new Error('This source image is already in this product.');
        const metadata = { ...source.metadata, cameraView };
        result = { ...product, sourceAssets: [...product.sourceAssets, metadata], updatedAt: new Date().toISOString() };
        if (!validateProduct(result)) throw new Error('The source metadata is invalid or the product already has 16 sources.');
        sources.add({ ...metadata, productId, exifOrientation: source.exifOrientation, blob: source.file });
        products.put(result);
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Could not save the source image.');
        tx.abort();
      }
    };
    tx.oncomplete = () => { notifyProductChanged(productId); resolve(result); };
    tx.onabort = () => reject(failure ?? (tx.error?.name === 'ConstraintError'
      ? new Error('The source could not be saved. No changes were made.')
      : transactionError(tx)));
  });
}

type SourceMetadata = Product['sourceAssets'][number];
export type BackupSource = { metadata: SourceMetadata; blob: Blob; exifOrientation: number };
export type MaskMetadata = {
  maskId: string;
  productId: string;
  sourceAssetId: string;
  sourceSha256: string;
  width: number;
  height: number;
  sha256: string;
  version: number;
  protectedEvidence?: ProtectedEvidence;
  protectedEvidenceSha256?: string;
};
export type BackupMask = { metadata: MaskMetadata; blob: Blob };

const MAX_MASK_BYTES = 20 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;
const pngCrcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function verifyPngChunks(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, idat = false, end = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error('The mask PNG is truncated.');
    let crc = 0xffffffff;
    for (let index = offset + 4; index < chunkEnd - 4; index++) crc = pngCrcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(chunkEnd - 4)) throw new Error('The mask PNG checksum is invalid.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') idat = true;
    offset = chunkEnd;
    if (type === 'IEND') { end = length === 0; break; }
  }
  if (!idat || !end || offset !== bytes.length) throw new Error('The mask PNG is incomplete.');
}


function ownedSource(product: Product, metadata: SourceMetadata): void {
  const source = product.sourceAssets.find((item) => item.assetId === metadata.assetId);
  if (!source || Object.keys(source).some((key) => source[key as keyof SourceMetadata] !== metadata[key as keyof SourceMetadata])) {
    throw new Error('The source does not belong to this project or its metadata has changed.');
  }
}

async function verifyMask(product: Product, value: unknown): Promise<BackupMask> {
  if (!value || typeof value !== 'object') throw new Error('A mask is missing or invalid.');
  const row = value as Record<string, unknown>;
  const fields = ['maskId', 'productId', 'sourceAssetId', 'sourceSha256', 'width', 'height', 'sha256', 'version', 'blob',
    ...(Object.hasOwn(row, 'protectedEvidence') ? ['protectedEvidence', 'protectedEvidenceSha256'] : [])];
  if (Object.keys(row).length !== fields.length || Object.keys(row).some((key) => !fields.includes(key)) ||
      typeof row.maskId !== 'string' || !uuidPattern.test(row.maskId) || row.productId !== product.productId ||
      typeof row.sourceAssetId !== 'string' || typeof row.sourceSha256 !== 'string' ||
      typeof row.sha256 !== 'string' || !hashPattern.test(row.sha256) ||
      !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
      !(row.blob instanceof Blob) || row.blob.size < 1 || row.blob.size > MAX_MASK_BYTES) {
    throw new Error('A mask has invalid or unsupported metadata.');
  }
  const source = product.sourceAssets.find((item) => item.assetId === row.sourceAssetId);
  if (!source || source.sha256 !== row.sourceSha256 || source.width !== row.width || source.height !== row.height) {
    throw new Error('A mask does not match its original source.');
  }
  if (row.protectedEvidence !== undefined) {
    const evidence = row.protectedEvidence as ProtectedEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
        !exactKeys(evidence, ['version', 'sourceSha256', 'maskSha256', 'width', 'height', 'regions']) ||
        evidence.version !== 1 || evidence.sourceSha256 !== source.sha256 || evidence.maskSha256 !== row.sha256 ||
        evidence.width !== source.width || evidence.height !== source.height || !Array.isArray(evidence.regions) ||
        evidence.regions.length < 1 || evidence.regions.length > 32 || typeof row.protectedEvidenceSha256 !== 'string' ||
        !hashPattern.test(row.protectedEvidenceSha256)) throw new Error('Protected mask evidence is invalid.');
    let work = 0;
    for (const rect of evidence.regions) {
      if (!rect || typeof rect !== 'object' || Array.isArray(rect) || !exactKeys(rect, ['x', 'y', 'width', 'height']) ||
          ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) || rect.x < 0 || rect.y < 0 ||
          rect.width < 1 || rect.height < 1 || rect.x + rect.width > source.width || rect.y + rect.height > source.height ||
          (work += rect.width * rect.height) > source.width * source.height) throw new Error('Protected mask region bounds are invalid.');
    }
    if (await sha256(new TextEncoder().encode(JSON.stringify(evidence))) !== row.protectedEvidenceSha256)
      throw new Error('Protected mask evidence hash does not match.');
  } else if (Object.hasOwn(row, 'protectedEvidence') || Object.hasOwn(row, 'protectedEvidenceSha256')) {
    throw new Error('Protected mask evidence is incomplete.');
  }
  const bytes = new Uint8Array(await row.blob.arrayBuffer());
  const header = inspectImageHeader(bytes);
  if (header.mimeType !== 'image/png' || header.orientation !== 1 || header.width !== source.width || header.height !== source.height ||
      await sha256(bytes) !== row.sha256) throw new Error('A mask PNG hash or dimensions do not match.');
  // The editor produces 8-bit masks with an explicit alpha channel.
  if (bytes[24] !== 8 || (bytes[25] !== 4 && bytes[25] !== 6)) throw new Error('A mask PNG must have an 8-bit alpha channel.');
  verifyPngChunks(bytes);
  if (typeof createImageBitmap === 'function') {
    let decoded: ImageBitmap;
    try { decoded = await createImageBitmap(row.blob); }
    catch { throw new Error('The mask PNG could not be decoded.'); }
    try {
      if (decoded.width !== source.width || decoded.height !== source.height) throw new Error('The decoded mask dimensions do not match.');
    } finally { decoded.close(); }
  } else {
    const url = URL.createObjectURL(row.blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The mask PNG could not be decoded.'));
        image.src = url;
      });
      if (image.naturalWidth !== source.width || image.naturalHeight !== source.height) throw new Error('The decoded mask dimensions do not match.');
    } finally { URL.revokeObjectURL(url); }
  }
  const { blob, ...metadata } = row;
  return { metadata: metadata as MaskMetadata, blob: blob as Blob };
}

function checkBackupCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Backup validation was cancelled.', 'AbortError');
}

async function verifyMaskAlpha(source: BackupSource, mask: BackupMask, signal?: AbortSignal): Promise<void> {
  async function decode(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; release: () => void }> {
    if (typeof createImageBitmap === 'function') {
      const image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { image, width: image.width, height: image.height, release: () => image.close() };
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The image could not be decoded for mask verification.'));
        image.src = url;
      });
      return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  checkBackupCancellation(signal);
  const original = await decode(source.blob);
  try {
    checkBackupCancellation(signal);
    const selection = await decode(mask.blob);
    try {
      checkBackupCancellation(signal);
      const { width, height } = source.metadata;
      if (original.width !== width || original.height !== height || selection.width !== width || selection.height !== height) {
        throw new Error('The browser could not decode the oriented source and mask consistently.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = Math.min(height, 128);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Mask alpha verification is unavailable on this device.');
      let selected = false;
      for (let y = 0; y < height; y += canvas.height) {
        const rows = Math.min(canvas.height, height - y);
        context.clearRect(0, 0, width, rows);
        context.drawImage(original.image, 0, y, width, rows, 0, 0, width, rows);
        const sourcePixels = context.getImageData(0, 0, width, rows).data;
        context.clearRect(0, 0, width, rows);
        context.drawImage(selection.image, 0, y, width, rows, 0, 0, width, rows);
        const maskPixels = context.getImageData(0, 0, width, rows).data;
        for (let offset = 3; offset < maskPixels.length; offset += 4) {
          if (maskPixels[offset] > sourcePixels[offset]) throw new Error('The mask alpha exceeds the original source alpha.');
          if (maskPixels[offset] > 0) selected = true;
        }
        for (const rect of mask.metadata.protectedEvidence?.regions ?? []) {
          for (let sy = Math.max(y, rect.y); sy < Math.min(y + rows, rect.y + rect.height); sy++) {
            for (let sx = rect.x; sx < rect.x + rect.width; sx++) {
              const alpha = ((sy - y) * width + sx) * 4 + 3;
              if (sourcePixels[alpha] !== 255 || maskPixels[alpha] !== 255)
                throw new Error('A protected mask region is not fully covered.');
            }
          }
        }
        if (signal) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          checkBackupCancellation(signal);
        }
      }
      if (!selected) throw new Error('The mask must select at least one visible source pixel.');
    } finally { selection.release(); }
  } finally { original.release(); }
}

function validateMaskReferences(product: Product, masks: BackupMask[]): void {
  const ids = new Set<string>(), versions = new Set<string>();
  for (const { metadata } of masks) {
    const version = `${metadata.sourceAssetId}:${metadata.version}`;
    if (ids.has(metadata.maskId) || versions.has(version)) throw new Error('The backup contains duplicate mask IDs or versions.');
    ids.add(metadata.maskId); versions.add(version);
  }
  if (product.brandLock.maskAssetId !== null && !ids.has(product.brandLock.maskAssetId)) {
    throw new Error('The active mask is missing.');
  }
  const active = masks.find((mask) => mask.metadata.maskId === product.brandLock.maskAssetId);
  if (active && masks.some((mask) => mask.metadata.sourceAssetId === active.metadata.sourceAssetId && mask.metadata.version > active.metadata.version)) {
    throw new Error('The active mask is not the latest version for its source.');
  }
}

// Weighted decoded-pixel work, not archive bytes or browser memory usage.
// Limit each full validation pass before decoding or rendering any mask/output.
const MAX_BACKUP_PIXEL_WORK = 256 * 1024 * 1024;
const BACKUP_OUTPUT_PIXELS = 1024 * 1024;
export function checkBackupPixelWork(product: Product, maskSources: unknown[], assets: Array<StudioAsset | StrictComposite> = []): void {
  const sources = new Map(product.sourceAssets.map((source) => [source.assetId, source]));
  let work = 0;
  const add = (amount: number) => {
    if (!Number.isSafeInteger(amount) || amount < 0 || (work += amount) > MAX_BACKUP_PIXEL_WORK) {
      throw new Error('The project exceeds the backup image validation work limit. No data was omitted or imported.');
    }
  };
  const pixels = (id: unknown) => {
    const source = typeof id === 'string' ? sources.get(id) : undefined;
    if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
      throw new Error('A backup image references an invalid source.');
    }
    return source.width * source.height;
  };
  for (const source of product.sourceAssets) add(pixels(source.assetId));
  for (const id of maskSources) add(2 * pixels(id));
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') throw new Error('A backup output is invalid.');
    add(BACKUP_OUTPUT_PIXELS);
    if ('kind' in asset && asset.kind === 'strict-composite') {
      add(2 * pixels(asset.sourceAssetId) + 3 * BACKUP_OUTPUT_PIXELS);
      if (asset.ad) add(2 * BACKUP_OUTPUT_PIXELS);
      if (asset.copyLayer) add(BACKUP_OUTPUT_PIXELS);
    }
  }
}

export async function validateBackupMasks(product: Product, masks: BackupMask[], sources: BackupSource[], signal?: AbortSignal): Promise<BackupMask[]> {
  checkBackupCancellation(signal);
  checkBackupPixelWork(product, masks.map((mask) => mask?.metadata?.sourceAssetId));
  const verified: BackupMask[] = [];
  for (const mask of masks) {
    checkBackupCancellation(signal);
    if (!mask.metadata || typeof mask.metadata !== 'object' || ![8, 10].includes(Object.keys(mask.metadata).length) || Object.hasOwn(mask.metadata, 'blob')) {
      throw new Error('Mask metadata contains unsupported fields.');
    }
    const checked = await verifyMask(product, { ...mask.metadata, blob: mask.blob });
    const source = sources.find((item) => item.metadata.assetId === checked.metadata.sourceAssetId);
    if (!source) throw new Error('The mask source is missing.');
    await verifyMaskAlpha(source, checked, signal);
    verified.push(checked);
  }
  if (verified.length && product.brandLock.maskAssetId === null) throw new Error('The active mask pointer is missing.');
  validateMaskReferences(product, verified);
  return verified;
}

export async function loadSourceMask(productId: string, source: SourceMetadata): Promise<{ blob: Blob; sha256: string; maskId: string; protectedEvidence?: ProtectedEvidence; protectedEvidenceSha256?: string } | null> {
  const db = await openDatabase();
  const snapshot = await new Promise<{ product: Product; source: unknown; mask: unknown; versions: unknown[] }>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks'], 'readonly');
    const productRequest = tx.objectStore('products').get(productId);
    const sourceRequest = tx.objectStore('sourceAssets').get(source.assetId);
    const versionsRequest = tx.objectStore('masks').index('sourceAssetId').getAll(source.assetId);
    let product: Product, maskRequest: IDBRequest | undefined, failure: Error | undefined;
    productRequest.onsuccess = () => {
      try {
        if (productRequest.result === undefined) throw new Error('This project no longer exists.');
        product = checkedProduct(productRequest.result);
        ownedSource(product, source);
        if (product.brandLock.maskAssetId) maskRequest = tx.objectStore('masks').get(product.brandLock.maskAssetId);
      } catch (error) { failure = error instanceof Error ? error : new Error('Could not load the mask.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve({ product, source: sourceRequest.result, mask: maskRequest?.result, versions: versionsRequest.result });
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
  const original = await verifyStoredSource(productId, source, snapshot.source);
  if (!snapshot.product.brandLock.maskAssetId) {
    if (snapshot.versions.length) throw new Error('The active mask pointer is missing.');
    return null;
  }
  const active = await verifyMask(snapshot.product, snapshot.mask);
  if (active.metadata.maskId !== snapshot.product.brandLock.maskAssetId) throw new Error('The active mask is invalid.');
  const versions: BackupMask[] = [];
  for (const row of snapshot.versions) {
    const mask = await verifyMask(snapshot.product, row);
    await verifyMaskAlpha(original, mask);
    versions.push(mask);
  }
  validateMaskReferences({
    ...snapshot.product,
    brandLock: { ...snapshot.product.brandLock, maskAssetId: active.metadata.sourceAssetId === source.assetId ? active.metadata.maskId : null },
  }, versions);
  const latest = versions.reduce<BackupMask | null>((current, mask) =>
    !current || mask.metadata.version > current.metadata.version ? mask : current, null);
  return latest ? { blob: latest.blob, sha256: latest.metadata.sha256, maskId: latest.metadata.maskId,
    ...(latest.metadata.protectedEvidence ? { protectedEvidence: structuredClone(latest.metadata.protectedEvidence), protectedEvidenceSha256: latest.metadata.protectedEvidenceSha256 } : {}) } : null;
}

export async function saveMask(productId: string, source: SourceMetadata, blob: Blob, expectedMaskAssetId: string | null, protectedRegions?: StrictRect[]): Promise<Product> {
  if (expectedMaskAssetId !== null && (typeof expectedMaskAssetId !== 'string' || !uuidPattern.test(expectedMaskAssetId))) {
    throw new Error('The expected mask version is invalid. Reload the editor.');
  }
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > MAX_MASK_BYTES) throw new Error('The mask exceeds the 20 MiB limit or is empty.');
  const regions = protectedRegions === undefined ? undefined : structuredClone(protectedRegions);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const metadata: MaskMetadata = { maskId: crypto.randomUUID(), productId, sourceAssetId: source.assetId,
    sourceSha256: source.sha256, width: source.width, height: source.height, sha256: await sha256(bytes), version: 1 };
  if (regions !== undefined) {
    const evidence: ProtectedEvidence = { version: 1, sourceSha256: source.sha256, maskSha256: metadata.sha256,
      width: source.width, height: source.height, regions };
    metadata.protectedEvidence = evidence;
    metadata.protectedEvidenceSha256 = await sha256(new TextEncoder().encode(JSON.stringify(evidence)));
  }
  const db = await openDatabase();
  return new Promise<Product>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks'], 'readwrite');
    const products = tx.objectStore('products'), masks = tx.objectStore('masks');
    const productRequest = products.get(productId), sourceRequest = tx.objectStore('sourceAssets').get(source.assetId);
    const activeRequest = expectedMaskAssetId ? masks.get(expectedMaskAssetId) : undefined;
    const sourceRowsRequest = tx.objectStore('sourceAssets').index('productId').getAll(productId);
    const versionsRequest = masks.index('sourceAssetId').getAll(source.assetId);
    let result: Product, failure: Error | undefined;
    // IndexedDB transactions are active only inside request callbacks. Keep one request
    // pending while validation runs, and perform the final writes from its callback.
    let verifying = true;
    let ready = false;
    const keepAlive = () => {
      if (!verifying) return;
      if (ready) {
        masks.add({ ...metadata, blob });
        products.put(result);
        verifying = false;
      } else {
        const request = products.get(productId);
        request.onsuccess = keepAlive;
      }
    };
    keepAlive();
    versionsRequest.onsuccess = () => {
      void (async () => {
        try {
          if (productRequest.result === undefined) throw new Error('This project no longer exists.');
          const product = checkedProduct(productRequest.result);
          ownedSource(product, source);
          if (product.brandLock.maskAssetId !== expectedMaskAssetId) throw new Error('The mask changed in another tab. Reload the editor before saving.');
          const original = await verifyStoredSource(productId, source, sourceRequest.result);
          const versions: BackupMask[] = [];
          for (const row of versionsRequest.result) {
            const previous = await verifyMask(product, row);
            await verifyMaskAlpha(original, previous);
            versions.push(previous);
          }
          if (!expectedMaskAssetId && versions.length) throw new Error('The active mask pointer is missing. No changes were saved.');
          if (activeRequest) {
            const active = await verifyMask(product, activeRequest.result);
            if (active.metadata.maskId !== expectedMaskAssetId) throw new Error('The active mask is invalid.');
            if (active.metadata.sourceAssetId === source.assetId) {
              validateMaskReferences(product, versions);
            } else {
              const activeSource = product.sourceAssets.find((item) => item.assetId === active.metadata.sourceAssetId)!;
              const activeSourceRow = sourceRowsRequest.result.find((row: unknown) =>
                row && typeof row === 'object' && (row as Record<string, unknown>).assetId === activeSource.assetId);
              await verifyMaskAlpha(await verifyStoredSource(productId, activeSource, activeSourceRow), active);
            }
          }
          validateMaskReferences({ ...product, brandLock: { ...product.brandLock, maskAssetId: null } }, versions);
          metadata.version = Math.max(0, ...versions.map((item) => item.metadata.version)) + 1;
          if (!Number.isSafeInteger(metadata.version)) throw new Error('The mask version limit has been reached.');
          const newMask = await verifyMask(product, { ...metadata, blob });
          await verifyMaskAlpha(original, newMask);
          result = { ...product, brandLock: { ...product.brandLock, maskAssetId: metadata.maskId }, updatedAt: new Date().toISOString() };
          if (!validateProduct(result)) throw new Error('The mask does not satisfy the product contract.');
          ready = true;
        } catch (error) {
          verifying = false; failure = error instanceof Error ? error : new Error('Could not save the mask.'); tx.abort();
        }
      })();
    };
    tx.oncomplete = () => { notifyProductChanged(productId); resolve(result); };
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

async function verifyStoredSource(productId: string, metadata: SourceMetadata, record: unknown): Promise<BackupSource> {
  if (!record || typeof record !== 'object') throw new Error('The original source is missing and cannot be verified.');
  const source = record as Record<string, unknown>;
  if (source.productId !== productId || source.assetId !== metadata.assetId || source.sha256 !== metadata.sha256 ||
      source.mimeType !== metadata.mimeType || source.width !== metadata.width || source.height !== metadata.height ||
      source.cameraView !== metadata.cameraView || source.filename !== metadata.filename ||
      !(source.blob instanceof Blob) || source.blob.size < 1 || source.blob.size > 20 * 1024 * 1024 ||
      !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) ||
      metadata.width < 1 || metadata.height < 1 || metadata.width > 20_000 || metadata.height > 20_000 ||
      metadata.width * metadata.height > 24_000_000 ||
      !Number.isInteger(source.exifOrientation) || (source.exifOrientation as number) < 1 || (source.exifOrientation as number) > 8) {
    throw new Error('The original source metadata is invalid and cannot be verified.');
  }
  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  if (await sha256(bytes) !== metadata.sha256) throw new Error('The original source hash does not match. It cannot be verified.');
  const header = inspectImageHeader(bytes);
  const rotated = header.orientation >= 5 && header.orientation <= 8;
  if (header.mimeType !== metadata.mimeType || header.orientation !== source.exifOrientation ||
      (rotated ? header.height : header.width) !== metadata.width ||
      (rotated ? header.width : header.height) !== metadata.height) {
    throw new Error('The original source dimensions or orientation do not match. It cannot be verified.');
  }
  return { metadata, blob: source.blob, exifOrientation: header.orientation };
}

export async function loadOriginalSource(productId: string, metadata: SourceMetadata): Promise<Blob> {
  const db = await openDatabase();
  const record = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('sourceAssets', 'readonly');
    const request = tx.objectStore('sourceAssets').get(metadata.assetId);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(transactionError(tx));
  });
  return (await verifyStoredSource(productId, metadata, record)).blob;
}

function validateBackupReferences(product: Product): void {
  const sourceIds = new Set(product.sourceAssets.map((asset) => asset.assetId));
  const hashes = new Set(product.sourceAssets.map((asset) => asset.sha256));
  const factIds = new Set(product.facts.map((fact) => fact.factId));
  if (sourceIds.size !== product.sourceAssets.length || hashes.size !== product.sourceAssets.length ||
      factIds.size !== product.facts.length || (sourceIds.size > 0 && !product.rightsAcknowledged) ||
      product.facts.some((fact) => fact.sourceAssetId && !sourceIds.has(fact.sourceAssetId))) {
    throw new Error('This project contains unsupported or inconsistent references; it cannot be safely backed up or imported.');
  }
}

export function validateBackupProduct(value: unknown): Product {
  const product = checkedProduct(value);
  validateBackupReferences(product);
  return product;
}

export type BackupHistory = {
  jobs: StudioJob[]; attempts: StudioAttempt[]; assets: Array<StudioAsset | StrictComposite>;
  reviews: Array<VisualReviewRecord | StoredVisualDecision>; heads: Array<{ key: string; entries: string[] }>;
};
const emptyBackupHistory = (): BackupHistory => ({ jobs: [], attempts: [], assets: [], reviews: [], heads: [] });
const importAttemptKey = (id: string) => `backup-import-unresolved:${id}`;
const importReviewKey = (id: string) => `backup-import-review:${id}`;

export async function getBackupSnapshot(productId: string, signal?: AbortSignal): Promise<{ product: Product; sources: BackupSource[]; masks: BackupMask[]; history: BackupHistory }> {
  checkBackupCancellation(signal);
  const db = await openDatabase();
  const snapshot = await new Promise<{ product: Product; rows: unknown[]; masks: unknown[]; history: BackupHistory }>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks', 'jobs', 'attempts', 'generatedAssets', 'qaReports', 'userSettings'], 'readonly');
    const productRequest = tx.objectStore('products').get(productId);
    const sourceRequest = tx.objectStore('sourceAssets').index('productId').getAll(productId);
    const maskRequest = tx.objectStore('masks').getAll();
    const jobRequest = tx.objectStore('jobs').getAll();
    const attemptRequest = tx.objectStore('attempts').getAll();
    const assetRequest = tx.objectStore('generatedAssets').getAll();
    const reviewRequest = tx.objectStore('qaReports').getAll();
    const settingsRequest = tx.objectStore('userSettings').getAll();
    tx.oncomplete = () => {
      try {
        if (productRequest.result === undefined) throw new Error('This project no longer exists.');
        const product = validateBackupProduct(productRequest.result);
        const sourceIds = new Set(product.sourceAssets.map((row) => row.assetId));
        const masks = (maskRequest.result as MaskMetadata[]).filter((row) => row.productId === productId || sourceIds.has(row.sourceAssetId));
        const jobs = (jobRequest.result as StudioJob[]).filter((row) => row.productId === productId);
        const jobIds = new Set(jobs.map((row) => row.jobId));
        const attempts = (attemptRequest.result as StudioAttempt[]).filter((row) => row.productId === productId || jobIds.has(row.jobId));
        const attemptIds = new Set(attempts.map((row) => row.attemptId));
        const assets = (assetRequest.result as Array<StudioAsset | StrictComposite>).filter((row) => row.productId === productId || attemptIds.has(row.attemptId));
        const assetIds = new Set(assets.map((row) => row.assetId));
        const reviews = (reviewRequest.result as Array<VisualReviewRecord | StoredVisualDecision>).filter((row) => row.productId === productId || assetIds.has(row.assetId) || attemptIds.has(row.attemptId));
        const heads = (settingsRequest.result as Array<{ key: string; entries: string[] }>).filter((row) => typeof row?.key === 'string' && row.key.startsWith('visual-review-head:') && assetIds.has(row.key.slice('visual-review-head:'.length)));
        resolve({ product, rows: sourceRequest.result, masks, history: { jobs, attempts, assets, reviews, heads } });
      } catch (error) { reject(error); }
    };
    tx.onabort = () => reject(transactionError(tx));
  });
  checkBackupCancellation(signal);
  checkBackupPixelWork(snapshot.product, snapshot.masks.map((row) => (row as MaskMetadata)?.sourceAssetId), snapshot.history.assets);
  if (snapshot.rows.length !== snapshot.product.sourceAssets.length) {
    throw new Error('The source records do not match the project. Backup was not created.');
  }
  const sources: BackupSource[] = [];
  const sourceFields: Record<string, true> = { assetId: true, sha256: true, mimeType: true, width: true, height: true, cameraView: true, filename: true, productId: true, exifOrientation: true, blob: true };
  for (const metadata of snapshot.product.sourceAssets) {
    checkBackupCancellation(signal);
    const row = snapshot.rows.find((value) => value && typeof value === 'object' && (value as Record<string, unknown>).assetId === metadata.assetId);
    if (!row || typeof row !== 'object' || Object.keys(row).some((key) => !Object.hasOwn(sourceFields, key))) {
      throw new Error('A source contains unsupported fields. Backup was not created.');
    }
    sources.push(await verifyStoredSource(productId, metadata, row));
  }
  const masks: BackupMask[] = [];
  for (const row of snapshot.masks) {
    checkBackupCancellation(signal);
    masks.push(await verifyMask(snapshot.product, row));
  }
  const verifiedMasks = await validateBackupMasks(snapshot.product, masks, sources, signal);
  await validateBackupHistory(snapshot.product, sources, verifiedMasks, snapshot.history, signal);
  return { product: snapshot.product, sources, masks: verifiedMasks, history: snapshot.history };
}

function importForeignReferences(tx: IDBTransaction, product: Product, history: BackupHistory): IDBRequest<number>[] {
  return [
    tx.objectStore('sourceAssets').index('productId').count(product.productId),
    tx.objectStore('jobs').index('productId').count(product.productId),
    tx.objectStore('generatedAssets').index('productId').count(product.productId),
    ...product.sourceAssets.map((row) => tx.objectStore('masks').index('sourceAssetId').count(row.assetId)),
    ...history.jobs.map((row) => tx.objectStore('attempts').index('jobId').count(row.jobId)),
    ...history.attempts.map((row) => tx.objectStore('generatedAssets').index('attemptId').count(row.attemptId)),
    ...history.assets.filter((row) => 'kind' in row).map((row) => tx.objectStore('userSettings').count(`visual-review-head:${row.assetId}`)),
    ...history.assets.map((row) => tx.objectStore('qaReports').index('assetId').count(row.assetId)),
  ];
}
function importCrossReferenceConflict(product: Product, masks: BackupMask[], history: BackupHistory, attempts: StudioAttempt[], reviews: Array<VisualReviewRecord | StoredVisualDecision>): boolean {
  const sourceIds = new Set(product.sourceAssets.map((row) => row.assetId));
  const maskIds = new Set(masks.map((row) => row.metadata.maskId));
  const attemptIds = new Set(history.attempts.map((row) => row.attemptId));
  const reviewIds = new Set(history.reviews.map((row) => row.qaId));
  return attempts.some((row) => row.productId === product.productId || sourceIds.has(row.sourceAssetId) || maskIds.has(row.maskId) ||
    (row.retryOf !== undefined && attemptIds.has(row.retryOf))) ||
    reviews.some((row) => row.productId === product.productId || attemptIds.has(row.attemptId) ||
      (row.kind === 'visual-decision' && reviewIds.has(row.reportId)));
}


export async function hasImportConflict(product: Product, masks: BackupMask[] = [], history: BackupHistory = emptyBackupHistory()): Promise<boolean> {
  const db = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks', 'jobs', 'attempts', 'generatedAssets', 'qaReports', 'userSettings'], 'readonly');
    const products = tx.objectStore('products');
    const checks = [products.getKey(product.productId), products.index('sku').getKey(product.sku),
      ...product.sourceAssets.map((asset) => tx.objectStore('sourceAssets').getKey(asset.assetId)),
      ...masks.map((mask) => tx.objectStore('masks').getKey(mask.metadata.maskId)),
      ...history.jobs.map((row) => tx.objectStore('jobs').getKey(row.jobId)),
      ...history.attempts.flatMap((row) => [tx.objectStore('attempts').getKey(row.attemptId), tx.objectStore('userSettings').getKey(importAttemptKey(row.attemptId))]),
      ...history.assets.flatMap((row) => [tx.objectStore('generatedAssets').getKey(row.assetId), tx.objectStore('userSettings').getKey(importReviewKey(row.assetId))]),
      ...history.reviews.map((row) => tx.objectStore('qaReports').getKey(row.qaId)),
      ...history.heads.map((row) => tx.objectStore('userSettings').getKey(row.key))];
    const references = importForeignReferences(tx, product, history);
    const attempts = tx.objectStore('attempts').getAll(), reviews = tx.objectStore('qaReports').getAll();
    tx.oncomplete = () => resolve(checks.some((request) => request.result !== undefined) || references.some((request) => request.result > 0) ||
      importCrossReferenceConflict(product, masks, history, attempts.result, reviews.result));
    tx.onabort = () => reject(transactionError(tx));
  });
}

export async function restoreProduct(product: Product, sources: BackupSource[], masks: BackupMask[] = [], history: BackupHistory = emptyBackupHistory(), signal?: AbortSignal): Promise<void> {
  // Freeze the caller's mutable metadata before any asynchronous verification.
  product = structuredClone(product);
  sources = structuredClone(sources);
  masks = structuredClone(masks);
  history = structuredClone(history);
  if (signal?.aborted) throw new DOMException('Import was cancelled.', 'AbortError');
  validateBackupProduct(product);
  if (!Array.isArray(masks) || !history || !Array.isArray(history.assets)) throw new Error('Backup history is malformed.');
  checkBackupPixelWork(product, masks.map((mask) => mask?.metadata?.sourceAssetId), history.assets);
  if (sources.length !== product.sourceAssets.length) throw new Error('The backup has missing or extra sources.');
  const ids = new Set(sources.map((source) => source.metadata.assetId));
  if (ids.size !== sources.length) throw new Error('The backup contains duplicate source IDs.');
  for (const metadata of product.sourceAssets) {
    checkBackupCancellation(signal);
    const source = sources.find((item) => item.metadata.assetId === metadata.assetId);
    if (!source || JSON.stringify(source.metadata) !== JSON.stringify(metadata)) throw new Error('The backup is missing an original source or its metadata differs.');
    await verifyStoredSource(product.productId, metadata, { ...source.metadata, productId: product.productId, blob: source.blob, exifOrientation: source.exifOrientation });
  }
  const verifiedMasks = await validateBackupMasks(product, masks, sources, signal);
  await validateBackupHistory(product, sources, verifiedMasks, history, signal);
  if (signal?.aborted) throw new DOMException('Import was cancelled.', 'AbortError');
  const db = await openDatabase();
  if (signal?.aborted) throw new DOMException('Import was cancelled.', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks', 'jobs', 'attempts', 'generatedAssets', 'qaReports', 'userSettings'], 'readwrite');
    const cancel = () => { try { tx.abort(); } catch { /* Already committed or aborted. */ } };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); }
    let failure: Error | undefined;
    const references = importForeignReferences(tx, product, history);
    const existingAttempts = tx.objectStore('attempts').getAll(), existingReviews = tx.objectStore('qaReports').getAll();
    existingReviews.onsuccess = () => {
      if (references.some((request) => request.result > 0) ||
          importCrossReferenceConflict(product, verifiedMasks, history, existingAttempts.result, existingReviews.result)) {
        failure = new Error('Existing records reference this backup. Nothing was imported.');
        tx.abort();
      }
    };
    try {
    tx.objectStore('products').add(product);
    for (const source of sources) tx.objectStore('sourceAssets').add({ ...source.metadata, productId: product.productId, blob: source.blob, exifOrientation: source.exifOrientation });
    for (const mask of verifiedMasks) tx.objectStore('masks').add({ ...mask.metadata, blob: mask.blob });
    for (const job of history.jobs) tx.objectStore('jobs').add(job);
    for (const attempt of history.attempts) {
      tx.objectStore('attempts').add(attempt);
      const unresolved = attempt.status === 'PREPARED' || attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED' ||
        attempt.cleanupPending === true || attempt.acknowledgedAt !== undefined ||
        attempt.failure?.category === 'rate_limited' || attempt.failure?.category === 'provider_limit' ||
        attempt.failure?.retryAfterSeconds !== undefined;
      tx.objectStore('userSettings').add({ key: importAttemptKey(attempt.attemptId), snapshot: JSON.stringify(attempt), reviewed: !unresolved });
    }
    for (const asset of history.assets) {
      tx.objectStore('generatedAssets').add(asset);
      if ('kind' in asset) {
        const revision = history.reviews.filter((row): row is VisualReviewRecord => row.assetId === asset.assetId && row.kind === 'visual-review').length;
        tx.objectStore('userSettings').add({ key: importReviewKey(asset.assetId), revision });
      }
    }
    for (const row of history.reviews) tx.objectStore('qaReports').add(row);
    for (const head of history.heads) tx.objectStore('userSettings').add(head);
    } catch (error) {
      failure = error instanceof Error && error.name === 'QuotaExceededError' ? quotaError() : error instanceof Error ? error : new Error('Could not import backup.');
      try { tx.abort(); } catch { /* Already aborted. */ }
    }
    tx.oncomplete = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    tx.onabort = () => {
      signal?.removeEventListener('abort', cancel);
      reject(signal?.aborted ? new DOMException('Import was cancelled.', 'AbortError') : tx.error?.name === 'ConstraintError'
        ? new Error('A product, SKU, record ID or history key already exists. Nothing was imported.')
        : failure ?? transactionError(tx));
    };
  });
}

export type StudioStyleId = 'studio' | 'hero' | 'lifestyle' | 'flat_lay' | 'macro' | 'ugc' | 'billboard';
export type StudioSceneContext = { productName: string; category: string; confirmedFacts: string[]; sourceView: 'TOP' | 'OTHER' | 'UNKNOWN' };

function productSnapshot(product: Product): string {
  const { updatedAt: _updatedAt, brandLock, ...rest } = product;
  const { maskAssetId: _maskAssetId, ...lock } = brandLock;
  return JSON.stringify({ ...rest, brandLock: lock });
}
export async function productSnapshotFingerprint(product: Product): Promise<string> {
  return sha256(new TextEncoder().encode(productSnapshot(product)));
}
export function studioSceneContext(product: Product, source: SourceMetadata, selectedFactIds: string[]): StudioSceneContext {
  if (!Array.isArray(selectedFactIds) || new Set(selectedFactIds).size !== selectedFactIds.length ||
      selectedFactIds.some((id) => !product.facts.some((fact) => fact.factId === id && fact.confirmed))) {
    throw new Error('Selected facts must be unique and confirmed.');
  }
  const selected = new Set(selectedFactIds);
  return { productName: product.name, category: product.category,
    confirmedFacts: product.facts.filter((fact) => selected.has(fact.factId)).map((fact) => `${fact.name}: ${fact.value}`),
    sourceView: source.cameraView === 'TOP' ? 'TOP' : source.cameraView === 'UNKNOWN' ? 'UNKNOWN' : 'OTHER' };
}
function validateAttemptContext(attempt: StudioAttempt, product: Product, requireCurrent = true): void {
  if (attempt.styleId === undefined && attempt.presetVersion === undefined && attempt.sceneContext === undefined && attempt.productSnapshotFingerprint === undefined && attempt.selectedFactIds === undefined && attempt.topViewConfirmed === undefined) return;
  const source = product.sourceAssets.find((item) => item.assetId === attempt.sourceAssetId);
  if (!source || !attempt.styleId || attempt.presetVersion !== STUDIO_PRESET_VERSION ||
      attempt.promptVersion !== STUDIO_SCENE_PROMPT_VERSION || !attempt.sceneContext ||
      typeof attempt.sceneContext !== 'object' || !exactKeys(attempt.sceneContext, ['productName', 'category', 'confirmedFacts', 'sourceView']) ||
      typeof attempt.sceneContext.productName !== 'string' || typeof attempt.sceneContext.category !== 'string' ||
      !Array.isArray(attempt.sceneContext.confirmedFacts) || attempt.sceneContext.confirmedFacts.some((fact) => typeof fact !== 'string') ||
      !['TOP', 'OTHER', 'UNKNOWN'].includes(attempt.sceneContext.sourceView) ||
      !Array.isArray(attempt.selectedFactIds) || new Set(attempt.selectedFactIds).size !== attempt.selectedFactIds.length ||
      attempt.selectedFactIds.some((id) => typeof id !== 'string' || !uuidPattern.test(id)) ||
      (requireCurrent && JSON.stringify(attempt.sceneContext) !== JSON.stringify(studioSceneContext(product, source, attempt.selectedFactIds))) ||
      (!requireCurrent && attempt.styleId === 'flat_lay' && attempt.sceneContext.sourceView === 'TOP' && source.cameraView !== 'TOP') ||
      ((attempt.styleId === 'flat_lay' && attempt.sceneContext.sourceView === 'TOP') !== (attempt.topViewConfirmed === true)) ||
      (attempt.topViewConfirmed !== undefined && attempt.topViewConfirmed !== true) ||
      attempt.prompt !== studioBuildPrompt(attempt.styleId, attempt.sceneContext) ||
      attempt.estimatedUSD !== studioEstimateUSD(attempt.prompt) ||
      typeof attempt.productSnapshotFingerprint !== 'string' || !hashPattern.test(attempt.productSnapshotFingerprint)) {
    throw new Error('The job context or preset no longer matches the confirmed product and source.');
  }
}

export type StudioAttempt = {
  attemptId: string; jobId: string; productId: string; sourceAssetId: string;
  retryOf?: string;
  sourceSha256: string; maskId: string; maskSha256: string;
  prompt: string; promptVersion: string; model: string; quality: string; size: string;
  styleId?: StudioStyleId; presetVersion?: string; sceneContext?: StudioSceneContext; selectedFactIds?: string[]; productSnapshotFingerprint?: string; topViewConfirmed?: true;
  estimatedUSD: string; maxEstimatedUSD?: string; softLimitOverride?: true; submittedAt: string;
  budgetSessionId?: string; sessionPriorUSD?: string; sessionLimitUSD?: string; sessionLimitOverride?: true;
  status: 'PREPARED' | 'SUBMITTED' | 'DEFINITIVE_FAILURE' | 'UNKNOWN' | 'DEFINITIVE_SUCCESS';
  usage: Record<string, unknown> | null; observedUSD: string | null; pricingSnapshot?: string;
  failure?: StudioFailure;
  acknowledgedAt?: string; recordedOutcome?: StudioRecordedOutcome;
  cleanupPending?: true;
  recoveryLockVersion?: 1;
};
export type StudioFailure = { category: 'pre_send' | 'rejected' | 'rate_limited' | 'provider_limit' | 'unknown'; retryAfterSeconds?: number };
export type StudioRecordedOutcome = 'UNKNOWN' | 'DEFINITIVE_SUCCESS' | 'DEFINITIVE_FAILURE';

export function validStudioAcknowledgement(acknowledgedAt: unknown, recordedOutcome: unknown): acknowledgedAt is string {
  if (typeof acknowledgedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(acknowledgedAt)) return false;
  const time = Date.parse(acknowledgedAt);
  const canonical = acknowledgedAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  return Number.isFinite(time) && new Date(time).toISOString() === canonical &&
    (recordedOutcome === 'UNKNOWN' || recordedOutcome === 'DEFINITIVE_SUCCESS' || recordedOutcome === 'DEFINITIVE_FAILURE');
}

export function studioAttemptBlocks(attempt: StudioAttempt): boolean {
  if (attempt.cleanupPending !== undefined) {
    return attempt.cleanupPending !== true ||
      !validStudioAcknowledgement(attempt.acknowledgedAt, attempt.recordedOutcome) ||
      attempt.recordedOutcome !== attempt.status;
  }
  if (attempt.status !== 'UNKNOWN' && attempt.status !== 'SUBMITTED' &&
      (attempt.acknowledgedAt !== undefined || attempt.recordedOutcome !== undefined)) return true;
  return attempt.status === 'SUBMITTED' || (attempt.status === 'UNKNOWN' &&
    !validStudioAcknowledgement(attempt.acknowledgedAt, attempt.recordedOutcome));
}

export function studioReviewFingerprint(attempts: StudioAttempt[]): string {
  return JSON.stringify(attempts.filter((attempt) => validStudioAcknowledgement(attempt.acknowledgedAt, attempt.recordedOutcome))
    .map((attempt) => [attempt.attemptId, attempt.acknowledgedAt, attempt.recordedOutcome])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export async function globalStudioReviewFingerprint(): Promise<string> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readonly');
    const request = tx.objectStore('attempts').getAll();
    tx.oncomplete = () => resolve(studioReviewFingerprint(request.result as StudioAttempt[]));
    tx.onabort = () => reject(transactionError(tx));
  });
}
type ImportedAttemptMarker = { key: string; snapshot: string; reviewed: boolean };

function importedAttemptMarker(settings: unknown[], attempt: StudioAttempt): ImportedAttemptMarker | undefined {
  const marker = settings.find((row) => row && typeof row === 'object' && (row as { key?: unknown }).key === importAttemptKey(attempt.attemptId)) as ImportedAttemptMarker | undefined;
  if (marker && (!exactKeys(marker, ['key', 'snapshot', 'reviewed']) || marker.snapshot !== JSON.stringify(attempt) || typeof marker.reviewed !== 'boolean')) {
    throw new Error('Imported attempt history changed; local billing review cannot be trusted.');
  }
  return marker;
}

// The caller must first obtain explicit human confirmation of external billing and rate-limit review.
// This records no provider outcome and never contacts the gateway.
export async function resolveImportedUncertainty(attemptId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['attempts', 'userSettings'], 'readwrite');
    const attempt = tx.objectStore('attempts').get(attemptId);
    const marker = tx.objectStore('userSettings').get(importAttemptKey(attemptId));
    let failure: Error | undefined;
    marker.onsuccess = () => {
      try {
        if (!attempt.result) throw new Error('The imported attempt is missing.');
        const checked = importedAttemptMarker([marker.result], attempt.result as StudioAttempt);
        if (!checked) throw new Error('This attempt is not imported uncertainty.');
        if (!checked.reviewed) tx.objectStore('userSettings').put({ ...checked, reviewed: true });
      } catch (error) { failure = error instanceof Error ? error : new Error('Could not review imported uncertainty.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

function blocksWithImportedReview(attempt: StudioAttempt, settings: unknown[]): boolean {
  const marker = importedAttemptMarker(settings, attempt);
  return marker ? !marker.reviewed : studioAttemptBlocks(attempt);
}

export async function acknowledgeStudioAttempt(attemptId: string, acknowledgedAt: string, recordedOutcome: StudioRecordedOutcome): Promise<void> {
  if (!validStudioAcknowledgement(acknowledgedAt, recordedOutcome)) throw new Error('Invalid acknowledgement receipt.');
  const db = await openDatabase();
  const snapshot = await new Promise<StudioAttempt[]>((resolve, reject) => {
    const tx = db.transaction('attempts', 'readonly'), request = tx.objectStore('attempts').getAll();
    tx.oncomplete = () => resolve(request.result as StudioAttempt[]);
    tx.onabort = () => reject(transactionError(tx));
  });
  const promptHashes = new Map(await Promise.all(snapshot
    .filter((row) => row.attemptId === attemptId || row.status === 'PREPARED')
    .map(async (row) => {
      if (typeof row.prompt !== 'string') throw new Error('The saved attempt prompt is invalid.');
      return [row.attemptId, { prompt: row.prompt, hash: await sha256(new TextEncoder().encode(row.prompt)) }] as const;
    })));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['attempts', 'jobs', 'userSettings'], 'readwrite');
    const marker = tx.objectStore('userSettings').get(importAttemptKey(attemptId));
    const settings = tx.objectStore('userSettings').getAll();
    const attempts = tx.objectStore('attempts');
    const request = attempts.get(attemptId);
    const initial = attempts.getAll();
    let failure: Error | undefined;
    request.onsuccess = () => {
      const attempt = request.result as StudioAttempt | undefined;
      if (marker.result !== undefined) { failure = new Error('Imported attempts cannot acknowledge a gateway journal. Review imported uncertainty locally.'); tx.abort(); return; }
      const terminal = attempt?.status === 'DEFINITIVE_SUCCESS' || attempt?.status === 'DEFINITIVE_FAILURE';
      if (!attempt || (attempt.status !== 'UNKNOWN' && attempt.status !== 'SUBMITTED' && !(terminal && attempt.cleanupPending === true))) {
        failure = new Error('Only a saved UNKNOWN, SUBMITTED or cleanup-pending terminal attempt can be reviewed.'); tx.abort(); return;
      }
      const jobRequest = tx.objectStore('jobs').get(attempt.jobId);
      jobRequest.onsuccess = () => {
        try {
          if (terminal && recordedOutcome !== attempt.status) throw new Error('The acknowledgement outcome conflicts with the saved terminal outcome.');
          if (attempt.cleanupPending !== undefined && attempt.cleanupPending !== true) throw new Error('Invalid cleanup metadata.');
          const job = jobRequest.result as StudioJob | undefined;
          const entry = job?.attempts.find((item) => item.attemptId === attempt.attemptId);
          if (!job || !entry) throw new Error('The saved job does not match its attempt.');
          const savedPrompt = promptHashes.get(attempt.attemptId);
          if (!savedPrompt || savedPrompt.prompt !== attempt.prompt) throw new Error('The saved attempt changed during review.');
          verifyStudioLineage(job, initial.result as StudioAttempt[], savedPrompt.hash);
          if (validStudioAcknowledgement(attempt.acknowledgedAt, attempt.recordedOutcome)) {
            if ((attempt.status !== 'UNKNOWN' && !terminal) || attempt.acknowledgedAt !== acknowledgedAt || attempt.recordedOutcome !== recordedOutcome) {
              throw new Error('The saved acknowledgement conflicts with this receipt.');
            }
            return;
          }
          const reviewed: StudioAttempt = { ...attempt, status: terminal ? attempt.status : 'UNKNOWN', acknowledgedAt, recordedOutcome };
          if (attempt.status === 'SUBMITTED') {
            tx.objectStore('jobs').put(replaceStudioJobEntry(job, reviewed, entry.submittedAt, acknowledgedAt));
          }
          attempts.put(reviewed);
          const all = attempts.getAll();
          all.onsuccess = () => {
            try {
              for (const pending of all.result as StudioAttempt[]) {
                if (pending.attemptId === attempt.attemptId || pending.status !== 'PREPARED') continue;
                if (importedAttemptMarker(settings.result, pending)) continue;
                const pendingJobRequest = tx.objectStore('jobs').get(pending.jobId);
                pendingJobRequest.onsuccess = () => {
                  try {
                    const pendingJob = pendingJobRequest.result as StudioJob | undefined;
                    const pendingEntry = pendingJob?.attempts.find((item) => item.attemptId === pending.attemptId);
                    if (!pendingJob || !pendingEntry) throw new Error('A prepared job does not match its attempt.');
                    const savedPrompt = promptHashes.get(pending.attemptId);
                    if (!savedPrompt || savedPrompt.prompt !== pending.prompt) throw new Error('A prepared attempt changed during review.');
                    verifyStudioLineage(pendingJob, all.result as StudioAttempt[], savedPrompt.hash);
                    const invalidated: StudioAttempt = { ...pending, status: 'DEFINITIVE_FAILURE' };
                    tx.objectStore('jobs').put(replaceStudioJobEntry(pendingJob, invalidated, pendingEntry.submittedAt, new Date().toISOString()));
                    attempts.put(invalidated);
                  } catch (error) {
                    failure = error instanceof Error ? error : new Error('Could not invalidate a prepared attempt.'); tx.abort();
                  }
                };
              }
            } catch (error) {
              failure = error instanceof Error ? error : new Error('Could not verify imported attempt markers.'); tx.abort();
            }
          };
        } catch (error) {
          failure = error instanceof Error ? error : new Error('Could not save the acknowledgement.'); tx.abort();
        }
      };
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}
export type StudioAsset = { assetId: string; attemptId: string; productId: string; blob: Blob; sha256: string };

function isStudioScene(value: unknown): value is StudioAsset & { kind?: never } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const keys = ['assetId', 'attemptId', 'productId', 'blob', 'sha256'];
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}

export type StudioJob = {
  schemaVersion: '1.0.0'; jobId: string; productId: string; styleId: StudioStyleId; presetVersion?: string;
  lockMode: 'STRICT'; operation: 'generate_scene'; sourceHashes: string[];
  promptVersion: string; promptSha256: string; model: string; quality: string; size: string;
  status: string; createdAt: string;
  attempts: Array<{ attemptId: string; state: string; createdAt: string; submittedAt: string | null;
    completedAt: string | null; estimatedUSD: string; observedUSD: string | null;
    providerRequestId: null; usage: Record<string, unknown> | null; pricingSnapshot?: string; outcome?: string;
    retryOf?: string; errorCode?: StudioFailure['category']; retryAfterSeconds?: number }>;
};

function studioJob(attempt: StudioAttempt, promptHash: string, sentAt: string | null, completedAt: string | null): StudioJob {
  const status = {
    PREPARED: ['QUEUED', 'QUEUED'],
    SUBMITTED: ['SUBMITTING', 'SUBMITTING'],
    DEFINITIVE_FAILURE: ['FAILED', 'FAILED'],
    UNKNOWN: ['UNKNOWN', 'UNKNOWN'],
    DEFINITIVE_SUCCESS: ['GENERATED', 'SUCCEEDED'],
  }[attempt.status];
  const outcome = attempt.status === 'PREPARED' ? 'NOT_SUBMITTED' : attempt.status === 'SUBMITTED' ? undefined : attempt.status;
  return {
    schemaVersion: '1.0.0', jobId: attempt.jobId, productId: attempt.productId, styleId: attempt.styleId ?? 'studio',
    ...(attempt.presetVersion === undefined ? {} : { presetVersion: attempt.presetVersion }),
    lockMode: 'STRICT', operation: 'generate_scene', sourceHashes: [attempt.sourceSha256],
    promptVersion: attempt.promptVersion, promptSha256: promptHash, model: attempt.model,
    quality: attempt.quality, size: attempt.size, status: status[0], createdAt: attempt.submittedAt,
    attempts: [{ attemptId: attempt.attemptId, state: status[1], createdAt: attempt.submittedAt,
      submittedAt: sentAt, completedAt, estimatedUSD: attempt.estimatedUSD, observedUSD: attempt.observedUSD,
      providerRequestId: null, usage: attempt.usage, ...(attempt.pricingSnapshot === undefined ? {} : { pricingSnapshot: attempt.pricingSnapshot }), ...(outcome ? { outcome } : {}),
      ...(attempt.retryOf === undefined ? {} : { retryOf: attempt.retryOf }),
      ...(attempt.failure === undefined ? {} : { errorCode: attempt.failure.category, ...(attempt.failure.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: attempt.failure.retryAfterSeconds }) }) }],
  };
}

function checkedStudioJob(job: StudioJob): StudioJob {
  if (!validateGenerationJob(job)) throw new Error('The generation job is invalid. No changes were saved.');
  return job;
}

function validateStudioFailure(attempt: StudioAttempt): void {
  const failure = attempt.failure;
  if (failure === undefined) return;
  if (!failure || typeof failure !== 'object' || Array.isArray(failure) ||
      Object.keys(failure).some((key) => key !== 'category' && key !== 'retryAfterSeconds') ||
      !['pre_send', 'rejected', 'rate_limited', 'provider_limit', 'unknown'].includes(failure.category) ||
      (attempt.status !== 'DEFINITIVE_FAILURE' && attempt.status !== 'UNKNOWN') ||
      (attempt.status === 'UNKNOWN' && failure.category !== 'unknown') ||
      (attempt.status === 'DEFINITIVE_FAILURE' && failure.category === 'unknown') ||
      (failure.retryAfterSeconds !== undefined &&
        (!['rate_limited', 'provider_limit', 'unknown'].includes(failure.category) || !Number.isInteger(failure.retryAfterSeconds) ||
         failure.retryAfterSeconds < 1 || failure.retryAfterSeconds > STUDIO_MAX_RETRY_AFTER_SECONDS))) {
    throw new Error('The attempt failure metadata is invalid.');
  }
}

const retryInputKeys: Array<keyof StudioAttempt> = [
  'jobId', 'productId', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'prompt', 'promptVersion',
  'model', 'quality', 'size', 'styleId', 'presetVersion', 'sceneContext', 'selectedFactIds',
  'productSnapshotFingerprint', 'topViewConfirmed', 'estimatedUSD',
];
function sameRetryInputs(a: StudioAttempt, b: StudioAttempt): boolean {
  return retryInputKeys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}
function retryEligible(attempt: StudioAttempt): boolean {
  return !studioAttemptBlocks(attempt) &&
    (attempt.status === 'DEFINITIVE_SUCCESS' || attempt.status === 'DEFINITIVE_FAILURE' ||
      (attempt.status === 'UNKNOWN' && validStudioAcknowledgement(attempt.acknowledgedAt, attempt.recordedOutcome)));
}

function enforceRetryDelay(entry: StudioJob['attempts'][number]): void {
  if (entry.retryAfterSeconds === undefined) return;
  if (!validStudioAcknowledgement(entry.completedAt, 'UNKNOWN') ||
      Date.now() < Date.parse(entry.completedAt) + entry.retryAfterSeconds * 1000) {
    throw new Error('The retry delay has not elapsed or its completion time is invalid. Wait before retrying.');
  }
}

// Validate the complete ordered lineage, not merely the selected attempt. The job's
// status belongs to its latest entry; older outputs remain independently addressable.
function verifyStudioLineage(job: StudioJob, records: StudioAttempt[], promptHash: string): void {
  if (!validateGenerationJob(job) || !job.attempts.length) throw new Error('The saved job is invalid.');
  const rows = records.filter((row) => row.jobId === job.jobId);
  if (rows.length !== job.attempts.length || new Set(job.attempts.map((entry) => entry.attemptId)).size !== job.attempts.length) {
    throw new Error('The saved job lineage does not match its attempts.');
  }
  const ordered = job.attempts.map((entry) => rows.find((row) => row.attemptId === entry.attemptId));
  if (ordered.some((row) => !row)) throw new Error('The saved job lineage is incomplete.');
  const first = ordered[0]!;
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index]!, entry = job.attempts[index];
    validateStudioFailure(row);
    if (!uuidPattern.test(row.attemptId) || row.productId !== job.productId ||
        !sameRetryInputs(first, row) || row.retryOf !== (index === 0 ? undefined : ordered[index - 1]!.attemptId) ||
        (index > 0 && !retryEligible(ordered[index - 1]!))) {
      throw new Error('The saved job retry lineage is invalid.');
    }
    if ((row.status === 'PREPARED' && (entry.submittedAt !== null || entry.completedAt !== null)) ||
        (row.status === 'SUBMITTED' && (entry.submittedAt === null || entry.completedAt !== null)) ||
        ((row.status === 'DEFINITIVE_SUCCESS' || row.status === 'UNKNOWN') && (entry.submittedAt === null || entry.completedAt === null)) ||
        (row.status === 'DEFINITIVE_FAILURE' && entry.completedAt === null)) {
      throw new Error('The saved job submission time or completion time is invalid.');
    }
    const expected = studioJob(row, promptHash, entry.submittedAt, entry.completedAt);
    if (JSON.stringify(entry) !== JSON.stringify(expected.attempts[0])) throw new Error('The saved job does not match its attempt.');
    const { status: ignoredStatus, createdAt: ignoredCreatedAt, attempts: ignoredAttempts, ...shared } = expected;
    const { status: jobStatus, createdAt: jobCreatedAt, attempts: jobAttempts, ...actualShared } = job;
    if (JSON.stringify(shared) !== JSON.stringify(actualShared) ||
        jobCreatedAt !== first.submittedAt || (index === ordered.length - 1 && jobStatus !== expected.status)) {
      throw new Error('The saved job does not match its attempt.');
    }
  }
}

// Persisted wait guidance applies to every local submission, including a new job
// or another product. Verify both sides before trusting any stored delay.
function enforceLocalRetryDelays(jobs: StudioJob[], attempts: StudioAttempt[], settings: unknown[]): void {
  const affected = new Set<string>();
  for (const attempt of attempts) {
    const failure = attempt.failure;
    if (failure !== undefined && (failure?.category === 'rate_limited' || failure?.category === 'provider_limit' ||
        failure?.retryAfterSeconds !== undefined)) {
      validateStudioFailure(attempt);
      affected.add(attempt.jobId);
    }
  }
  for (const job of jobs) {
    if (Array.isArray(job.attempts) && job.attempts.some((entry) =>
      entry.errorCode === 'rate_limited' || entry.errorCode === 'provider_limit' || entry.retryAfterSeconds !== undefined)) {
      affected.add(job.jobId);
    }
  }
  for (const jobId of affected) {
    const job = jobs.find((row) => row.jobId === jobId);
    if (!job) throw new Error('The saved rate-limit job is missing. Generation is disabled.');
    verifyStudioLineage(job, attempts, job.promptSha256);
    const lineage = attempts.filter((row) => row.jobId === jobId);
    const imported = lineage.map((row) => importedAttemptMarker(settings, row));
    if (imported.some(Boolean)) {
      if (imported.some((marker) => !marker || !marker.reviewed)) throw new Error('Review imported billing and rate-limit uncertainty before generating.');
      continue;
    }
    for (const entry of job.attempts) enforceRetryDelay(entry);
  }
}

function replaceStudioJobEntry(job: StudioJob, attempt: StudioAttempt, sentAt: string | null, completedAt: string | null): StudioJob {
  const index = job.attempts.findIndex((entry) => entry.attemptId === attempt.attemptId);
  if (index < 0) throw new Error('The saved job does not match its attempt.');
  const next = studioJob(attempt, job.promptSha256, sentAt, completedAt);
  const attempts = job.attempts.slice();
  attempts[index] = next.attempts[0];
  return checkedStudioJob({ ...job, attempts, status: index === attempts.length - 1 ? next.status : job.status });
}
function studioMoney(value: string): bigint {
  if (!/^\d{1,9}\.\d{1,6}$/.test(value)) throw new Error('Invalid saved session estimate. Generation is disabled.');
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

function studioSessionTotal(attempts: StudioAttempt[], sessionId: string): string {
  for (const entry of attempts) {
    const hasSessionMetadata = entry.budgetSessionId !== undefined || entry.sessionPriorUSD !== undefined || entry.sessionLimitUSD !== undefined || entry.sessionLimitOverride !== undefined;
    if (!hasSessionMetadata) continue;
    if (typeof entry.budgetSessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.budgetSessionId) ||
        typeof entry.sessionPriorUSD !== 'string' || (entry.sessionLimitUSD !== undefined && typeof entry.sessionLimitUSD !== 'string') ||
        (entry.sessionLimitOverride !== undefined && entry.sessionLimitOverride !== true)) throw new Error('Saved session metadata is invalid. Generation is disabled.');
    studioMoney(entry.sessionPriorUSD);
    if (entry.sessionLimitUSD !== undefined) studioMoney(entry.sessionLimitUSD);
  }
  const total = attempts.filter((entry) => entry.budgetSessionId === sessionId)
    .reduce((sum, entry) => sum + studioMoney(entry.estimatedUSD), 0n);
  const whole = total / 1_000_000n;
  if (whole > 999_999_999n) throw new Error('The saved session estimate exceeds the supported limit.');
  return `${whole}.${String(total % 1_000_000n).padStart(6, '0')}`;
}

export async function studioSessionEstimate(sessionId: string): Promise<string> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readonly');
    const request = tx.objectStore('attempts').getAll();
    let total: string, failure: Error | undefined;
    request.onsuccess = () => {
      try { total = studioSessionTotal(request.result as StudioAttempt[], sessionId); }
      catch (error) { failure = error instanceof Error ? error : new Error('Session estimate unavailable.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve(total);
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}


export async function listStyleInputs(productId: string, signal?: AbortSignal): Promise<Array<{ source: SourceMetadata; maskId: string; maskSha256: string }>> {
  if (signal?.aborted) throw new DOMException('Input verification was cancelled.', 'AbortError');
  const product = await getProduct(productId);
  if (signal?.aborted) throw new DOMException('Input verification was cancelled.', 'AbortError');
  if (!product || !product.rightsAcknowledged) throw new Error('A rights-acknowledged project is required.');
  const entries: Array<{ source: SourceMetadata; maskId: string; maskSha256: string }> = [];
  for (const source of product.sourceAssets) {
    if (signal?.aborted) throw new DOMException('Input verification was cancelled.', 'AbortError');
    const mask = await loadSourceMask(productId, source);
    if (signal?.aborted) throw new DOMException('Input verification was cancelled.', 'AbortError');
    if (mask) entries.push({ source, maskId: mask.maskId, maskSha256: mask.sha256 });
  }
  return entries;
}

export async function studioInput(productId: string, sourceAssetId?: string): Promise<{ source: SourceMetadata; maskId: string; maskSha256: string }> {
  if (sourceAssetId !== undefined) {
    const product = await getProduct(productId);
    if (!product || !product.rightsAcknowledged) throw new Error('A rights-acknowledged project is required.');
    const source = product.sourceAssets.find((entry) => entry.assetId === sourceAssetId);
    if (!source) throw new Error('The selected source no longer belongs to this project.');
    const mask = await loadSourceMask(productId, source);
    if (!mask) throw new Error('The selected source has no verified saved mask.');
    return { source, maskId: mask.maskId, maskSha256: mask.sha256 };
  }
  const db = await openDatabase();
  const snapshot = await new Promise<{ product: Product; mask: unknown }>((resolve, reject) => {
    const tx = db.transaction(['products', 'masks'], 'readonly');
    const request = tx.objectStore('products').get(productId);
    let product: Product, mask: IDBRequest | undefined, failure: Error | undefined;
    request.onsuccess = () => {
      try {
        product = checkedProduct(request.result);
        if (!product.rightsAcknowledged || !product.brandLock.maskAssetId) throw new Error('A rights-acknowledged source and active saved mask are required.');
        mask = tx.objectStore('masks').get(product.brandLock.maskAssetId);
      } catch (error) { failure = error instanceof Error ? error : new Error('Project is unavailable.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve({ product, mask: mask?.result });
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
  const active = await verifyMask(snapshot.product, snapshot.mask);
  const source = snapshot.product.sourceAssets.find((item) => item.assetId === active.metadata.sourceAssetId);
  if (!source || active.metadata.maskId !== snapshot.product.brandLock.maskAssetId) throw new Error('The active mask does not match an owned source.');
  const verified = await loadSourceMask(productId, source);
  if (!verified || verified.sha256 !== active.metadata.sha256) throw new Error('The active saved mask could not be verified.');
  return { source, maskId: active.metadata.maskId, maskSha256: active.metadata.sha256 };
}

export async function createStudioAttempt(attempt: StudioAttempt, consentReviewFingerprint: string): Promise<void> {
  if (attempt.status !== 'PREPARED' || attempt.usage !== null || attempt.observedUSD !== null || attempt.pricingSnapshot !== undefined || attempt.failure !== undefined || attempt.acknowledgedAt !== undefined || attempt.recordedOutcome !== undefined || attempt.cleanupPending !== undefined || (attempt.recoveryLockVersion !== undefined && attempt.recoveryLockVersion !== 1) ||
      !uuidPattern.test(attempt.attemptId) || (attempt.retryOf !== undefined && (!uuidPattern.test(attempt.retryOf) || attempt.retryOf === attempt.attemptId))) throw new Error('A new attempt must be prepared without a result and with valid identity and recovery metadata.');
  const snapshot = await getProduct(attempt.productId);
  if (!snapshot) throw new Error('The project no longer exists.');
  validateAttemptContext(attempt, snapshot);
  if (attempt.productSnapshotFingerprint !== undefined && await productSnapshotFingerprint(snapshot) !== attempt.productSnapshotFingerprint) throw new Error('The product changed since consent.');
  const promptHash = await sha256(new TextEncoder().encode(attempt.prompt));
  const job = checkedStudioJob(studioJob(attempt, promptHash, null, null));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['products', 'masks', 'sourceAssets', 'jobs', 'attempts', 'userSettings'], 'readwrite');
    const product = tx.objectStore('products').get(attempt.productId);
    const mask = tx.objectStore('masks').get(attempt.maskId);
    const source = tx.objectStore('sourceAssets').get(attempt.sourceAssetId);
    const versions = tx.objectStore('masks').index('sourceAssetId').getAll(attempt.sourceAssetId);
    const existingJob = tx.objectStore('jobs').get(attempt.jobId);
    const allJobs = tx.objectStore('jobs').getAll();
    const settings = tx.objectStore('userSettings').getAll();
    const attempts = tx.objectStore('attempts').getAll();
    let failure: Error | undefined;
    attempts.onsuccess = () => {
      try {
        const p = checkedProduct(product.result);
        const m = mask.result as Record<string, unknown> | undefined;
        const s = source.result as Record<string, unknown> | undefined;
        if (attempt.productSnapshotFingerprint !== undefined && productSnapshot(p) !== productSnapshot(snapshot)) throw new Error('The product changed since consent.');
        validateAttemptContext(attempt, p);
        enforceLocalRetryDelays(allJobs.result as StudioJob[], attempts.result as StudioAttempt[], settings.result);
        if ((attempts.result as StudioAttempt[]).some((entry) => blocksWithImportedReview(entry, settings.result) ||
            (!importedAttemptMarker(settings.result, entry) && entry.productId === attempt.productId && entry.status === 'PREPARED' &&
              (attempt.retryOf !== undefined || entry.retryOf !== undefined)))) {
          throw new Error('Another local attempt is in progress or UNKNOWN. Review its history before generating.');
        }
        if (attempt.retryOf && (attempts.result as StudioAttempt[]).some((entry) => entry.attemptId === attempt.retryOf && importedAttemptMarker(settings.result, entry))) {
          throw new Error('Imported uncertainty cannot be retried as the same job; start a new job after local review.');
        }
        if (studioReviewFingerprint(attempts.result as StudioAttempt[]) !== consentReviewFingerprint) {
          throw new Error('A review changed the attempt history after consent. Review the history and authorize a new attempt.');
        }
        if (attempt.budgetSessionId !== undefined &&
            (attempt.sessionPriorUSD === undefined || studioSessionTotal(attempts.result as StudioAttempt[], attempt.budgetSessionId) !== attempt.sessionPriorUSD)) {
          throw new Error('The session estimate changed after consent. Review the updated total and authorize a new attempt.');
        }
        if (!p.rightsAcknowledged || (attempt.styleId === undefined && p.brandLock.maskAssetId !== attempt.maskId) ||
            !p.sourceAssets.some((item) => item.assetId === attempt.sourceAssetId && item.sha256 === attempt.sourceSha256) ||
            !m || m.productId !== attempt.productId || m.sourceAssetId !== attempt.sourceAssetId || m.sourceSha256 !== attempt.sourceSha256 || m.sha256 !== attempt.maskSha256 ||
            !s || s.productId !== attempt.productId || s.sha256 !== attempt.sourceSha256 ||
            (versions.result as MaskMetadata[]).some((row) => row.version > (m.version as number))) throw new Error('The source or mask version changed. Review it again before generating.');
        if (attempt.retryOf !== undefined) {
          if (attempt.promptVersion !== STUDIO_SCENE_PROMPT_VERSION || !attempt.styleId || !attempt.presetVersion) {
            throw new Error('Legacy jobs cannot be retried. Start a new versioned job instead.');
          }
          const saved = existingJob.result as StudioJob | undefined;
          if (!saved) throw new Error('The retry job is missing.');
          verifyStudioLineage(saved, attempts.result as StudioAttempt[], promptHash);
          const latest = saved.attempts[saved.attempts.length - 1];
          const predecessor = (attempts.result as StudioAttempt[]).find((row) => row.attemptId === latest.attemptId);
          if (!predecessor || latest.attemptId !== attempt.retryOf || !retryEligible(predecessor) ||
              !sameRetryInputs(predecessor, attempt) || saved.attempts.length >= 100) {
            throw new Error('The retry predecessor is stale, ineligible, or its job inputs changed.');
          }
          enforceRetryDelay(latest);
          tx.objectStore('jobs').put(checkedStudioJob({ ...saved, status: job.status, attempts: [...saved.attempts, job.attempts[0]] }));
        } else {
          tx.objectStore('jobs').add(job);
        }
        tx.objectStore('attempts').add(attempt);
      } catch (error) { failure = error instanceof Error ? error : new Error('Could not save the attempt.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

export async function updateStudioAttempt(attempt: StudioAttempt, asset?: StudioAsset, consentReviewFingerprint?: string, expectedSessionTotal?: string): Promise<void> {
  const promptHash = await sha256(new TextEncoder().encode(attempt.prompt));
  const snapshot = await getProduct(attempt.productId);
  if (!snapshot) throw new Error('The project no longer exists.');
  if (attempt.status === 'SUBMITTED') {
    validateAttemptContext(attempt, snapshot);
    if (attempt.productSnapshotFingerprint !== undefined && await productSnapshotFingerprint(snapshot) !== attempt.productSnapshotFingerprint) throw new Error('The product changed since consent.');
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['products', 'masks', 'sourceAssets', 'jobs', 'attempts', 'generatedAssets', 'userSettings'], 'readwrite');
    const previousRequest = tx.objectStore('attempts').get(attempt.attemptId);
    const jobRequest = tx.objectStore('jobs').get(attempt.jobId);
    const productRequest = tx.objectStore('products').get(attempt.productId);
    const maskRequest = tx.objectStore('masks').get(attempt.maskId);
    const sourceRequest = tx.objectStore('sourceAssets').get(attempt.sourceAssetId);
    const versionsRequest = tx.objectStore('masks').index('sourceAssetId').getAll(attempt.sourceAssetId);
    const allJobs = tx.objectStore('jobs').getAll();
    const settings = tx.objectStore('userSettings').getAll();
    const allAttempts = tx.objectStore('attempts').getAll();
    let failure: Error | undefined;
    allAttempts.onsuccess = () => {
      try {
        const previous = previousRequest.result as StudioAttempt | undefined;
        const job = jobRequest.result as StudioJob | undefined;
        if (!previous || !job || !validateGenerationJob(job)) throw new Error('The saved attempt or job is missing or invalid.');
        if (importedAttemptMarker(settings.result, previous)) throw new Error('Imported uncertain attempts cannot be changed or submitted.');
        const immutable: Array<keyof StudioAttempt> = ['attemptId', 'retryOf', 'jobId', 'productId', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'prompt', 'promptVersion', 'model', 'quality', 'size', 'estimatedUSD', 'maxEstimatedUSD', 'softLimitOverride', 'budgetSessionId', 'sessionPriorUSD', 'sessionLimitUSD', 'sessionLimitOverride', 'submittedAt', 'acknowledgedAt', 'recordedOutcome', 'recoveryLockVersion', 'styleId', 'presetVersion', 'productSnapshotFingerprint', 'topViewConfirmed'];
        if (immutable.some((key) => previous[key] !== attempt[key]) || JSON.stringify(previous.sceneContext) !== JSON.stringify(attempt.sceneContext) || JSON.stringify(previous.selectedFactIds) !== JSON.stringify(attempt.selectedFactIds)) throw new Error('Attempt identity or input changed.');
        const allowed = previous.status === 'PREPARED' ? ['SUBMITTED', 'DEFINITIVE_FAILURE'] : previous.status === 'SUBMITTED' ? ['DEFINITIVE_FAILURE', 'DEFINITIVE_SUCCESS', 'UNKNOWN'] : [];
        if (attempt.status === 'SUBMITTED' && (allAttempts.result as StudioAttempt[]).some((entry) =>
          entry.attemptId !== attempt.attemptId && (blocksWithImportedReview(entry, settings.result) ||
            (!importedAttemptMarker(settings.result, entry) && entry.productId === attempt.productId && entry.status === 'PREPARED' &&
              (entry.retryOf !== undefined || attempt.retryOf !== undefined))))) {
          throw new Error('Another local attempt is in progress or UNKNOWN. Review its history before generating.');
        }
        if (!allowed.includes(attempt.status)) throw new Error('Invalid or repeated attempt transition.');
        validateStudioFailure(attempt);
        if (previous.cleanupPending !== undefined || (attempt.cleanupPending !== undefined &&
            (attempt.cleanupPending !== true || previous.status !== 'SUBMITTED' ||
             (attempt.status !== 'DEFINITIVE_SUCCESS' && attempt.status !== 'DEFINITIVE_FAILURE')))) throw new Error('Invalid cleanup metadata.');
        if (attempt.status === 'SUBMITTED' &&
            studioReviewFingerprint(allAttempts.result as StudioAttempt[]) !== consentReviewFingerprint) {
          throw new Error('A review changed the attempt history after consent. Review the history and authorize a new attempt.');
        }
        if (attempt.status === 'SUBMITTED' && expectedSessionTotal !== undefined &&
            (!attempt.budgetSessionId || studioSessionTotal(allAttempts.result as StudioAttempt[], attempt.budgetSessionId) !== expectedSessionTotal)) {
          throw new Error('The session estimate changed after consent. Review the updated total before sending.');
        }
        if (attempt.status === 'SUBMITTED') {
          enforceLocalRetryDelays(allJobs.result as StudioJob[], allAttempts.result as StudioAttempt[], settings.result);
          const product = checkedProduct(productRequest.result);
          const mask = maskRequest.result as Record<string, unknown> | undefined;
          const source = sourceRequest.result as Record<string, unknown> | undefined;
          if (attempt.productSnapshotFingerprint !== undefined && productSnapshot(product) !== productSnapshot(snapshot)) throw new Error('The product changed since consent.');
          validateAttemptContext(attempt, product);
          if (!product.rightsAcknowledged || (attempt.styleId === undefined && product.brandLock.maskAssetId !== attempt.maskId) ||
              !product.sourceAssets.some((item) => item.assetId === attempt.sourceAssetId && item.sha256 === attempt.sourceSha256) ||
              !mask || mask.productId !== attempt.productId || mask.sourceAssetId !== attempt.sourceAssetId ||
              mask.sourceSha256 !== attempt.sourceSha256 || mask.sha256 !== attempt.maskSha256 ||
              !source || source.productId !== attempt.productId || source.sha256 !== attempt.sourceSha256 ||
              (versionsRequest.result as MaskMetadata[]).some((row) => row.version > (mask.version as number))) {
            throw new Error('The source or active mask changed. Review it again before generating.');
          }
        }
        if ((attempt.status === 'DEFINITIVE_SUCCESS') !== Boolean(asset) ||
            (asset && (asset.attemptId !== attempt.attemptId || asset.productId !== attempt.productId || !(asset.blob instanceof Blob) || !hashPattern.test(asset.sha256))) ||
            (attempt.status !== 'DEFINITIVE_SUCCESS' && (attempt.usage !== null || attempt.observedUSD !== null || attempt.pricingSnapshot !== undefined)) ||
            ((attempt.observedUSD === null) !== (attempt.pricingSnapshot === undefined))) throw new Error('Attempt outcome and asset do not match.');
        verifyStudioLineage(job, allAttempts.result as StudioAttempt[], promptHash);
        const oldEntry = job.attempts.find((entry) => entry.attemptId === attempt.attemptId);
        if (!oldEntry || job.attempts[job.attempts.length - 1].attemptId !== attempt.attemptId) throw new Error('The saved job does not match its latest attempt.');
        if (attempt.status === 'SUBMITTED' && attempt.retryOf !== undefined) {
          const predecessorEntry = job.attempts[job.attempts.length - 2];
          if (!predecessorEntry || predecessorEntry.attemptId !== attempt.retryOf) throw new Error('The retry predecessor is invalid.');
          enforceRetryDelay(predecessorEntry);
        }
        const now = new Date().toISOString();
        const sentAt = attempt.status === 'SUBMITTED' ? now : oldEntry.submittedAt;
        const completedAt = attempt.status === 'SUBMITTED' ? null : now;
        const next = replaceStudioJobEntry(job, attempt, sentAt, completedAt);
        tx.objectStore('jobs').put(next);
        tx.objectStore('attempts').put(attempt);
        if (asset) tx.objectStore('generatedAssets').add(asset);
      } catch (error) { failure = error instanceof Error ? error : new Error('Could not update the attempt.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

export async function listStudioAttempts(productId: string): Promise<Array<{ attempt: StudioAttempt; asset: StudioAsset | null; importedUnresolved: boolean; importedUntrusted: boolean }>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs', 'attempts', 'generatedAssets', 'userSettings'], 'readonly');
    const jobs = tx.objectStore('jobs').index('productId').getAll(productId);
    const attempts = tx.objectStore('attempts').getAll();
    const assets = tx.objectStore('generatedAssets').index('productId').getAll(productId);
    const settings = tx.objectStore('userSettings').getAll();
    tx.oncomplete = () => {
      try {
        const ids = new Set((jobs.result as Array<{ jobId: string }>).map((job) => job.jobId));
        resolve((attempts.result as StudioAttempt[]).filter((attempt) => ids.has(attempt.jobId))
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
          .map((attempt) => {
            const marker = importedAttemptMarker(settings.result, attempt);
            return { attempt, asset: (assets.result as unknown[]).find((asset): asset is StudioAsset => isStudioScene(asset) && asset.attemptId === attempt.attemptId) ?? null,
              importedUnresolved: Boolean(marker && !marker.reviewed), importedUntrusted: Boolean(marker) };
          }));
      } catch (error) { reject(error); }
    };
    tx.onabort = () => reject(transactionError(tx));
  });
}

export type StrictMapping = {
  x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number;
};
export type StrictCompositeInputs = {
  source: Blob; mask: Blob; scene: Blob; sourceWidth: number; sourceHeight: number;
  sourceAssetId: string; sourceSha256: string; maskId: string; maskSha256: string;
  sceneAssetId: string; sceneSha256: string;
  protectedEvidence?: ProtectedEvidence; protectedEvidenceSha256?: string;
  styleId?: StudioStyleId; sourceView?: StudioSceneContext['sourceView'];
  topViewConfirmed?: true;
};
export type StrictComposite = {
  kind: 'strict-composite'; assetId: string; productId: string; attemptId: string;
  blob: Blob; sha256: string; sourceAssetId: string; sourceSha256: string;
  maskId: string; maskSha256: string; sceneAssetId: string; sceneSha256: string;
  mapping: StrictMapping; createdAt: string;
  protectedEvidenceSha256?: string;
  recipe?: StrictRecipe; recipeSha256?: string; ad?: Blob; adSha256?: string; copyLayer?: Blob;
};

// Unbound historical composites remain readable but cannot be treated as protected.
function compositeProtectedEvidence(composite: StrictComposite, mask: BackupMask): ProtectedEvidence | undefined {
  if (!Object.hasOwn(composite, 'protectedEvidenceSha256')) return undefined;
  if (typeof composite.protectedEvidenceSha256 !== 'string' || !hashPattern.test(composite.protectedEvidenceSha256) ||
      !mask.metadata.protectedEvidence || composite.protectedEvidenceSha256 !== mask.metadata.protectedEvidenceSha256) {
    throw new Error('The composite protected evidence is missing or changed.');
  }
  return mask.metadata.protectedEvidence;
}

async function verifyStrictPng(blob: Blob, expectedHash?: string): Promise<string> {
  if (!(blob instanceof Blob) || blob.type !== 'image/png' || blob.size < 1 || blob.size > STUDIO_MAX_PNG_BYTES) {
    throw new Error('The scene or composite PNG is empty, too large, or has an invalid MIME type.');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = inspectImageHeader(bytes);
  if (header.mimeType !== 'image/png' || header.orientation !== 1 || header.width !== 1024 || header.height !== 1024) {
    throw new Error('The scene or composite must be a 1024 by 1024 PNG.');
  }
  verifyPngChunks(bytes);
  const hash = await sha256(bytes);
  if (expectedHash !== undefined && hash !== expectedHash) throw new Error('The scene or composite hash does not match its bytes.');
  if (typeof createImageBitmap === 'function') {
    let image: ImageBitmap;
    try { image = await createImageBitmap(blob); }
    catch { throw new Error('The scene or composite PNG could not be decoded.'); }
    try {
      if (image.width !== 1024 || image.height !== 1024) throw new Error('The decoded scene or composite dimensions do not match.');
    } finally { image.close(); }
  } else {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The scene or composite PNG could not be decoded.'));
        image.src = url;
      });
      if (image.naturalWidth !== 1024 || image.naturalHeight !== 1024) throw new Error('The decoded scene or composite dimensions do not match.');
    } finally { URL.revokeObjectURL(url); }
  }
  return hash;
}
async function verifyCopyLayer(recipe: StrictRecipe | undefined, copyLayer: Blob | undefined): Promise<void> {
  const needsLayer = recipe?.styleId === 'billboard' && Boolean(recipe.copy);
  if (needsLayer) {
    if (!copyLayer || !recipe?.copyLayerSha256 || !hashPattern.test(recipe.copyLayerSha256)) throw new Error('The frozen copy layer is missing.');
    await verifyStrictPng(copyLayer, recipe.copyLayerSha256);
  } else if (copyLayer !== undefined || recipe?.copyLayerSha256 !== undefined) throw new Error('An unexpected copy layer is present.');
}


function verifyStrictMapping(mapping: StrictMapping, sourceWidth: number, sourceHeight: number, recipe?: StrictRecipe): void {
  if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).length !== 6 ||
      !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1 ||
      mapping.sourceWidth !== sourceWidth || mapping.sourceHeight !== sourceHeight) throw new Error('The composite mapping is invalid.');
  const expectedMapping = recipe ? recipeMapping(recipe, sourceWidth, sourceHeight) : (() => {
    const scale = Math.min(819.2 / sourceWidth, 819.2 / sourceHeight);
    const width = sourceWidth * scale, height = sourceHeight * scale;
    return { width, height, x: (1024 - width) / 2, y: (1024 - height) / 2 };
  })();
  const expected = [expectedMapping.width, expectedMapping.height, expectedMapping.x, expectedMapping.y];
  const actual = [mapping.width, mapping.height, mapping.x, mapping.y];
  if (actual.some((value, index) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value - expected[index]) > 1e-7)) {
    throw new Error('The composite mapping is not the fixed centered fit.');
  }
}

type VisualProvenance = {
  assetSha256: string; sourceSha256: string; maskId: string; maskSha256: string;
  sceneAssetId: string; sceneSha256: string; productSha256: string;
  recipeSha256?: string; adSha256?: string; protectedEvidenceSha256?: string;
};
type VisualReport = {
  qaId: string; assetId: string; sourceSha256: string; lockMode: 'STRICT';
  scores: VisualReviewEvaluation['scores']; weightingVariant: ReviewVariant;
  weightedScore: number; status: VisualReviewEvaluation['status'];
  hardVetoFindings: VisualReviewEvaluation['hardVetoFindings'];
  humanDecision: 'PENDING'; reviewedAt: string; reviewerNote: string;
} & ({ schemaVersion: '1.0.0' } | { schemaVersion: '2.0.0'; findings: ReviewFinding[] });
export type VisualReviewRecord = VisualProvenance & {
  kind: 'visual-review'; qaId: string; assetId: string; productId: string; attemptId: string;
  revision: number; report: VisualReport; scoresText: ReviewScores; checks: ReviewChecks;
  variant: ReviewVariant; createdAt: string;
  styleId?: StudioStyleId; styleChecks?: StyleReviewChecks;
};
export type VisualDecisionRecord = VisualProvenance & {
  kind: 'visual-decision'; qaId: string; assetId: string; productId: string; attemptId: string;
  reportId: string; decision: 'APPROVED' | 'REJECTED'; createdAt: string; current: boolean;
};
export type StoredVisualDecision = Omit<VisualDecisionRecord, 'current'>;
type CheckedVisualHistory = { reviews: VisualReviewRecord[]; decisions: VisualDecisionRecord[] };
type VisualHistory = CheckedVisualHistory & { product: Product; productSha256: string; assetSha256: string; importedReviewRequired: boolean; recipeSha256?: string; adSha256?: string; protectedEvidenceSha256?: string };
type VisualOperation =
  | { kind: 'review'; assetId: string; scoresText: ReviewScores; checks: ReviewChecks; variant: ReviewVariant; note: string; expectedProductSha256: string; expectedAssetSha256: string; expectedRecipeSha256?: string; expectedAdSha256?: string; expectedProtectedEvidenceSha256?: string; styleChecks?: StyleReviewChecks; findings: ReviewFinding[] }
  | { kind: 'decision'; assetId: string; reportId: string; decision: 'APPROVED' | 'REJECTED' }
  | { kind: 'list'; assetId: string };

const provenanceKeys = ['assetSha256', 'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256', 'productSha256'] as const;
function sameProvenance(a: VisualProvenance, b: VisualProvenance): boolean {
  return provenanceKeys.every((key) => a[key] === b[key]) && a.recipeSha256 === b.recipeSha256 && a.adSha256 === b.adSha256 && a.protectedEvidenceSha256 === b.protectedEvidenceSha256;
}
function exactKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function checkedImportReviewBarrier(value: unknown, assetId: string, reviewCount: number): number | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || !exactKeys(value, ['key', 'revision']) || !('key' in value) || !('revision' in value) ||
      value.key !== importReviewKey(assetId) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) ||
      value.revision < 0 || value.revision > reviewCount) throw new Error('The imported review barrier is invalid.');
  return value.revision;
}
function validVisualBase(row: VisualProvenance & { qaId: string; assetId: string; productId: string; attemptId: string; createdAt: string },
  productId: string, attemptId: string, assetId: string): boolean {
  return row.productId === productId && row.attemptId === attemptId && row.assetId === assetId &&
    [row.qaId, row.assetId, row.productId, row.attemptId, row.maskId, row.sceneAssetId].every((id) => typeof id === 'string' && uuidPattern.test(id)) &&
    [row.assetSha256, row.sourceSha256, row.maskSha256, row.sceneSha256, row.productSha256].every((hash) => typeof hash === 'string' && hashPattern.test(hash)) &&
    (row.recipeSha256 === undefined || (typeof row.recipeSha256 === 'string' && hashPattern.test(row.recipeSha256))) &&
    (row.adSha256 === undefined || (row.recipeSha256 !== undefined && typeof row.adSha256 === 'string' && hashPattern.test(row.adSha256))) &&
    (row.protectedEvidenceSha256 === undefined || (typeof row.protectedEvidenceSha256 === 'string' && hashPattern.test(row.protectedEvidenceSha256))) &&
    typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt));
}

function validateVisualNote(note: unknown, checks: ReviewChecks, styleChecks?: StyleReviewChecks): void {
  if (typeof note !== 'string' || note.length > 2000) throw new Error('The review note is invalid.');
  if ([...Object.values(checks), ...Object.values(styleChecks ?? {})].some((check) => check !== 'MATCH') && !note.trim()) {
    throw new Error('Describe the finding and its source/output region or reason in the review note.');
  }
}

function checkedVisualHistory(rows: unknown[], productId: string, attemptId: string, assetId: string, current: VisualProvenance, sourceSize: { width: number; height: number }, currentStyle?: StudioStyleId): CheckedVisualHistory {
  const reviews: VisualReviewRecord[] = [], decisions: StoredVisualDecision[] = [];
  const base = ['kind', 'qaId', 'assetId', 'productId', 'attemptId', ...provenanceKeys, 'createdAt'];
  for (const value of rows) {
    if (!value || typeof value !== 'object') throw new Error('A visual review record is corrupt.');
    const row = value as VisualReviewRecord | StoredVisualDecision;
    if (!validVisualBase(row, productId, attemptId, assetId)) throw new Error('A visual review record has invalid identity or provenance.');
    const common = [...base, ...(row.recipeSha256 === undefined ? [] : ['recipeSha256']), ...(row.adSha256 === undefined ? [] : ['adSha256']), ...(row.protectedEvidenceSha256 === undefined ? [] : ['protectedEvidenceSha256'])];
    if (row.kind === 'visual-review') {
      if (!exactKeys(row, [...common, 'revision', 'report', 'scoresText', 'checks', 'variant', ...(row.recipeSha256 ? ['styleId', 'styleChecks'] : [])]) ||
          !Number.isSafeInteger(row.revision) || row.revision < 1 || !validateQaReport(row.report) ||
          row.report.qaId !== row.qaId || row.report.assetId !== assetId || row.report.sourceSha256 !== row.sourceSha256 ||
          row.report.lockMode !== 'STRICT' || row.report.humanDecision !== 'PENDING' ||
          row.report.reviewedAt !== row.createdAt || row.report.weightingVariant !== row.variant) {
        throw new Error('A visual review report is invalid.');
      }
      if (row.recipeSha256 && (!row.styleId || !row.styleChecks || (row.recipeSha256 === current.recipeSha256 && row.styleId !== currentStyle))) throw new Error('The review style does not match its recipe.');
      const findings = row.report.schemaVersion === '2.0.0' ? row.report.findings : undefined;
      if (findings !== undefined) validateReviewFindings(findings, sourceSize);
      const evaluated = row.recipeSha256
        ? evaluateVisualReview(row.scoresText, row.checks, row.variant, row.styleId, row.styleChecks, findings)
        : evaluateVisualReview(row.scoresText, row.checks, row.variant, undefined, undefined, findings);
      validateVisualNote(row.report.reviewerNote, row.checks, row.styleChecks);
      if (JSON.stringify(row.report.scores) !== JSON.stringify(evaluated.scores) ||
          row.report.weightedScore !== evaluated.weightedScore || row.report.status !== evaluated.status ||
          JSON.stringify(row.report.hardVetoFindings) !== JSON.stringify(evaluated.hardVetoFindings)) {
        throw new Error('A visual review report does not match its recorded inputs.');
      }
      reviews.push(row);
    } else if (row.kind === 'visual-decision') {
      if (!exactKeys(row, [...common, 'reportId', 'decision']) || typeof row.reportId !== 'string' ||
          !uuidPattern.test(row.reportId) || (row.decision !== 'APPROVED' && row.decision !== 'REJECTED')) {
        throw new Error('A visual decision is invalid.');
      }
      decisions.push(row);
    } else throw new Error('An unknown visual review record is present.');
  }
  reviews.sort((a, b) => a.revision - b.revision);
  if (reviews.some((row, index) => row.revision !== index + 1)) throw new Error('Visual review revisions are missing or duplicated.');
  const used = new Set<string>();
  for (const decision of decisions) {
    const review = reviews.find((row) => row.qaId === decision.reportId);
    if (!review || used.has(decision.reportId) || !sameProvenance(review, decision) ||
        (decision.decision === 'APPROVED' && (review.report.status !== 'PASS_CANDIDATE' ||
          review.report.hardVetoFindings.length !== 0 || Object.values(review.checks).some((check) => check !== 'MATCH')))) {
      throw new Error('A visual decision has invalid review lineage.');
    }
    used.add(decision.reportId);
  }
  const latest = reviews[reviews.length - 1];
  return { reviews, decisions: decisions.map((decision) => ({ ...decision,
    current: decision.reportId === latest?.qaId && sameProvenance(decision, current) })) };
}

export async function validateBackupHistory(product: Product, sources: BackupSource[], masks: BackupMask[], history: BackupHistory, signal?: AbortSignal): Promise<void> {
  checkBackupCancellation(signal);
  if (!history || typeof history !== 'object' || !exactKeys(history, ['jobs', 'attempts', 'assets', 'reviews', 'heads']) ||
      ![history.jobs, history.attempts, history.assets, history.reviews, history.heads].every(Array.isArray)) throw new Error('Backup history is malformed.');
  validateBackupProduct(product);
  checkBackupPixelWork(product, masks.map((mask) => mask?.metadata?.sourceAssetId), history.assets);
  const renderSignal = signal ?? new AbortController().signal;
  if (!Array.isArray(sources) || sources.length !== product.sourceAssets.length ||
      new Set(sources.map((row) => row.metadata.assetId)).size !== sources.length) throw new Error('Backup sources are incomplete or duplicated.');
  for (const metadata of product.sourceAssets) {
    checkBackupCancellation(signal);
    const source = sources.find((row) => row.metadata.assetId === metadata.assetId);
    if (!source || JSON.stringify(source.metadata) !== JSON.stringify(metadata)) throw new Error('Backup source metadata does not match.');
    await verifyStoredSource(product.productId, metadata, { ...source.metadata, productId: product.productId, blob: source.blob, exifOrientation: source.exifOrientation });
  }
  await validateBackupMasks(product, masks, sources, signal);
  const unique = (values: string[]) => values.every((id) => typeof id === 'string' && uuidPattern.test(id)) && new Set(values).size === values.length;
  if (!unique(history.jobs.map((row) => row?.jobId)) || !unique(history.attempts.map((row) => row?.attemptId)) ||
      !unique(history.assets.map((row) => row?.assetId)) || !unique(history.reviews.map((row) => row?.qaId))) throw new Error('Backup history has duplicate or invalid IDs.');
  const jobs = new Map(history.jobs.map((row) => [row.jobId, row]));
  const attempts = new Map(history.attempts.map((row) => [row.attemptId, row]));
  const assets = new Map(history.assets.map((row) => [row.assetId, row]));
  for (const attempt of history.attempts) {
    if (!attempt || attempt.productId !== product.productId || !jobs.has(attempt.jobId) ||
        typeof attempt.prompt !== 'string' || !['PREPARED', 'SUBMITTED', 'UNKNOWN', 'DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE'].includes(attempt.status)) throw new Error('A backup attempt has invalid ownership or state.');
    if (typeof attempt.submittedAt !== 'string' || !Number.isFinite(Date.parse(attempt.submittedAt)) ||
        (attempt.softLimitOverride !== undefined && attempt.softLimitOverride !== true) ||
        (attempt.maxEstimatedUSD !== undefined && (typeof attempt.maxEstimatedUSD !== 'string' || !/^\d{1,9}\.\d{1,6}$/.test(attempt.maxEstimatedUSD))) ||
        (attempt.status !== 'DEFINITIVE_SUCCESS' && (attempt.usage !== null || attempt.observedUSD !== null || attempt.pricingSnapshot !== undefined))) {
      throw new Error('An attempt contains invalid accounting or result metadata.');
    }
    checkedExportAttempt(attempt);
    validateAttemptContext(attempt, product, false);
    validateStudioFailure(attempt);
    const source = product.sourceAssets.find((row) => row.assetId === attempt.sourceAssetId);
    const mask = masks.find((row) => row.metadata.maskId === attempt.maskId);
    if (!source || source.sha256 !== attempt.sourceSha256 || !mask || mask.metadata.sourceAssetId !== source.assetId ||
        mask.metadata.sourceSha256 !== source.sha256 || mask.metadata.sha256 !== attempt.maskSha256) throw new Error('An attempt references missing or mismatched inputs.');
    if ((attempt.acknowledgedAt !== undefined || attempt.recordedOutcome !== undefined) && !validStudioAcknowledgement(attempt.acknowledgedAt, attempt.recordedOutcome)) throw new Error('An attempt acknowledgement is invalid.');
    if (attempt.cleanupPending !== undefined && attempt.cleanupPending !== true) throw new Error('Invalid attempt cleanup state.');
    if (attempt.recoveryLockVersion !== undefined && attempt.recoveryLockVersion !== 1) throw new Error('Invalid recovery state.');
  }
  studioSessionTotal(history.attempts, '');
  for (const job of history.jobs) {
    if (!job || job.productId !== product.productId) throw new Error('A backup job belongs to another project.');
    const first = history.attempts.find((row) => row.jobId === job.jobId);
    if (!first) throw new Error('A backup job has no attempts.');
    verifyStudioLineage(job, history.attempts, await sha256(new TextEncoder().encode(first.prompt)));
  }
  for (const asset of history.assets) {
    checkBackupCancellation(signal);
    const attempt = attempts.get(asset.attemptId);
    if (!attempt || attempt.status !== 'DEFINITIVE_SUCCESS' || asset.productId !== product.productId ||
        typeof asset.sha256 !== 'string' || !hashPattern.test(asset.sha256)) throw new Error('An output has invalid attempt ownership or hash.');
    await verifyStrictPng(asset.blob, asset.sha256);
    if (isStudioScene(asset)) continue;
    const composite = asset as StrictComposite;
    const keys = ['kind', 'assetId', 'productId', 'attemptId', 'blob', 'sha256', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256', 'mapping', 'createdAt',
      ...(composite && Object.hasOwn(composite, 'protectedEvidenceSha256') ? ['protectedEvidenceSha256'] : []),
      ...(composite.recipe ? ['recipe', 'recipeSha256', ...(composite.ad ? ['ad', 'adSha256'] : []), ...(composite.copyLayer ? ['copyLayer'] : [])] : [])];
    const scene = assets.get(composite.sceneAssetId);
    const source = sources.find((row) => row.metadata.assetId === attempt.sourceAssetId);
    const mask = masks.find((row) => row.metadata.maskId === attempt.maskId);
    if (!exactKeys(composite, keys) || composite.kind !== 'strict-composite' || !source || !mask || !scene || !isStudioScene(scene) ||
        scene.attemptId !== attempt.attemptId || composite.sceneSha256 !== scene.sha256 ||
        composite.sourceAssetId !== attempt.sourceAssetId || composite.sourceSha256 !== attempt.sourceSha256 ||
        composite.maskId !== attempt.maskId || composite.maskSha256 !== attempt.maskSha256 ||
        typeof composite.createdAt !== 'string' || !Number.isFinite(Date.parse(composite.createdAt)) ||
        (attempt.styleId === undefined) !== (composite.recipe === undefined)) throw new Error('A composite has invalid lineage.');
    if (composite.recipe && (composite.recipe.styleId !== attempt.styleId || composite.recipe.sourceView !== attempt.sceneContext?.sourceView ||
        composite.recipe.topViewConfirmed !== attempt.topViewConfirmed ||
        composite.recipeSha256 !== await sha256(new TextEncoder().encode(JSON.stringify(composite.recipe))))) throw new Error('A composite recipe is invalid.');
    const protectedEvidence = compositeProtectedEvidence(composite, mask);
    verifyStrictMapping(composite.mapping, source.metadata.width, source.metadata.height, composite.recipe);
    await verifyCopyLayer(composite.recipe, composite.copyLayer);
    if (composite.ad) {
      if (typeof composite.adSha256 !== 'string' || !hashPattern.test(composite.adSha256)) throw new Error('A composite advertisement hash is missing.');
      await verifyStrictPng(composite.ad, composite.adSha256);
    }
    const rendered = await renderStrictComposite({ source: source.blob, mask: mask.blob, scene: scene.blob,
      sourceWidth: source.metadata.width, sourceHeight: source.metadata.height, signal: renderSignal, recipe: composite.recipe, copyLayer: composite.copyLayer, protectedEvidence })
      .catch((error: unknown) => { checkBackupCancellation(signal); throw error; });
    if (Boolean(rendered.ad) !== Boolean(composite.ad)) throw new Error('A composite advertisement is missing.');
    if (rendered.ad && composite.ad) await compareCompositePixels(rendered.ad, composite.ad, renderSignal);
    await compareCompositePixels(rendered.blob, composite.blob, renderSignal);
  }
  for (const attempt of history.attempts) {
    const scenes = history.assets.filter((row) => row.attemptId === attempt.attemptId && isStudioScene(row));
    if (scenes.length !== (attempt.status === 'DEFINITIVE_SUCCESS' ? 1 : 0)) throw new Error('A successful attempt must have exactly one original scene.');
  }
  const headKeys = new Set<string>();
  for (const head of history.heads) {
    if (!head || !exactKeys(head, ['key', 'entries']) || typeof head.key !== 'string' || headKeys.has(head.key) || !Array.isArray(head.entries)) throw new Error('A review history head is invalid.');
    headKeys.add(head.key);
    const assetId = head.key.slice('visual-review-head:'.length);
    const asset = assets.get(assetId);
    if (head.key !== `visual-review-head:${assetId}` || !asset || isStudioScene(asset)) throw new Error('A review history head has invalid ownership.');
  }
  for (const row of history.reviews) {
    const asset = assets.get(row.assetId);
    if (!asset || isStudioScene(asset) || row.productId !== product.productId || row.attemptId !== asset.attemptId) throw new Error('A review has invalid ownership.');
  }
  for (const asset of history.assets) {
    if (isStudioScene(asset)) continue;
    const composite = asset as StrictComposite;
    const rows = history.reviews.filter((row) => row.assetId === asset.assetId);
    const provenance: VisualProvenance = { assetSha256: composite.sha256, sourceSha256: composite.sourceSha256, maskId: composite.maskId,
      maskSha256: composite.maskSha256, sceneAssetId: composite.sceneAssetId, sceneSha256: composite.sceneSha256,
      productSha256: rows[0]?.productSha256 ?? '0'.repeat(64), ...(composite.recipeSha256 ? { recipeSha256: composite.recipeSha256 } : {}), ...(composite.adSha256 ? { adSha256: composite.adSha256 } : {}), ...(composite.protectedEvidenceSha256 ? { protectedEvidenceSha256: composite.protectedEvidenceSha256 } : {}) };
    const source = sources.find((item) => item.metadata.assetId === composite.sourceAssetId);
    if (!source) throw new Error('The review source is missing.');
    checkedVisualHistory(rows, product.productId, composite.attemptId, composite.assetId, provenance, source.metadata, composite.recipe?.styleId);
    const entries = (await Promise.all(rows.map(async (row) => `${row.qaId}:${await sha256(new TextEncoder().encode(JSON.stringify(row)))}`))).sort();
    const head = history.heads.find((item) => item.key === `visual-review-head:${asset.assetId}`);
    if (head ? JSON.stringify(head.entries) !== JSON.stringify(entries) : entries.length !== 0) throw new Error('A review history head is missing or inconsistent.');
  }
}

// The readwrite transaction holds all input stores locked until both verification
// and the append complete. The keep-alive request permits asynchronous Blob
// hashing and image decoding without letting IndexedDB close the transaction.
async function strictCompositeTransaction(
  productId: string, attemptId: string, sceneAssetId: string,
  save?: { inputs: StrictCompositeInputs; expected: StrictCompositeInputs; blob: Blob; mapping: StrictMapping; recipe?: StrictRecipe; ad?: Blob; copyLayer?: Blob },
  signal?: AbortSignal, visual?: VisualOperation,
): Promise<StrictCompositeInputs | StrictComposite | VisualReviewRecord | VisualDecisionRecord | VisualHistory> {
  if (![productId, attemptId, sceneAssetId].every((id) => typeof id === 'string' && uuidPattern.test(id))) {
    throw new Error('The composite input identity is invalid.');
  }
  const db = await openDatabase();
  if (signal?.aborted) throw new DOMException('Composite operation was cancelled.', 'AbortError');
  return new Promise((resolve, reject) => {
    const stores = ['products', 'sourceAssets', 'masks', 'jobs', 'attempts', 'generatedAssets'];
    if (visual) stores.push('qaReports', 'userSettings');
    const tx = db.transaction(stores, save || visual ? 'readwrite' : 'readonly');
    const products = tx.objectStore('products'), assets = tx.objectStore('generatedAssets');
    const productRequest = products.get(productId), attemptRequest = tx.objectStore('attempts').get(attemptId);
    const compositeRequest = visual ? assets.get(visual.assetId) : undefined;
    const reviewsRequest = visual ? tx.objectStore('qaReports').index('assetId').getAll(visual.assetId) : undefined;
    const headKey = visual ? `visual-review-head:${visual.assetId}` : '';
    const headRequest = visual ? tx.objectStore('userSettings').get(headKey) : undefined;
    const barrierRequest = visual ? tx.objectStore('userSettings').get(importReviewKey(visual.assetId)) : undefined;
    let failure: Error | undefined, result: StrictCompositeInputs | StrictComposite | VisualReviewRecord | VisualDecisionRecord | VisualHistory;
    let appendReview: VisualReviewRecord | StoredVisualDecision | undefined;
    let nextHead: { key: string; entries: string[] } | undefined;
    let verifying = true, ready = false;
    const abort = () => {
      // An add can already be queued; abort still rolls it back until commit.
      failure = new DOMException('Composite operation was cancelled.', 'AbortError');
      verifying = false;
      try { tx.abort(); } catch { /* The transaction has already finished. */ }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const keepAlive = () => {
      if (!verifying) return;
      if (ready) {
        if (save) assets.add(result as StrictComposite);
        if (appendReview && nextHead) {
          tx.objectStore('qaReports').add(appendReview);
          if (headRequest!.result === undefined) tx.objectStore('userSettings').add(nextHead);
          else tx.objectStore('userSettings').put(nextHead);
        }
        verifying = false;
      } else {
        const request = products.get(productId);
        request.onsuccess = keepAlive;
      }
    };
    keepAlive();
    attemptRequest.onsuccess = () => {
      try {
        const attempt = attemptRequest.result as StudioAttempt | undefined;
        if (!attempt || attempt.attemptId !== attemptId || attempt.productId !== productId ||
            attempt.status !== 'DEFINITIVE_SUCCESS' ||
            ![attempt.jobId, attempt.sourceAssetId, attempt.maskId].every((id) => typeof id === 'string' && uuidPattern.test(id)) ||
            ![attempt.sourceSha256, attempt.maskSha256].every((hash) => typeof hash === 'string' && hashPattern.test(hash))) {
          throw new Error('A definitive successful attempt with valid input identities is required.');
        }
        const sourceRequest = tx.objectStore('sourceAssets').get(attempt.sourceAssetId);
        const maskRequest = tx.objectStore('masks').get(attempt.maskId);
        const versionsRequest = tx.objectStore('masks').index('sourceAssetId').getAll(attempt.sourceAssetId);
        const jobRequest = tx.objectStore('jobs').get(attempt.jobId);
        const lineageRequest = tx.objectStore('attempts').index('jobId').getAll(attempt.jobId);
        const scenesRequest = assets.index('attemptId').getAll(attemptId);
        scenesRequest.onsuccess = () => {
          void (async () => {
            try {
              const product = checkedProduct(productRequest.result);
              validateBackupReferences(product);
              if (product.productId !== productId || !product.rightsAcknowledged || (attempt.styleId === undefined && product.brandLock.maskAssetId !== attempt.maskId)) {
                throw new Error('The rights or active mask changed since this attempt.');
              }
              validateAttemptContext(attempt, product, false);
              const source = product.sourceAssets.find((item) => item.assetId === attempt.sourceAssetId);
              if (!source || source.sha256 !== attempt.sourceSha256) throw new Error('The attempt source no longer belongs to this project.');
              ownedSource(product, source);
              const job = jobRequest.result as StudioJob | undefined;
              if (!job || job.productId !== productId || job.jobId !== attempt.jobId || typeof attempt.prompt !== 'string') {
                throw new Error('The successful generation job does not match its attempt.');
              }
              verifyStudioLineage(job, lineageRequest.result as StudioAttempt[], await sha256(new TextEncoder().encode(attempt.prompt)));
              if (!verifying) return;
              const scenes = (scenesRequest.result as unknown[]).filter(isStudioScene);
              const scene = scenes[0];
              if (scenes.length !== 1 || !scene || scene.assetId !== sceneAssetId || scene.productId !== productId ||
                  scene.attemptId !== attemptId || !hashPattern.test(scene.sha256)) {
                throw new Error('The original scene is missing, duplicated, or does not belong to this attempt.');
              }
              const original = await verifyStoredSource(productId, source, sourceRequest.result);
              if (!verifying) return;
              const mask = await verifyMask(product, maskRequest.result);
              if (!verifying) return;
              if (mask.metadata.maskId !== attempt.maskId || mask.metadata.sha256 !== attempt.maskSha256 ||
                  mask.metadata.sourceAssetId !== attempt.sourceAssetId || mask.metadata.sourceSha256 !== attempt.sourceSha256) {
                throw new Error('The active mask does not match the attempt.');
              }
              const versions: BackupMask[] = [];
              for (const row of versionsRequest.result) {
                const version = await verifyMask(product, row);
                if (!verifying) return;
                await verifyMaskAlpha(original, version);
                if (!verifying) return;
                versions.push(version);
              }
              validateMaskReferences({ ...product, brandLock: { ...product.brandLock, maskAssetId: attempt.maskId } }, versions);
              await verifyStrictPng(scene.blob, scene.sha256);
              if (!verifying) return;
              const inputs: StrictCompositeInputs = { source: original.blob, mask: mask.blob, scene: scene.blob,
                sourceWidth: source.width, sourceHeight: source.height, sourceAssetId: source.assetId, sourceSha256: source.sha256,
                maskId: mask.metadata.maskId, maskSha256: mask.metadata.sha256, sceneAssetId: scene.assetId, sceneSha256: scene.sha256,
                ...(mask.metadata.protectedEvidence ? { protectedEvidence: structuredClone(mask.metadata.protectedEvidence), protectedEvidenceSha256: mask.metadata.protectedEvidenceSha256 } : {}),
                ...(attempt.styleId ? { styleId: attempt.styleId, sourceView: attempt.sceneContext!.sourceView, ...(attempt.topViewConfirmed ? { topViewConfirmed: true as const } : {}) } : {}) };
              if (save) {
                if ((attempt.styleId === undefined) !== (save.recipe === undefined) ||
                    (save.recipe && (save.recipe.styleId !== attempt.styleId || save.recipe.sourceView !== attempt.sceneContext?.sourceView || save.recipe.topViewConfirmed !== attempt.topViewConfirmed))) throw new Error('The recipe does not match the immutable job.');
                if ((['sourceWidth', 'sourceHeight', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256'] as const)
                  .some((key) => save.expected[key] !== inputs[key]) || save.expected.protectedEvidenceSha256 !== inputs.protectedEvidenceSha256 ||
                    JSON.stringify(save.expected.protectedEvidence) !== JSON.stringify(inputs.protectedEvidence)) throw new Error('The verified composite inputs changed before saving.');
                const given = save.inputs;
                if (!given || (['sourceWidth', 'sourceHeight', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256'] as const)
                  .some((key) => given[key] !== inputs[key]) || given.protectedEvidenceSha256 !== inputs.protectedEvidenceSha256 ||
                    JSON.stringify(given.protectedEvidence) !== JSON.stringify(inputs.protectedEvidence) ||
                    !(given.source instanceof Blob) || !(given.mask instanceof Blob) || !(given.scene instanceof Blob) ||
                    given.source.size < 1 || given.source.size > 20 * 1024 * 1024 ||
                    given.mask.size < 1 || given.mask.size > MAX_MASK_BYTES ||
                    given.scene.size < 1 || given.scene.size > STUDIO_MAX_PNG_BYTES ||
                    await sha256(new Uint8Array(await given.source.arrayBuffer())) !== inputs.sourceSha256 ||
                    await sha256(new Uint8Array(await given.mask.arrayBuffer())) !== inputs.maskSha256 ||
                    await sha256(new Uint8Array(await given.scene.arrayBuffer())) !== inputs.sceneSha256) {
                  throw new Error('The composite inputs changed after loading.');
                }
                if (!verifying) return;
                verifyStrictMapping(save.mapping, source.width, source.height, save.recipe);
                await verifyCopyLayer(save.recipe, save.copyLayer);
                const hash = await verifyStrictPng(save.blob);
                if (!verifying) return;
                result = { kind: 'strict-composite', assetId: crypto.randomUUID(), productId, attemptId, blob: save.blob,
                  sha256: hash, sourceAssetId: inputs.sourceAssetId, sourceSha256: inputs.sourceSha256,
                  maskId: inputs.maskId, maskSha256: inputs.maskSha256, sceneAssetId: inputs.sceneAssetId,
                  sceneSha256: inputs.sceneSha256, mapping: { ...save.mapping }, createdAt: new Date().toISOString(),
                  ...(inputs.protectedEvidenceSha256 ? { protectedEvidenceSha256: inputs.protectedEvidenceSha256 } : {}),
                  ...(save.recipe ? { recipe: save.recipe, recipeSha256: await sha256(new TextEncoder().encode(JSON.stringify(save.recipe))) } : {}),
                  ...(save.ad ? { ad: save.ad, adSha256: await verifyStrictPng(save.ad) } : {}),
                  ...(save.copyLayer ? { copyLayer: save.copyLayer } : {}) };
              } else if (visual) {
                if (product.brandLock.mode !== 'STRICT') throw new Error('A STRICT project is required for visual review.');
                const composite = compositeRequest?.result as StrictComposite | undefined;
                const compositeKeys = ['kind', 'assetId', 'productId', 'attemptId', 'blob', 'sha256', 'sourceAssetId',
                  'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256', 'mapping', 'createdAt',
                  ...(composite && Object.hasOwn(composite, 'protectedEvidenceSha256') ? ['protectedEvidenceSha256'] : []),
                  ...(composite?.recipe ? ['recipe', 'recipeSha256', ...(composite.ad ? ['ad', 'adSha256'] : []), ...(composite.copyLayer ? ['copyLayer'] : [])] : [])];
                if (!composite || !exactKeys(composite, compositeKeys) || composite.kind !== 'strict-composite' ||
                    composite.assetId !== visual.assetId || composite.productId !== productId || composite.attemptId !== attemptId ||
                    composite.sourceAssetId !== inputs.sourceAssetId || composite.sourceSha256 !== inputs.sourceSha256 ||
                    composite.maskId !== inputs.maskId || composite.maskSha256 !== inputs.maskSha256 ||
                    composite.sceneAssetId !== inputs.sceneAssetId || composite.sceneSha256 !== inputs.sceneSha256 ||
                    typeof composite.createdAt !== 'string' || !Number.isFinite(Date.parse(composite.createdAt)) ||
                    typeof composite.sha256 !== 'string' || !hashPattern.test(composite.sha256)) {
                  throw new Error('The saved composite or its input lineage is invalid.');
                }
                if ((attempt.styleId === undefined) !== (composite.recipe === undefined)) throw new Error('The composite recipe lineage is invalid.');
                if (composite.recipe) {
                  const recipeHash = await sha256(new TextEncoder().encode(JSON.stringify(composite.recipe)));
                  if (composite.recipe.styleId !== attempt.styleId || composite.recipe.sourceView !== attempt.sceneContext?.sourceView || composite.recipe.topViewConfirmed !== attempt.topViewConfirmed ||
                      composite.recipeSha256 !== recipeHash) throw new Error('The composite recipe lineage is invalid.');
                }
                const protectedEvidence = compositeProtectedEvidence(composite, mask);
                verifyStrictMapping(composite.mapping, source.width, source.height, composite.recipe);
                await verifyCopyLayer(composite.recipe, composite.copyLayer);
                await verifyStrictPng(composite.blob, composite.sha256);
                const cancellation = signal ?? new AbortController().signal;
                const rendered = await renderStrictComposite({ source: inputs.source, mask: inputs.mask, scene: inputs.scene,
                  sourceWidth: inputs.sourceWidth, sourceHeight: inputs.sourceHeight, signal: cancellation, recipe: composite.recipe, copyLayer: composite.copyLayer, protectedEvidence });
                verifyStrictMapping(rendered.mapping, source.width, source.height, composite.recipe);
                if (Boolean(rendered.ad) !== Boolean(composite.ad)) throw new Error('The ad lineage is invalid.');
                if (rendered.ad && composite.ad) {
                  if (!composite.adSha256) throw new Error('The ad hash is missing.');
                  await verifyStrictPng(composite.ad, composite.adSha256);
                  await compareCompositePixels(rendered.ad, composite.ad, cancellation);
                }
                await compareCompositePixels(rendered.blob, composite.blob, cancellation);
                if (!verifying) return;
                const provenance: VisualProvenance = { assetSha256: composite.sha256, sourceSha256: inputs.sourceSha256,
                  maskId: inputs.maskId, maskSha256: inputs.maskSha256, sceneAssetId: inputs.sceneAssetId,
                  sceneSha256: inputs.sceneSha256, productSha256: attempt.styleId ? await productSnapshotFingerprint(product) : await sha256(new TextEncoder().encode(JSON.stringify(product))),
                  ...(composite.recipeSha256 ? { recipeSha256: composite.recipeSha256 } : {}), ...(composite.adSha256 ? { adSha256: composite.adSha256 } : {}), ...(composite.protectedEvidenceSha256 ? { protectedEvidenceSha256: composite.protectedEvidenceSha256 } : {}) };
                if (!verifying) return;
                const history = checkedVisualHistory(reviewsRequest!.result, productId, attemptId, visual.assetId, provenance, source, composite.recipe?.styleId);
                const entries = (await Promise.all((reviewsRequest!.result as Array<VisualReviewRecord | StoredVisualDecision>)
                  .map(async (row) => `${row.qaId}:${await sha256(new TextEncoder().encode(JSON.stringify(row)))}`))).sort();
                if (!verifying) return;
                const head = headRequest!.result as { key: string; entries: string[] } | undefined;
                if (head === undefined ? entries.length !== 0 :
                    !head || typeof head !== 'object' || !exactKeys(head, ['key', 'entries']) || head.key !== headKey ||
                    !Array.isArray(head.entries) || JSON.stringify(head.entries) !== JSON.stringify(entries)) {
                  throw new Error('Visual review history is incomplete or has an invalid history head.');
                }
                const barrier = checkedImportReviewBarrier(barrierRequest!.result, visual.assetId, history.reviews.length);
                if (barrier !== undefined) {
                  for (const decision of history.decisions) {
                    const review = history.reviews.find((row) => row.qaId === decision.reportId);
                    if (!review || review.revision <= barrier) decision.current = false;
                  }
                }
                if (visual.kind === 'list') result = { ...history, product, productSha256: provenance.productSha256, assetSha256: provenance.assetSha256,
                  importedReviewRequired: barrier !== undefined && history.reviews.length <= barrier,
                  ...(provenance.recipeSha256 ? { recipeSha256: provenance.recipeSha256 } : {}), ...(provenance.adSha256 ? { adSha256: provenance.adSha256 } : {}), ...(provenance.protectedEvidenceSha256 ? { protectedEvidenceSha256: provenance.protectedEvidenceSha256 } : {}) };
                else if (visual.kind === 'review') {
                  if (typeof visual.expectedProductSha256 !== 'string' || !hashPattern.test(visual.expectedProductSha256) ||
                      visual.expectedProductSha256 !== provenance.productSha256) {
                    throw new Error('The product changed since you reviewed it. Reload and review the current product before saving.');
                  }
                  if (typeof visual.expectedAssetSha256 !== 'string' || !hashPattern.test(visual.expectedAssetSha256) ||
                      visual.expectedAssetSha256 !== provenance.assetSha256) {
                    throw new Error('The composite changed since you reviewed it. Reload and review the current image before saving.');
                  }
                  if (visual.expectedRecipeSha256 !== provenance.recipeSha256 || visual.expectedAdSha256 !== provenance.adSha256) throw new Error('The recipe or advertisement changed since it was reviewed.');
                  if (visual.expectedProtectedEvidenceSha256 !== provenance.protectedEvidenceSha256) throw new Error('The protected evidence changed since it was reviewed.');
                  validateVisualNote(visual.note, visual.checks, visual.styleChecks);
                  validateReviewFindings(visual.findings, source);
                  const evaluated = composite.recipe
                    ? evaluateVisualReview(visual.scoresText, visual.checks, visual.variant, composite.recipe.styleId, visual.styleChecks, visual.findings)
                    : evaluateVisualReview(visual.scoresText, visual.checks, visual.variant, undefined, undefined, visual.findings);
                  if (!composite.recipe && visual.styleChecks !== undefined) throw new Error('Legacy reviews do not use style checks.');
                  const qaId = crypto.randomUUID(), createdAt = new Date().toISOString();
                  const report: VisualReport = { schemaVersion: '2.0.0', qaId, assetId: visual.assetId,
                    sourceSha256: inputs.sourceSha256, lockMode: 'STRICT', ...evaluated, weightingVariant: visual.variant,
                    humanDecision: 'PENDING', reviewedAt: createdAt, reviewerNote: visual.note, findings: visual.findings };
                  if (!validateQaReport(report)) throw new Error('The visual review report does not satisfy the QA schema.');
                  const record: VisualReviewRecord = { kind: 'visual-review', qaId, assetId: visual.assetId,
                    productId, attemptId, revision: history.reviews.length + 1, report,
                    scoresText: visual.scoresText, checks: visual.checks, variant: visual.variant, ...provenance, createdAt,
                    ...(composite.recipe ? { styleId: composite.recipe.styleId, styleChecks: visual.styleChecks! } : {}) };
                  appendReview = record; result = record;
                } else {
                  const latest = history.reviews[history.reviews.length - 1];
                  if (!latest || latest.qaId !== visual.reportId || !sameProvenance(latest, provenance)) {
                    throw new Error('The review is no longer current. Review the current inputs again.');
                  }
                  if (barrier !== undefined && latest.revision <= barrier) throw new Error('Imported reviews are untrusted. Create a fresh local review before making a decision.');
                  if (history.decisions.some((decision) => decision.reportId === latest.qaId)) throw new Error('This review already has a decision.');
                  if (visual.decision !== 'APPROVED' && visual.decision !== 'REJECTED') throw new Error('The visual decision is invalid.');
                  if (visual.decision === 'APPROVED' && (latest.report.status !== 'PASS_CANDIDATE' ||
                      latest.report.hardVetoFindings.length || Object.values(latest.checks).some((check) => check !== 'MATCH'))) {
                    throw new Error('Only a fully verified pass candidate can be approved.');
                  }
                  const decision: StoredVisualDecision = { kind: 'visual-decision', qaId: crypto.randomUUID(),
                    assetId: visual.assetId, productId, attemptId, reportId: latest.qaId,
                    decision: visual.decision, ...provenance, createdAt: new Date().toISOString() };
                  appendReview = decision; result = { ...decision, current: true };
                }
                if (appendReview) {
                  const hash = await sha256(new TextEncoder().encode(JSON.stringify(appendReview)));
                  if (!verifying) return;
                  nextHead = { key: headKey, entries: [...entries, `${appendReview.qaId}:${hash}`].sort() };
                }
              } else result = inputs;
              ready = true;
            } catch (error) {
              if (!verifying) return;
              verifying = false; failure = error instanceof Error ? error : new Error('Could not verify the composite inputs.'); tx.abort();
            }
          })();
        };
      } catch (error) {
        if (!verifying) return;
        verifying = false; failure = error instanceof Error ? error : new Error('Could not load the attempt.'); tx.abort();
      }
    };
    tx.oncomplete = () => {
      signal?.removeEventListener('abort', abort);
      if (appendReview) notifyProductChanged(productId);
      resolve(result);
    };
    tx.onabort = () => { signal?.removeEventListener('abort', abort); reject(failure ?? transactionError(tx)); };
  });
}

export async function loadStrictCompositeInputs(productId: string, attemptId: string, sceneAssetId: string, signal?: AbortSignal): Promise<StrictCompositeInputs> {
  return await strictCompositeTransaction(productId, attemptId, sceneAssetId, undefined, signal) as StrictCompositeInputs;
}

function checkCompositeCancellation(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Composite save was cancelled.', 'AbortError');
}

async function compareCompositePixels(expected: Blob, actual: Blob, signal: AbortSignal): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    canvas.width = 0; canvas.height = 0;
    throw new Error('Composite pixel verification is unavailable on this device.');
  }
  const readPixels = async (blob: Blob): Promise<Uint8ClampedArray> => {
    checkCompositeCancellation(signal);
    if (typeof createImageBitmap === 'function') {
      const image = await createImageBitmap(blob);
      try {
        checkCompositeCancellation(signal);
        if (image.width !== 1024 || image.height !== 1024) throw new Error('Composite pixel dimensions do not match.');
        context.clearRect(0, 0, 1024, 1024);
        context.drawImage(image, 0, 0);
      } finally { image.close(); }
    } else {
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('The composite could not be decoded for pixel verification.'));
          image.src = url;
        });
        checkCompositeCancellation(signal);
        if (image.naturalWidth !== 1024 || image.naturalHeight !== 1024) throw new Error('Composite pixel dimensions do not match.');
        context.clearRect(0, 0, 1024, 1024);
        context.drawImage(image, 0, 0);
      } finally { URL.revokeObjectURL(url); }
    }
    return context.getImageData(0, 0, 1024, 1024).data;
  };
  try {
    const reference = await readPixels(expected), preview = await readPixels(actual);
    for (let index = 0; index < reference.length; index++) {
      if (reference[index] !== preview[index]) throw new Error('The preview pixels do not match the verified strict composite.');
    }
    checkCompositeCancellation(signal);
  } finally { canvas.width = 0; canvas.height = 0; }
}

export async function saveStrictComposite(productId: string, attemptId: string, inputs: StrictCompositeInputs, blob: Blob, mapping: StrictMapping, signal?: AbortSignal, recipe?: StrictRecipe, copyLayer?: Blob): Promise<StrictComposite> {
  const cancellation = signal ?? new AbortController().signal;
  checkCompositeCancellation(cancellation);
  const given = inputs && { ...inputs, ...(inputs.protectedEvidence === undefined ? {} : { protectedEvidence: structuredClone(inputs.protectedEvidence) }) }, placement = mapping && { ...mapping };
  if (!given) throw new Error('The composite inputs are invalid.');
  verifyStrictMapping(placement, given.sourceWidth, given.sourceHeight, recipe);
  await verifyCopyLayer(recipe, copyLayer);
  await verifyStrictPng(blob);
  checkCompositeCancellation(cancellation);
  const expected = await loadStrictCompositeInputs(productId, attemptId, given.sceneAssetId, cancellation);
  checkCompositeCancellation(cancellation);
  let rendered: { blob: Blob; mapping: StrictMapping; ad?: Blob; copyLayer?: Blob };
  try {
    rendered = await renderStrictComposite({ source: expected.source, mask: expected.mask, scene: expected.scene,
      sourceWidth: expected.sourceWidth, sourceHeight: expected.sourceHeight, signal: cancellation, recipe, protectedEvidence: expected.protectedEvidence });
  } catch (error) {
    checkCompositeCancellation(cancellation);
    throw error;
  }
  verifyStrictMapping(rendered.mapping, expected.sourceWidth, expected.sourceHeight, recipe);
  verifyStrictMapping(placement, expected.sourceWidth, expected.sourceHeight, recipe);
  if (Boolean(rendered.copyLayer) !== Boolean(copyLayer)) throw new Error('The copy layer does not match the requested text.');
  if (rendered.copyLayer && copyLayer) await compareCompositePixels(rendered.copyLayer, copyLayer, cancellation);
  await compareCompositePixels(rendered.blob, blob, cancellation);
  checkCompositeCancellation(cancellation);
  return await strictCompositeTransaction(productId, attemptId, given.sceneAssetId,
    { inputs: given, expected, blob, mapping: placement, recipe, ad: rendered.ad, copyLayer }, cancellation) as StrictComposite;
}

export async function listStrictComposites(productId: string, attemptId: string): Promise<StrictComposite[]> {
  const db = await openDatabase();
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction('generatedAssets', 'readonly');
    const request = tx.objectStore('generatedAssets').index('attemptId').getAll(attemptId);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(transactionError(tx));
  });
  const composites: StrictComposite[] = [];
  for (const value of rows) {
    const row = value as StrictComposite;
    if (row.kind !== 'strict-composite' || row.productId !== productId || row.attemptId !== attemptId) continue;
    if (![row.assetId, row.productId, row.attemptId, row.sourceAssetId, row.maskId, row.sceneAssetId].every((id) => typeof id === 'string' && uuidPattern.test(id)) ||
        ![row.sha256, row.sourceSha256, row.maskSha256, row.sceneSha256].every((hash) => typeof hash === 'string' && hashPattern.test(hash)) ||
        (Object.hasOwn(row, 'protectedEvidenceSha256') && (typeof row.protectedEvidenceSha256 !== 'string' || !hashPattern.test(row.protectedEvidenceSha256))) ||
        !row.mapping || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('A stored composite has invalid metadata.');
    verifyStrictMapping(row.mapping, row.mapping.sourceWidth, row.mapping.sourceHeight, row.recipe);
    if (row.recipe && row.recipeSha256 !== await sha256(new TextEncoder().encode(JSON.stringify(row.recipe)))) throw new Error('A saved recipe hash does not match.');
    await verifyCopyLayer(row.recipe, row.copyLayer);
    if (row.ad) { if (!row.adSha256) throw new Error('A saved ad hash is missing.'); await verifyStrictPng(row.ad, row.adSha256); }
    await verifyStrictPng(row.blob, row.sha256);
    composites.push(row);
  }
  return composites.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function visualReviewOperation(productId: string, attemptId: string, operation: VisualOperation, signal?: AbortSignal):
  Promise<VisualReviewRecord | VisualDecisionRecord | VisualHistory> {
  if (![productId, attemptId, operation.assetId].every((id) => typeof id === 'string' && uuidPattern.test(id))) {
    throw new Error('The visual review identity is invalid.');
  }
  if (signal?.aborted) throw new DOMException('Visual review was cancelled.', 'AbortError');
  const db = await openDatabase();
  const sceneAssetId = await new Promise<string>((resolve, reject) => {
    const tx = db.transaction('generatedAssets', 'readonly');
    const request = tx.objectStore('generatedAssets').get(operation.assetId);
    let cancelled = false;
    const abort = () => {
      cancelled = true;
      try { tx.abort(); } catch { /* The transaction has already finished. */ }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    tx.oncomplete = () => {
      signal?.removeEventListener('abort', abort);
      const row = request.result as StrictComposite | undefined;
      if (!row || row.kind !== 'strict-composite' || typeof row.sceneAssetId !== 'string' || !uuidPattern.test(row.sceneAssetId)) {
        reject(new Error('The saved composite is missing or invalid.'));
      } else resolve(row.sceneAssetId);
    };
    tx.onabort = () => {
      signal?.removeEventListener('abort', abort);
      reject(cancelled ? new DOMException('Visual review was cancelled.', 'AbortError') : transactionError(tx));
    };
  });
  return await strictCompositeTransaction(productId, attemptId, sceneAssetId, undefined, signal, operation) as
    VisualReviewRecord | VisualDecisionRecord | VisualHistory;
}

export async function createVisualReview(productId: string, attemptId: string, assetId: string, scoresText: ReviewScores,
  checks: ReviewChecks, variant: ReviewVariant, note: string, expectedProductSha256: string,
  expectedAssetSha256: string, signal?: AbortSignal, expectedRecipeSha256?: string, expectedAdSha256?: string, styleChecks?: StyleReviewChecks, findings: ReviewFinding[] = [], expectedProtectedEvidenceSha256?: string): Promise<VisualReviewRecord> {
  validateReviewFindings(findings);
  const operation: VisualOperation = { kind: 'review', assetId, scoresText: structuredClone(scoresText),
    checks: structuredClone(checks), variant, note, expectedProductSha256, expectedAssetSha256, expectedRecipeSha256, expectedAdSha256, expectedProtectedEvidenceSha256,
    findings: structuredClone(findings), ...(styleChecks === undefined ? {} : { styleChecks: structuredClone(styleChecks) }) };
  return await visualReviewOperation(productId, attemptId, operation, signal) as VisualReviewRecord;
}

export async function recordVisualDecision(productId: string, attemptId: string, assetId: string, reportId: string,
  decision: 'APPROVED' | 'REJECTED', signal?: AbortSignal): Promise<VisualDecisionRecord> {
  return await visualReviewOperation(productId, attemptId, { kind: 'decision', assetId, reportId, decision }, signal) as VisualDecisionRecord;
}

export async function listVisualReviews(productId: string, attemptId: string, assetId: string, signal?: AbortSignal): Promise<VisualHistory> {
  return await visualReviewOperation(productId, attemptId, { kind: 'list', assetId }, signal) as VisualHistory;
}

export type ApprovedExportSelection = {
  attemptId: string; assetId: string; productSha256: string; assetSha256: string; reviewId: string; decisionId: string;
};
export type ApprovedExportProvenance = {
  attemptId: string; retryOf?: string; jobId: string; model: string; promptVersion: string; prompt: string; promptSha256: string;
  styleId: StudioStyleId; quality: string; size: string;
  usage: Record<string, unknown> | null; estimatedUSD: string; observedUSD: string | null; pricingSnapshot: string | null;
  createdAt: string; submittedAt: string; reviewId: string; reviewedAt: string; decisionId: string; decidedAt: string;
  sourceAssetId: string; sourceSha256: string; maskId: string; maskSha256: string;
  sceneAssetId: string; sceneSha256: string; assetSha256: string; productSha256: string;
  presetVersion?: string; sceneContext?: StudioSceneContext; selectedFactIds?: string[]; productSnapshotFingerprint?: string; topViewConfirmed?: true;
  recipe?: StrictRecipe; recipeSha256?: string; adSha256?: string; protectedEvidenceSha256?: string; mapping?: StrictMapping;
};
export type ApprovedExportEntry = { selection: ApprovedExportSelection; blob: Blob; ad?: Blob; copyLayer?: Blob; provenance: ApprovedExportProvenance };

function checkedExportUsage(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved usage is unsupported.');
  const usage = value as Record<string, unknown>;
  const keys = ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details'];
  const token = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (Object.keys(usage).some((key) => !keys.includes(key)) ||
      !token(usage.input_tokens) || !token(usage.output_tokens) || !token(usage.total_tokens) ||
      usage.input_tokens > usage.total_tokens || usage.output_tokens !== usage.total_tokens - usage.input_tokens) {
    throw new Error('The saved usage is unsupported.');
  }
  const result: Record<string, unknown> = {
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens,
  };
  for (const [key, limit] of [['input_tokens_details', usage.input_tokens], ['output_tokens_details', usage.output_tokens]] as const) {
    if (!Object.hasOwn(usage, key)) continue;
    const value = usage[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved usage details are unsupported.');
    const details = value as Record<string, unknown>;
    if (!Object.keys(details).length || Object.keys(details).some((field) => field !== 'text_tokens' && field !== 'image_tokens')) {
      throw new Error('The saved usage details are unsupported.');
    }
    let remaining = limit;
    const copy: Record<string, number> = {};
    for (const field of ['image_tokens', 'text_tokens']) {
      if (!Object.hasOwn(details, field)) continue;
      const amount = details[field];
      if (!token(amount) || amount > remaining) throw new Error('The saved usage details are invalid.');
      copy[field] = amount; remaining -= amount;
    }
    result[key] = copy;
  }
  return result;
}

function checkedExportAttempt(attempt: StudioAttempt): Record<string, unknown> | null {
  const allowed = ['attemptId', 'retryOf', 'jobId', 'productId', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256',
    'prompt', 'promptVersion', 'model', 'quality', 'size', 'estimatedUSD', 'maxEstimatedUSD', 'softLimitOverride',
    'submittedAt', 'budgetSessionId', 'sessionPriorUSD', 'sessionLimitUSD', 'sessionLimitOverride', 'status',
    'usage', 'observedUSD', 'pricingSnapshot', 'failure', 'acknowledgedAt', 'recordedOutcome', 'cleanupPending', 'recoveryLockVersion',
    'styleId', 'presetVersion', 'sceneContext', 'selectedFactIds', 'productSnapshotFingerprint', 'topViewConfirmed'];
  if (Object.keys(attempt).some((key) => !allowed.includes(key)) ||
      (!attempt.styleId && (attempt.prompt !== STUDIO_PROMPT || attempt.promptVersion !== STUDIO_PROMPT_VERSION || attempt.estimatedUSD !== studioEstimateUSD())) ||
      attempt.model !== STUDIO_MODEL || attempt.quality !== STUDIO_QUALITY || attempt.size !== STUDIO_SIZE) throw new Error('The attempt provenance is unsupported.');
  const usage = checkedExportUsage(attempt.usage);
  if (attempt.observedUSD === null ? attempt.pricingSnapshot !== undefined :
      attempt.pricingSnapshot !== STUDIO_PRICING_SNAPSHOT || studioObservedUSD(usage) !== attempt.observedUSD) {
    throw new Error('The saved cost snapshot is invalid.');
  }
  return usage;
}

function exportRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not read export data.'));
  });
}

class StaleProtectedReviewError extends Error {
  constructor() { super('The protected evidence changed since approval. Record a new review and decision.'); }
}

// All reads and asynchronous image verification remain inside one locked snapshot.
// IndexedDB normally commits while hashing/decoding, so a harmless request keeps it alive.
async function approvedExportTransaction(productId: string, selections: ApprovedExportSelection[],
  signal?: AbortSignal, onVerified?: (entries: ApprovedExportEntry[]) => void): Promise<ApprovedExportEntry[]> {
  const cancellation = signal ?? new AbortController().signal;
  checkCompositeCancellation(cancellation);
  if (typeof productId !== 'string' || !uuidPattern.test(productId) || !Array.isArray(selections) || selections.length === 0 || selections.length > 100) {
    throw new Error('Select between one and 100 approved outputs.');
  }
  const selected = selections.map((selection) => {
    const keys = ['attemptId', 'assetId', 'productSha256', 'assetSha256', 'reviewId', 'decisionId'];
    if (!selection || typeof selection !== 'object' || !exactKeys(selection, keys) ||
        ![selection.attemptId, selection.assetId, selection.reviewId, selection.decisionId].every((id) => typeof id === 'string' && uuidPattern.test(id)) ||
        ![selection.productSha256, selection.assetSha256].every((hash) => typeof hash === 'string' && hashPattern.test(hash))) {
      throw new Error('An export selection is invalid.');
    }
    return { ...selection };
  });
  if (new Set(selected.map((item) => item.assetId)).size !== selected.length) throw new Error('Duplicate outputs cannot be exported.');
  const db = await openDatabase();
  checkCompositeCancellation(cancellation);
  return await new Promise<ApprovedExportEntry[]>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks', 'jobs', 'attempts', 'generatedAssets', 'qaReports', 'userSettings'], 'readonly');
    const products = tx.objectStore('products'), assets = tx.objectStore('generatedAssets');
    let active = true, ready = false, failure: Error | undefined, result: ApprovedExportEntry[] = [];
    const pendingReads: Array<() => void> = [];
    const readLocked = <T,>(makeRequest: () => IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
      pendingReads.push(() => {
        try { exportRequest(makeRequest()).then(resolve, reject); }
        catch (error) { reject(error); }
      });
    });
    const abort = () => {
      failure = new DOMException('Export was cancelled.', 'AbortError'); active = false;
      try { tx.abort(); } catch { /* Already completed. */ }
    };
    cancellation.addEventListener('abort', abort, { once: true });
    if (cancellation.aborted) abort();
    const keepAlive = () => {
      if (!active) return;
      if (ready) {
        try {
          checkCompositeCancellation(cancellation);
          const returned = (onVerified as ((entries: ApprovedExportEntry[]) => unknown) | undefined)?.(result);
          if (returned && (typeof returned === 'object' || typeof returned === 'function') &&
              'then' in returned && typeof returned.then === 'function') {
            throw new Error('The verified export callback must be synchronous.');
          }
          active = false;
        } catch (error) {
          active = false; failure = error instanceof Error ? error : new Error('The verified export callback failed.');
          try { tx.abort(); } catch { /* Already aborted. */ }
        }
      } else {
        for (const read of pendingReads.splice(0)) read();
        const request = products.get(productId);
        request.onsuccess = keepAlive;
      }
    };
    keepAlive();
    void (async () => {
      try {
        const product = checkedProduct(await readLocked(() => products.get(productId)));
        validateBackupReferences(product);
        if (product.productId !== productId || !product.rightsAcknowledged || product.brandLock.mode !== 'STRICT') {
          throw new Error('The project is not eligible for approved export.');
        }
        const legacyProductSha256 = await sha256(new TextEncoder().encode(JSON.stringify(product)));
        const versionedProductSha256 = await productSnapshotFingerprint(product);
        for (const selection of selected) {
          checkCompositeCancellation(cancellation);
          if (selection.productSha256 !== legacyProductSha256 && selection.productSha256 !== versionedProductSha256) throw new Error('The selected approval is stale.');
          const attempt = await readLocked(() => tx.objectStore('attempts').get(selection.attemptId)) as StudioAttempt | undefined;
          if (!attempt || attempt.attemptId !== selection.attemptId || attempt.productId !== productId ||
              attempt.status !== 'DEFINITIVE_SUCCESS' ||
              ![attempt.jobId, attempt.sourceAssetId, attempt.maskId].every((id) => typeof id === 'string' && uuidPattern.test(id)) ||
              ![attempt.sourceSha256, attempt.maskSha256].every((hash) => typeof hash === 'string' && hashPattern.test(hash))) {
            throw new Error('The successful attempt is missing or invalid.');
          }
          validateAttemptContext(attempt, product, false);
          const productSha256 = attempt.styleId ? versionedProductSha256 : legacyProductSha256;
          if (selection.productSha256 !== productSha256) throw new Error('The selected approval is stale.');
          const usage = checkedExportAttempt(attempt);
          const source = product.sourceAssets.find((item) => item.assetId === attempt.sourceAssetId);
          if (attempt.styleId === undefined && product.brandLock.maskAssetId !== attempt.maskId) throw new Error('The active mask changed.');
          if (!source || source.sha256 !== attempt.sourceSha256) throw new Error('The attempt source changed.');
          ownedSource(product, source);
          const [sourceRow, maskRow, versions, job, lineage, rows, composite, reviews, head, importedBarrier] = await Promise.all([
            readLocked(() => tx.objectStore('sourceAssets').get(attempt.sourceAssetId)),
            readLocked(() => tx.objectStore('masks').get(attempt.maskId)),
            readLocked(() => tx.objectStore('masks').index('sourceAssetId').getAll(attempt.sourceAssetId)),
            readLocked(() => tx.objectStore('jobs').get(attempt.jobId)) as Promise<StudioJob | undefined>,
            readLocked(() => tx.objectStore('attempts').index('jobId').getAll(attempt.jobId)) as Promise<StudioAttempt[]>,
            readLocked(() => assets.index('attemptId').getAll(attempt.attemptId)) as Promise<unknown[]>,
            readLocked(() => assets.get(selection.assetId)) as Promise<StrictComposite | undefined>,
            readLocked(() => tx.objectStore('qaReports').index('assetId').getAll(selection.assetId)) as Promise<unknown[]>,
            readLocked(() => tx.objectStore('userSettings').get(`visual-review-head:${selection.assetId}`)),
            readLocked(() => tx.objectStore('userSettings').get(importReviewKey(selection.assetId))),
          ]);
          if (!job || job.productId !== productId || job.jobId !== attempt.jobId) {
            throw new Error('The successful job does not match its attempt.');
          }
          verifyStudioLineage(job, lineage, await sha256(new TextEncoder().encode(attempt.prompt)));
          const submittedAt = job.attempts.find((entry) => entry.attemptId === attempt.attemptId)?.submittedAt;
          if (typeof submittedAt !== 'string' || !Number.isFinite(Date.parse(submittedAt))) {
            throw new Error('The successful job has no valid submission time.');
          }
          const scenes = rows.filter(isStudioScene), scene = scenes[0];
          if (scenes.length !== 1 || !scene || scene.productId !== productId || scene.attemptId !== attempt.attemptId ||
              typeof scene.sha256 !== 'string' || !hashPattern.test(scene.sha256)) throw new Error('The original scene is invalid.');
          const original = await verifyStoredSource(productId, source, sourceRow);
          const mask = await verifyMask(product, maskRow);
          if (mask.metadata.maskId !== attempt.maskId || mask.metadata.sha256 !== attempt.maskSha256 ||
              mask.metadata.sourceAssetId !== attempt.sourceAssetId || mask.metadata.sourceSha256 !== attempt.sourceSha256) {
            throw new Error('The active mask does not match the attempt.');
          }
          const verifiedVersions: BackupMask[] = [];
          for (const row of versions) {
            const version = await verifyMask(product, row);
            await verifyMaskAlpha(original, version);
            verifiedVersions.push(version);
            checkCompositeCancellation(cancellation);
          }
          validateMaskReferences({ ...product, brandLock: { ...product.brandLock, maskAssetId: attempt.maskId } }, verifiedVersions);
          await verifyStrictPng(scene.blob, scene.sha256);
          const compositeKeys = ['kind', 'assetId', 'productId', 'attemptId', 'blob', 'sha256', 'sourceAssetId',
            'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256', 'mapping', 'createdAt',
            ...(composite && Object.hasOwn(composite, 'protectedEvidenceSha256') ? ['protectedEvidenceSha256'] : []),
            ...(composite?.recipe ? ['recipe', 'recipeSha256', ...(composite.ad ? ['ad', 'adSha256'] : []), ...(composite.copyLayer ? ['copyLayer'] : [])] : [])];
          if (!composite || !exactKeys(composite, compositeKeys) || composite.kind !== 'strict-composite' ||
              composite.assetId !== selection.assetId || composite.productId !== productId || composite.attemptId !== attempt.attemptId ||
              composite.sourceAssetId !== source.assetId || composite.sourceSha256 !== source.sha256 ||
              composite.maskId !== mask.metadata.maskId || composite.maskSha256 !== mask.metadata.sha256 ||
              composite.sceneAssetId !== scene.assetId || composite.sceneSha256 !== scene.sha256 ||
              composite.sha256 !== selection.assetSha256 || typeof composite.createdAt !== 'string' ||
              !Number.isFinite(Date.parse(composite.createdAt))) throw new Error('The selected composite lineage is invalid.');
          if ((attempt.styleId === undefined) !== (composite.recipe === undefined)) throw new Error('The composite recipe lineage is invalid.');
          if (composite.recipe && (composite.recipe.styleId !== attempt.styleId || composite.recipe.sourceView !== attempt.sceneContext?.sourceView || composite.recipe.topViewConfirmed !== attempt.topViewConfirmed ||
              composite.recipeSha256 !== await sha256(new TextEncoder().encode(JSON.stringify(composite.recipe))))) throw new Error('The composite recipe lineage is invalid.');
          const protectedEvidence = compositeProtectedEvidence(composite, mask);
          verifyStrictMapping(composite.mapping, source.width, source.height, composite.recipe);
          await verifyCopyLayer(composite.recipe, composite.copyLayer);
          await verifyStrictPng(composite.blob, selection.assetSha256);
          const rendered = await renderStrictComposite({ source: original.blob, mask: mask.blob, scene: scene.blob,
            sourceWidth: source.width, sourceHeight: source.height, signal: cancellation, recipe: composite.recipe, copyLayer: composite.copyLayer, protectedEvidence });
          verifyStrictMapping(rendered.mapping, source.width, source.height, composite.recipe);
          if (Boolean(rendered.ad) !== Boolean(composite.ad)) throw new Error('The ad lineage is invalid.');
          if (rendered.ad && composite.ad) {
            if (!composite.adSha256) throw new Error('The ad hash is missing.');
            await verifyStrictPng(composite.ad, composite.adSha256);
            await compareCompositePixels(rendered.ad, composite.ad, cancellation);
          }
          await compareCompositePixels(rendered.blob, composite.blob, cancellation);
          const provenance: VisualProvenance = { assetSha256: composite.sha256, sourceSha256: source.sha256,
            maskId: mask.metadata.maskId, maskSha256: mask.metadata.sha256, sceneAssetId: scene.assetId,
            sceneSha256: scene.sha256, productSha256,
            ...(composite.recipeSha256 ? { recipeSha256: composite.recipeSha256 } : {}), ...(composite.adSha256 ? { adSha256: composite.adSha256 } : {}), ...(composite.protectedEvidenceSha256 ? { protectedEvidenceSha256: composite.protectedEvidenceSha256 } : {}) };
          const history = checkedVisualHistory(reviews, productId, attempt.attemptId, selection.assetId, provenance, source, composite.recipe?.styleId);
          const entries = (await Promise.all((reviews as Array<VisualReviewRecord | StoredVisualDecision>)
            .map(async (row) => `${row.qaId}:${await sha256(new TextEncoder().encode(JSON.stringify(row)))}`))).sort();
          const headKey = `visual-review-head:${selection.assetId}`;
          const storedHead = head as { key: string; entries: string[] } | undefined;
          if (!storedHead || typeof storedHead !== 'object' || !exactKeys(storedHead, ['key', 'entries']) ||
              storedHead.key !== headKey || !Array.isArray(storedHead.entries) ||
              JSON.stringify(storedHead.entries) !== JSON.stringify(entries)) throw new Error('The visual review history head is invalid.');
          const review = history.reviews[history.reviews.length - 1];
          const barrier = checkedImportReviewBarrier(importedBarrier, selection.assetId, history.reviews.length);
          if (barrier !== undefined && (!review || review.revision <= barrier)) throw new Error('Imported approvals are untrusted. Create a fresh local review and decision.');
          const decision = history.decisions.find((item) => item.qaId === selection.decisionId);
          if (review && decision && review.qaId === selection.reviewId && decision.reportId === review.qaId &&
              review.protectedEvidenceSha256 !== provenance.protectedEvidenceSha256) throw new StaleProtectedReviewError();
          if (!review || review.qaId !== selection.reviewId || !sameProvenance(review, provenance) ||
              review.report.status !== 'PASS_CANDIDATE' || review.report.hardVetoFindings.length !== 0 ||
              Object.values(review.checks).some((check) => check !== 'MATCH') ||
              !decision || !decision.current || decision.decision !== 'APPROVED' || decision.reportId !== review.qaId) {
            throw new Error('The selected output is not currently approved.');
          }
          result.push({ selection, blob: composite.blob, ...(composite.ad ? { ad: composite.ad } : {}), ...(composite.copyLayer ? { copyLayer: composite.copyLayer } : {}), provenance: {
            attemptId: attempt.attemptId, jobId: attempt.jobId, model: attempt.model, promptVersion: attempt.promptVersion,
            ...(attempt.retryOf === undefined ? {} : { retryOf: attempt.retryOf }),
            prompt: attempt.prompt, promptSha256: job.promptSha256, styleId: job.styleId, quality: job.quality, size: job.size,
            usage, estimatedUSD: attempt.estimatedUSD, observedUSD: attempt.observedUSD,
            pricingSnapshot: attempt.pricingSnapshot ?? null, createdAt: composite.createdAt, submittedAt,
            reviewId: review.qaId, reviewedAt: review.createdAt, decisionId: decision.qaId, decidedAt: decision.createdAt,
            sourceAssetId: source.assetId, ...provenance,
            ...(attempt.styleId ? { presetVersion: attempt.presetVersion, sceneContext: attempt.sceneContext, selectedFactIds: attempt.selectedFactIds,
              productSnapshotFingerprint: attempt.productSnapshotFingerprint, recipe: composite.recipe, recipeSha256: composite.recipeSha256, mapping: { ...composite.mapping }, ...(attempt.topViewConfirmed ? { topViewConfirmed: true as const } : {}),
              ...(composite.adSha256 ? { adSha256: composite.adSha256 } : {}) } : {}),
          } });
        }
        checkCompositeCancellation(cancellation);
        ready = true;
      } catch (error) {
        if (!active) return;
        active = false; failure = error instanceof Error ? error : new Error('Could not verify approved outputs.');
        try { tx.abort(); } catch { /* Already aborted. */ }
      }
    })();
    tx.oncomplete = () => { cancellation.removeEventListener('abort', abort); resolve(result); };
    tx.onabort = () => { cancellation.removeEventListener('abort', abort); reject(failure ?? transactionError(tx)); };
  });
}

export function loadApprovedExportBatch(productId: string, selections: ApprovedExportSelection[],
  signal?: AbortSignal): Promise<ApprovedExportEntry[]> {
  return approvedExportTransaction(productId, selections, signal);
}

export function commitApprovedExportBatch(productId: string, selections: ApprovedExportSelection[],
  signal: AbortSignal | undefined, onVerified: (entries: ApprovedExportEntry[]) => void): Promise<ApprovedExportEntry[]> {
  if (typeof onVerified !== 'function') return Promise.reject(new Error('A synchronous export callback is required.'));
  return approvedExportTransaction(productId, selections, signal, onVerified);
}

export async function listApprovedExportCandidates(productId: string, signal?: AbortSignal): Promise<ApprovedExportSelection[]> {
  const cancellation = signal ?? new AbortController().signal;
  checkCompositeCancellation(cancellation);
  if (typeof productId !== 'string' || !uuidPattern.test(productId)) throw new Error('The project identity is invalid.');
  const db = await openDatabase();
  checkCompositeCancellation(cancellation);
  const snapshot = await new Promise<{ candidates: ApprovedExportSelection[]; product: unknown }>((resolve, reject) => {
    const tx = db.transaction(['products', 'generatedAssets', 'qaReports', 'userSettings'], 'readonly');
    const productRequest = tx.objectStore('products').get(productId);
    const request = tx.objectStore('generatedAssets').index('productId').getAll(productId);
    const found: ApprovedExportSelection[] = [];
    const abort = () => { try { tx.abort(); } catch { /* Already completed. */ } };
    cancellation.addEventListener('abort', abort, { once: true });
    if (cancellation.aborted) abort();
    request.onsuccess = () => {
      for (const value of request.result as StrictComposite[]) {
        if (!value || value.kind !== 'strict-composite' || typeof value.assetId !== 'string') continue;
        const barrier = tx.objectStore('userSettings').get(importReviewKey(value.assetId));
        const reviews = tx.objectStore('qaReports').index('assetId').getAll(value.assetId);
        reviews.onsuccess = () => {
          const rows = reviews.result as Array<VisualReviewRecord | StoredVisualDecision>;
          const latest = rows.filter((row): row is VisualReviewRecord => row?.kind === 'visual-review')
            .sort((a, b) => b.revision - a.revision)[0];
          const decision = rows.find((row): row is StoredVisualDecision =>
            row?.kind === 'visual-decision' && row.reportId === latest?.qaId && row.decision === 'APPROVED');
          try {
            const revision = checkedImportReviewBarrier(barrier.result, value.assetId, rows.filter((row) => row?.kind === 'visual-review').length);
            if (latest && decision && (revision === undefined || latest.revision > revision)) found.push({ attemptId: value.attemptId, assetId: value.assetId,
              productSha256: latest.productSha256, assetSha256: latest.assetSha256, reviewId: latest.qaId, decisionId: decision.qaId });
          } catch { tx.abort(); }
        };
      }
    };
    tx.oncomplete = () => { cancellation.removeEventListener('abort', abort); resolve({ candidates: found, product: productRequest.result }); };
    tx.onabort = () => { cancellation.removeEventListener('abort', abort); reject(cancellation.aborted
      ? new DOMException('Export was cancelled.', 'AbortError') : transactionError(tx)); };
  });
  const product = checkedProduct(snapshot.product);
  validateBackupReferences(product);
  const productSha256 = await sha256(new TextEncoder().encode(JSON.stringify(product)));
  const versionedProductSha256 = await productSnapshotFingerprint(product);
  const approved: ApprovedExportSelection[] = [];
  for (const selection of snapshot.candidates) {
    checkCompositeCancellation(cancellation);
    if (typeof selection.productSha256 === 'string' && hashPattern.test(selection.productSha256) &&
        selection.productSha256 !== productSha256 && selection.productSha256 !== versionedProductSha256) continue;
    try { await loadApprovedExportBatch(productId, [selection], cancellation); }
    catch (error) { if (error instanceof StaleProtectedReviewError) continue; throw error; }
    approved.push(selection);
  }
  return approved;
}
