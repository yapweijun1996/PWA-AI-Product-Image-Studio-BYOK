import validateProduct from 'virtual:product-validator';
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

export async function loadOriginalSource(productId: string, metadata: Product['sourceAssets'][number]): Promise<Blob> {
  const db = await openDatabase();
  const record = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('sourceAssets', 'readonly');
    const request = tx.objectStore('sourceAssets').get(metadata.assetId);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(transactionError(tx));
  });
  if (!record || typeof record !== 'object') throw new Error('The original source is missing and cannot be verified.');
  const source = record as Record<string, unknown>;
  if (source.productId !== productId || source.assetId !== metadata.assetId || source.sha256 !== metadata.sha256 ||
      source.mimeType !== metadata.mimeType || source.width !== metadata.width || source.height !== metadata.height ||
      source.cameraView !== metadata.cameraView || source.filename !== metadata.filename ||
      !(source.blob instanceof Blob) || source.blob.size > 20 * 1024 * 1024 ||
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
  return source.blob;
}
