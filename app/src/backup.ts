import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter, configure, type FileEntry } from '@zip.js/zip.js/lib/zip-core-native.js';
import validateManifest from 'virtual:export-manifest-validator';
import { getBackupSnapshot, hasImportConflict, validateBackupProduct, type BackupSource, type Product } from './products';
import { prepareSource, sha256 } from './prepareSource';

configure({ useWebWorkers: false });
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;
const MAX_ARCHIVE = 340 * 1024 * 1024;
const MAX_TOTAL = 16 * MAX_IMAGE + 2 * MAX_JSON;
const MAX_ENTRIES = 18;
const MAX_RATIO = 200;

type ManifestFile = { path: string; sha256: string; bytes: number; mimeType: string; approved: boolean; role: 'project' | 'original'; sourceAssetId?: string | null; attemptId?: string | null; qaId?: string | null };
type Manifest = { schemaVersion: '1.0.0'; exportId: string; productId: string; createdAt: string; approvedOnly: boolean; files: ManifestFile[]; appVersion: string };
export type BackupPreview = { product: Product; sources: BackupSource[]; totalBytes: number; conflict: boolean };
type Progress = (message: string) => void;

function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled by user.', 'AbortError');
}

function assertNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  if (/(?<!\w)sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(text) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error('The project contains a possible credential. Remove it before creating or importing a backup.');
  }
}

function sourcePath(asset: Product['sourceAssets'][number]): string {
  const extensions: Record<Product['sourceAssets'][number]['mimeType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  return `originals/${asset.assetId}.${extensions[asset.mimeType]}`;
}

export async function createBackup(productId: string, signal: AbortSignal, progress: Progress): Promise<Blob> {
  progress('Checking the project and original files…');
  const snapshot = await getBackupSnapshot(productId);
  cancelled(signal);
  assertNoSecrets(snapshot.product);
  const projectBytes = new TextEncoder().encode(JSON.stringify(snapshot.product, null, 2));
  if (projectBytes.length > MAX_JSON) throw new Error('The project metadata exceeds the backup limit.');
  const files: ManifestFile[] = [{ path: 'project.json', sha256: await sha256(projectBytes), bytes: projectBytes.length, mimeType: 'application/json', approved: false, role: 'project' }];
  for (const source of snapshot.sources) {
    files.push({ path: sourcePath(source.metadata), sha256: source.metadata.sha256, bytes: source.blob.size, mimeType: source.metadata.mimeType, approved: false, role: 'original', sourceAssetId: source.metadata.assetId });
  }
  const manifest: Manifest = { schemaVersion: '1.0.0', exportId: crypto.randomUUID(), productId: snapshot.product.productId, createdAt: new Date().toISOString(), appVersion: __APP_VERSION__, approvedOnly: true, files };
  if (!validateManifest(manifest)) throw new Error('The backup manifest is invalid.');
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (manifestBytes.length > MAX_JSON) throw new Error('The backup manifest exceeds the limit.');
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false, level: 0 });
  try {
    await writer.add('project.json', new Uint8ArrayReader(projectBytes), { signal });
    for (let index = 0; index < snapshot.sources.length; index++) {
      cancelled(signal);
      const source = snapshot.sources[index];
      progress(`Adding original ${index + 1} of ${snapshot.sources.length}…`);
      await writer.add(sourcePath(source.metadata), new BlobReader(source.blob), { signal });
    }
    await writer.add('export-manifest.json', new Uint8ArrayReader(manifestBytes), { signal });
    cancelled(signal);
    return await writer.close();
  } catch (error) {
    await writer.close().catch(() => undefined);
    throw error;
  }
}

async function readEntry(entry: FileEntry, maximum: number, signal: AbortSignal): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  const writer = new WritableStream<Uint8Array>({
    write(chunk) {
      cancelled(signal);
      bytes += chunk.byteLength;
      if (bytes > maximum || bytes > entry.uncompressedSize) throw new Error('An archive entry exceeds its declared or allowed size.');
      chunks.push(new Uint8Array(chunk));
    },
  });
  await entry.getData(writer, { signal, checkCrc32: true, checkOverlappingEntry: true, strictness: 'strict', useWebWorkers: false });
  if (bytes !== entry.uncompressedSize) throw new Error('An archive entry has an invalid size.');
  return new Blob(chunks);
}

async function readJson(entry: FileEntry, signal: AbortSignal): Promise<unknown> {
  const blob = await readEntry(entry, MAX_JSON, signal);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()));
  } catch {
    throw new Error('The backup contains invalid JSON.');
  }
}

export async function inspectBackup(file: File, signal: AbortSignal, progress: Progress): Promise<BackupPreview> {
  if (file.size < 1 || file.size > MAX_ARCHIVE) throw new Error('The backup exceeds the 340 MiB archive limit.');
  const reader = new ZipReader(new BlobReader(file), { strictness: 'strict', filenameValidation: 'strict', useWebWorkers: false });
  try {
    const entries = new Map<string, FileEntry>();
    const folded = new Set<string>();
    let totalBytes = 0;
    progress('Inspecting the archive…');
    for await (const entry of reader.getEntriesGenerator()) {
      cancelled(signal);
      if (entry.directory || entry.symlink || entry.encrypted || entry.executable || !('getData' in entry)) throw new Error('Directories, links, executable or encrypted entries are not supported.');
      const key = entry.filename.toLowerCase();
      if (entries.size >= MAX_ENTRIES || folded.has(key)) throw new Error('The archive has too many or duplicate entries.');
      if (!/^(project\.json|export-manifest\.json|originals\/[0-9a-f-]{36}\.(png|jpg|webp))$/i.test(entry.filename)) throw new Error('The archive contains an unsupported or unsafe path.');
      if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize) || entry.uncompressedSize < 0 || entry.compressedSize < 0 ||
          entry.uncompressedSize > (entry.filename.startsWith('originals/') ? MAX_IMAGE : MAX_JSON) ||
          (entry.uncompressedSize > 0 && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_RATIO)) ||
          ![0, 8].includes(entry.compressionMethod)) throw new Error('An archive entry exceeds a safety limit or uses an unsupported compression method.');
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_TOTAL) throw new Error('The archive expands beyond the safety limit.');
      folded.add(key); entries.set(entry.filename, entry);
    }
    const manifestEntry = entries.get('export-manifest.json');
    const projectEntry = entries.get('project.json');
    if (!manifestEntry || !projectEntry) throw new Error('The backup must contain a project and manifest.');
    const rawManifest = await readJson(manifestEntry, signal);
    if (!validateManifest(rawManifest)) throw new Error('The backup manifest is invalid or uses an unsupported version.');
    const manifest = rawManifest as Manifest;
    assertNoSecrets(manifest);
    if (!manifest.approvedOnly) throw new Error('This backup contains data that this version cannot safely restore.');
    const declared = new Map<string, ManifestFile>();
    for (const item of manifest.files) {
      if (declared.has(item.path) || item.approved || !['project', 'original'].includes(item.role) || item.attemptId || item.qaId) throw new Error('The backup contains unsupported or duplicate manifest entries.');
      declared.set(item.path, item);
    }
    if (declared.size + 1 !== entries.size || [...declared.keys()].some((path) => !entries.has(path))) throw new Error('The manifest and archive entries do not match.');
    const projectInfo = declared.get('project.json');
    if (!projectInfo || projectInfo.role !== 'project' || projectInfo.mimeType !== 'application/json' || projectInfo.sourceAssetId) throw new Error('The project manifest entry is invalid.');
    const projectBlob = await readEntry(projectEntry, MAX_JSON, signal);
    const projectBytes = new Uint8Array(await projectBlob.arrayBuffer());
    if (projectBytes.length !== projectInfo.bytes || await sha256(projectBytes) !== projectInfo.sha256) throw new Error('The project metadata hash does not match.');
    let rawProduct: unknown;
    try { rawProduct = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(projectBytes)); }
    catch { throw new Error('The project metadata is invalid JSON.'); }
    const product = validateBackupProduct(rawProduct);
    assertNoSecrets(product);
    if (product.productId !== manifest.productId || declared.size !== product.sourceAssets.length + 1) throw new Error('The project and manifest do not match.');
    const sources: BackupSource[] = [];
    for (let index = 0; index < product.sourceAssets.length; index++) {
      cancelled(signal);
      const metadata = product.sourceAssets[index];
      const path = sourcePath(metadata);
      const info = declared.get(path), entry = entries.get(path);
      if (!info || !entry || info.role !== 'original' || info.sourceAssetId !== metadata.assetId || info.mimeType !== metadata.mimeType || info.sha256 !== metadata.sha256 || info.bytes !== entry.uncompressedSize) throw new Error('The original source and manifest do not match.');
      progress(`Verifying original ${index + 1} of ${product.sourceAssets.length}…`);
      const blob = await readEntry(entry, MAX_IMAGE, signal);
      const sourceFile = new File([blob], metadata.filename, { type: metadata.mimeType });
      const prepared = await prepareSource(sourceFile);
      try {
        cancelled(signal);
        if (prepared.metadata.sha256 !== metadata.sha256 || prepared.metadata.width !== metadata.width || prepared.metadata.height !== metadata.height) throw new Error('An original source hash or dimensions do not match.');
        sources.push({ metadata, blob: sourceFile, exifOrientation: prepared.exifOrientation });
      } finally {
        URL.revokeObjectURL(prepared.previewUrl);
      }
    }
    cancelled(signal);
    return { product, sources, totalBytes, conflict: await hasImportConflict(product) };
  } finally {
    await reader.close();
  }
}
