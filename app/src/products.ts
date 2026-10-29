import validateProduct from 'virtual:product-validator';
import validateGenerationJob from 'virtual:generation-job-validator';
import { sha256, type PreparedSource } from './prepareSource';
import { inspectImageHeader } from './imageHeader';

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

function transactionError(transaction: IDBTransaction): Error {
  if (transaction.error?.name === 'ConstraintError') return new Error('A project with this SKU already exists.');
  if (transaction.error?.name === 'QuotaExceededError') return new Error('Local storage is full. Free space or back up your data before trying again.');
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
    tx.oncomplete = () => resolve(result);
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
    tx.oncomplete = () => resolve(result);
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
  const fields = ['maskId', 'productId', 'sourceAssetId', 'sourceSha256', 'width', 'height', 'sha256', 'version', 'blob'];
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

async function verifyMaskAlpha(source: BackupSource, mask: BackupMask): Promise<void> {
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
  const original = await decode(source.blob);
  try {
    const selection = await decode(mask.blob);
    try {
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

export async function validateBackupMasks(product: Product, masks: BackupMask[], sources: BackupSource[]): Promise<BackupMask[]> {
  const verified: BackupMask[] = [];
  for (const mask of masks) {
    if (!mask.metadata || typeof mask.metadata !== 'object' || Object.keys(mask.metadata).length !== 8 || Object.hasOwn(mask.metadata, 'blob')) {
      throw new Error('Mask metadata contains unsupported fields.');
    }
    const checked = await verifyMask(product, { ...mask.metadata, blob: mask.blob });
    const source = sources.find((item) => item.metadata.assetId === checked.metadata.sourceAssetId);
    if (!source) throw new Error('The mask source is missing.');
    await verifyMaskAlpha(source, checked);
    verified.push(checked);
  }
  if (verified.length && product.brandLock.maskAssetId === null) throw new Error('The active mask pointer is missing.');
  validateMaskReferences(product, verified);
  return verified;
}

export async function loadSourceMask(productId: string, source: SourceMetadata): Promise<{ blob: Blob; sha256: string } | null> {
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
  return latest ? { blob: latest.blob, sha256: latest.metadata.sha256 } : null;
}

export async function saveMask(productId: string, source: SourceMetadata, blob: Blob, expectedMaskAssetId: string | null): Promise<Product> {
  if (expectedMaskAssetId !== null && (typeof expectedMaskAssetId !== 'string' || !uuidPattern.test(expectedMaskAssetId))) {
    throw new Error('The expected mask version is invalid. Reload the editor.');
  }
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > MAX_MASK_BYTES) throw new Error('The mask exceeds the 20 MiB limit or is empty.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const metadata: MaskMetadata = { maskId: crypto.randomUUID(), productId, sourceAssetId: source.assetId,
    sourceSha256: source.sha256, width: source.width, height: source.height, sha256: await sha256(bytes), version: 1 };
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
    tx.oncomplete = () => resolve(result);
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

export async function getBackupSnapshot(productId: string): Promise<{ product: Product; sources: BackupSource[]; masks: BackupMask[] }> {
  const db = await openDatabase();
  const snapshot = await new Promise<{ product: Product; rows: unknown[]; masks: unknown[] }>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks', 'jobs', 'generatedAssets'], 'readonly');
    const productRequest = tx.objectStore('products').get(productId);
    const sourceRequest = tx.objectStore('sourceAssets').index('productId').getAll(productId);
    const jobCount = tx.objectStore('jobs').index('productId').count(productId);
    const assetCount = tx.objectStore('generatedAssets').index('productId').count(productId);
    const maskRequest = tx.objectStore('masks').openCursor();
    const maskRows: unknown[] = [];
    let product: Product;
    let failure: Error | undefined;
    productRequest.onsuccess = () => {
      try {
        if (productRequest.result === undefined) throw new Error('This project no longer exists.');
        product = checkedProduct(productRequest.result);
        validateBackupReferences(product);
      } catch (error) {
        failure = error instanceof Error ? error : new Error('The project cannot be backed up.');
        tx.abort();
      }
    };
    maskRequest.onsuccess = () => {
      const cursor = maskRequest.result;
      if (!cursor) return;
      const row = cursor.value as Record<string, unknown>;
      if (row && (row.productId === productId || product.sourceAssets.some((source) => source.assetId === row.sourceAssetId))) {
        maskRows.push(row);
        if (maskRows.length > 512) {
          failure = new Error('This project has too many mask versions for one backup. No data was omitted.');
          tx.abort(); return;
        }
      }
      cursor.continue();
    };
    tx.oncomplete = () => {
      if (jobCount.result || assetCount.result) {
        reject(new Error('This project contains jobs or outputs that this backup version cannot safely include.'));
      } else {
        resolve({ product, rows: sourceRequest.result, masks: maskRows });
      }
    };
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
  if (snapshot.rows.length !== snapshot.product.sourceAssets.length) {
    throw new Error('The source records do not match the project. Backup was not created.');
  }
  const sources: BackupSource[] = [];
  const sourceFields: Record<string, true> = { assetId: true, sha256: true, mimeType: true, width: true, height: true, cameraView: true, filename: true, productId: true, exifOrientation: true, blob: true };
  for (const metadata of snapshot.product.sourceAssets) {
    const row = snapshot.rows.find((value) => value && typeof value === 'object' && (value as Record<string, unknown>).assetId === metadata.assetId);
    if (!row || typeof row !== 'object' || Object.keys(row).some((key) => !Object.hasOwn(sourceFields, key))) {
      throw new Error('A source contains unsupported fields. Backup was not created.');
    }
    sources.push(await verifyStoredSource(productId, metadata, row));
  }
  const masks: BackupMask[] = [];
  for (const row of snapshot.masks) masks.push(await verifyMask(snapshot.product, row));
  return { product: snapshot.product, sources, masks: await validateBackupMasks(snapshot.product, masks, sources) };
}

export async function hasImportConflict(product: Product, masks: BackupMask[] = []): Promise<boolean> {
  const db = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks'], 'readonly');
    const products = tx.objectStore('products');
    const checks = [products.getKey(product.productId), products.index('sku').getKey(product.sku),
      ...product.sourceAssets.map((asset) => tx.objectStore('sourceAssets').getKey(asset.assetId)),
      ...masks.map((mask) => tx.objectStore('masks').getKey(mask.metadata.maskId))];
    tx.oncomplete = () => resolve(checks.some((request) => request.result !== undefined));
    tx.onabort = () => reject(transactionError(tx));
  });
}

export async function restoreProduct(product: Product, sources: BackupSource[], masks: BackupMask[] = []): Promise<void> {
  checkedProduct(product);
  validateBackupReferences(product);
  if (sources.length !== product.sourceAssets.length) throw new Error('The backup has missing or extra sources.');
  const ids = new Set(sources.map((source) => source.metadata.assetId));
  if (ids.size !== sources.length) throw new Error('The backup contains duplicate source IDs.');
  for (const metadata of product.sourceAssets) {
    const source = sources.find((item) => item.metadata.assetId === metadata.assetId);
    if (!source) throw new Error('The backup is missing an original source.');
    await verifyStoredSource(product.productId, metadata, { ...source.metadata, productId: product.productId, blob: source.blob, exifOrientation: source.exifOrientation });
  }
  const verifiedMasks = await validateBackupMasks(product, masks, sources);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['products', 'sourceAssets', 'masks'], 'readwrite');
    tx.objectStore('products').add(product);
    for (const source of sources) {
      tx.objectStore('sourceAssets').add({ ...source.metadata, productId: product.productId, blob: source.blob, exifOrientation: source.exifOrientation });
    }
    for (const mask of verifiedMasks) tx.objectStore('masks').add({ ...mask.metadata, blob: mask.blob });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error?.name === 'ConstraintError'
      ? new Error('This product, SKU, source ID or mask ID already exists. Nothing was imported.')
      : transactionError(tx));
  });
}

export type StudioAttempt = {
  attemptId: string; jobId: string; productId: string; sourceAssetId: string;
  sourceSha256: string; maskId: string; maskSha256: string;
  prompt: string; promptVersion: string; model: string; quality: string; size: string;
  estimatedUSD: string; maxEstimatedUSD?: string; submittedAt: string;
  status: 'PREPARED' | 'SUBMITTED' | 'DEFINITIVE_FAILURE' | 'UNKNOWN' | 'DEFINITIVE_SUCCESS';
  usage: Record<string, unknown> | null; observedUSD: string | null;
};
export type StudioAsset = { assetId: string; attemptId: string; productId: string; blob: Blob; sha256: string };

type StudioJob = {
  schemaVersion: '1.0.0'; jobId: string; productId: string; styleId: 'studio';
  lockMode: 'STRICT'; operation: 'generate_scene'; sourceHashes: string[];
  promptVersion: string; promptSha256: string; model: string; quality: string; size: string;
  status: string; createdAt: string;
  attempts: Array<{ attemptId: string; state: string; createdAt: string; submittedAt: string | null;
    completedAt: string | null; estimatedUSD: string; observedUSD: string | null;
    providerRequestId: null; usage: Record<string, unknown> | null; outcome?: string }>;
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
    schemaVersion: '1.0.0', jobId: attempt.jobId, productId: attempt.productId, styleId: 'studio',
    lockMode: 'STRICT', operation: 'generate_scene', sourceHashes: [attempt.sourceSha256],
    promptVersion: attempt.promptVersion, promptSha256: promptHash, model: attempt.model,
    quality: attempt.quality, size: attempt.size, status: status[0], createdAt: attempt.submittedAt,
    attempts: [{ attemptId: attempt.attemptId, state: status[1], createdAt: attempt.submittedAt,
      submittedAt: sentAt, completedAt, estimatedUSD: attempt.estimatedUSD, observedUSD: attempt.observedUSD,
      providerRequestId: null, usage: attempt.usage, ...(outcome ? { outcome } : {}) }],
  };
}

function checkedStudioJob(job: StudioJob): StudioJob {
  if (!validateGenerationJob(job)) throw new Error('The generation job is invalid. No changes were saved.');
  return job;
}

export async function studioInput(productId: string): Promise<{ source: SourceMetadata; maskId: string; maskSha256: string }> {
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

export async function createStudioAttempt(attempt: StudioAttempt): Promise<void> {
  if (attempt.status !== 'PREPARED' || attempt.usage !== null || attempt.observedUSD !== null) throw new Error('A new attempt must be prepared without a result.');
  const promptHash = await sha256(new TextEncoder().encode(attempt.prompt));
  const job = checkedStudioJob(studioJob(attempt, promptHash, null, null));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['products', 'masks', 'sourceAssets', 'jobs', 'attempts'], 'readwrite');
    const product = tx.objectStore('products').get(attempt.productId);
    const mask = tx.objectStore('masks').get(attempt.maskId);
    const source = tx.objectStore('sourceAssets').get(attempt.sourceAssetId);
    const attempts = tx.objectStore('attempts').getAll();
    let failure: Error | undefined;
    attempts.onsuccess = () => {
      try {
        const p = checkedProduct(product.result);
        const m = mask.result as Record<string, unknown> | undefined;
        const s = source.result as Record<string, unknown> | undefined;
        if ((attempts.result as StudioAttempt[]).some((entry) => entry.productId === attempt.productId &&
            (entry.status === 'SUBMITTED' || entry.status === 'UNKNOWN'))) {
          throw new Error('Another attempt for this product is in progress or UNKNOWN. Review its history before generating.');
        }
        if (!p.rightsAcknowledged || p.brandLock.maskAssetId !== attempt.maskId ||
            !p.sourceAssets.some((item) => item.assetId === attempt.sourceAssetId && item.sha256 === attempt.sourceSha256) ||
            !m || m.productId !== attempt.productId || m.sourceAssetId !== attempt.sourceAssetId || m.sourceSha256 !== attempt.sourceSha256 || m.sha256 !== attempt.maskSha256 ||
            !s || s.productId !== attempt.productId || s.sha256 !== attempt.sourceSha256) throw new Error('The source or active mask changed. Review it again before generating.');
        tx.objectStore('jobs').add(job);
        tx.objectStore('attempts').add(attempt);
      } catch (error) { failure = error instanceof Error ? error : new Error('Could not save the attempt.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

export async function updateStudioAttempt(attempt: StudioAttempt, asset?: StudioAsset): Promise<void> {
  const promptHash = await sha256(new TextEncoder().encode(attempt.prompt));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['products', 'masks', 'sourceAssets', 'jobs', 'attempts', 'generatedAssets'], 'readwrite');
    const previousRequest = tx.objectStore('attempts').get(attempt.attemptId);
    const jobRequest = tx.objectStore('jobs').get(attempt.jobId);
    const productRequest = tx.objectStore('products').get(attempt.productId);
    const maskRequest = tx.objectStore('masks').get(attempt.maskId);
    const sourceRequest = tx.objectStore('sourceAssets').get(attempt.sourceAssetId);
    const allAttempts = tx.objectStore('attempts').getAll();
    let failure: Error | undefined;
    allAttempts.onsuccess = () => {
      try {
        const previous = previousRequest.result as StudioAttempt | undefined;
        const job = jobRequest.result as StudioJob | undefined;
        if (!previous || !job || !validateGenerationJob(job)) throw new Error('The saved attempt or job is missing or invalid.');
        const immutable: Array<keyof StudioAttempt> = ['attemptId', 'jobId', 'productId', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'prompt', 'promptVersion', 'model', 'quality', 'size', 'estimatedUSD', 'maxEstimatedUSD', 'submittedAt'];
        if (immutable.some((key) => previous[key] !== attempt[key])) throw new Error('Attempt identity or input changed.');
        const allowed = previous.status === 'PREPARED' ? ['SUBMITTED', 'DEFINITIVE_FAILURE'] : previous.status === 'SUBMITTED' ? ['DEFINITIVE_FAILURE', 'DEFINITIVE_SUCCESS', 'UNKNOWN'] : [];
        if (attempt.status === 'SUBMITTED' && (allAttempts.result as StudioAttempt[]).some((entry) =>
          entry.productId === attempt.productId && entry.attemptId !== attempt.attemptId &&
          (entry.status === 'SUBMITTED' || entry.status === 'UNKNOWN'))) {
          throw new Error('Another attempt for this product is in progress or UNKNOWN. Review its history before generating.');
        }
        if (!allowed.includes(attempt.status)) throw new Error('Invalid or repeated attempt transition.');
        if (attempt.status === 'SUBMITTED') {
          const product = checkedProduct(productRequest.result);
          const mask = maskRequest.result as Record<string, unknown> | undefined;
          const source = sourceRequest.result as Record<string, unknown> | undefined;
          if (!product.rightsAcknowledged || product.brandLock.maskAssetId !== attempt.maskId ||
              !product.sourceAssets.some((item) => item.assetId === attempt.sourceAssetId && item.sha256 === attempt.sourceSha256) ||
              !mask || mask.productId !== attempt.productId || mask.sourceAssetId !== attempt.sourceAssetId ||
              mask.sourceSha256 !== attempt.sourceSha256 || mask.sha256 !== attempt.maskSha256 ||
              !source || source.productId !== attempt.productId || source.sha256 !== attempt.sourceSha256) {
            throw new Error('The source or active mask changed. Review it again before generating.');
          }
        }
        if ((attempt.status === 'DEFINITIVE_SUCCESS') !== Boolean(asset) ||
            (asset && (asset.attemptId !== attempt.attemptId || asset.productId !== attempt.productId || !(asset.blob instanceof Blob) || !hashPattern.test(asset.sha256))) ||
            (attempt.status !== 'DEFINITIVE_SUCCESS' && (attempt.usage !== null || attempt.observedUSD !== null))) throw new Error('Attempt outcome and asset do not match.');
        const oldEntry = job.attempts[0];
        if (!oldEntry || JSON.stringify(job) !== JSON.stringify(studioJob(previous, promptHash, oldEntry.submittedAt, oldEntry.completedAt))) throw new Error('The saved job does not match its attempt.');
        const now = new Date().toISOString();
        const sentAt = attempt.status === 'SUBMITTED' ? now : oldEntry.submittedAt;
        const completedAt = attempt.status === 'SUBMITTED' ? null : now;
        const next = checkedStudioJob(studioJob(attempt, promptHash, sentAt, completedAt));
        tx.objectStore('jobs').put(next);
        tx.objectStore('attempts').put(attempt);
        if (asset) tx.objectStore('generatedAssets').add(asset);
      } catch (error) { failure = error instanceof Error ? error : new Error('Could not update the attempt.'); tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? transactionError(tx));
  });
}

export async function listStudioAttempts(productId: string): Promise<Array<{ attempt: StudioAttempt; asset: StudioAsset | null }>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs', 'attempts', 'generatedAssets'], 'readonly');
    const jobs = tx.objectStore('jobs').index('productId').getAll(productId);
    const attempts = tx.objectStore('attempts').getAll();
    const assets = tx.objectStore('generatedAssets').index('productId').getAll(productId);
    tx.oncomplete = () => {
      const ids = new Set((jobs.result as Array<{ jobId: string }>).map((job) => job.jobId));
      resolve((attempts.result as StudioAttempt[]).filter((attempt) => ids.has(attempt.jobId))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((attempt) => ({ attempt, asset: (assets.result as StudioAsset[]).find((asset) => asset.attemptId === attempt.attemptId) ?? null })));
    };
    tx.onabort = () => reject(transactionError(tx));
  });
}
