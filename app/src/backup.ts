import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter, configure, type FileEntry } from '@zip.js/zip.js/lib/zip-core-native.js';
import validateManifest from 'virtual:export-manifest-validator';
import { checkBackupPixelWork, getBackupSnapshot, hasImportConflict, validateBackupHistory, validateBackupProduct, type BackupHistory, type BackupMask, type BackupSource, type MaskMetadata, type Product } from './products';
import { prepareSource, sha256 } from './prepareSource';

configure({ useWebWorkers: false });
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;
const MAX_ARCHIVE = 340 * 1024 * 1024;
const MAX_TOTAL = 338 * 1024 * 1024;
const MAX_MASKS = 512;
const MAX_ENTRIES = 2001;
const MAX_FILES = 2000;
const MAX_RATIO = 200;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SAFE_PATH = new RegExp(`^(?:project\\.json|export-manifest\\.json|originals/${UUID}\\.(?:png|jpg|webp)|masks/${UUID}\\.(?:png|json)|history/(?:jobs|attempts|qa|heads)/${UUID}\\.json|history/assets/${UUID}\\.(?:json|png)|history/(?:ads|copy-layers)/${UUID}\\.png)$`);

type ManifestFile = { path: string; sha256: string; bytes: number; mimeType: string; approved: boolean; role: 'project' | 'original' | 'mask' | 'receipt' | 'qa' | 'output'; sourceAssetId?: string | null; attemptId?: string | null; qaId?: string | null };
type Manifest = { schemaVersion: '1.0.0' | '2.0.0' | '3.0.0' | '4.0.0'; exportId: string; productId: string; createdAt: string; approvedOnly: boolean; files: ManifestFile[]; appVersion: string };
export type BackupPreview = { product: Product; sources: BackupSource[]; masks: BackupMask[]; history: BackupHistory; totalBytes: number; conflict: boolean };
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

function maskPath(maskId: string, extension: 'json' | 'png'): string {
  return `masks/${maskId}.${extension}`;
}

export async function createBackup(productId: string, signal: AbortSignal, progress: Progress): Promise<Blob> {
  progress('Checking the project and original files…');
  const snapshot = await getBackupSnapshot(productId, signal);
  cancelled(signal);
  const files: ManifestFile[] = [];
  const contents: Array<{ path: string; data: Blob | Uint8Array<ArrayBuffer> }> = [];
  const seen = new Set<string>();
  async function add(path: string, data: Blob | Uint8Array<ArrayBuffer>, role: ManifestFile['role'], refs: Pick<ManifestFile, 'sourceAssetId' | 'attemptId' | 'qaId'> = {}) {
    cancelled(signal);
    if (!SAFE_PATH.test(path) || seen.has(path.toLowerCase()) || files.length >= MAX_FILES) throw new Error('The project has invalid, duplicate, or too many backup records. No data was omitted.');
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const mimeType = path.endsWith('.json') ? 'application/json' : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.webp') ? 'image/webp' : 'image/png';
    if (!bytes.length || bytes.length > (mimeType === 'application/json' ? MAX_JSON : MAX_IMAGE)) throw new Error('A backup record exceeds its size limit.');
    seen.add(path.toLowerCase());
    files.push({ path, sha256: await sha256(bytes), bytes: bytes.length, mimeType, approved: false, role, ...refs });
    contents.push({ path, data });
  }
  function json(value: unknown): Uint8Array<ArrayBuffer> {
    assertNoSecrets(value);
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (item instanceof Blob) throw new Error('Unexpected binary data in backup metadata.');
      return item;
    });
    if (text === undefined) throw new Error('Invalid backup metadata.');
    return new TextEncoder().encode(text);
  }
  await add('project.json', json(snapshot.product), 'project');
  for (const source of snapshot.sources) {
    if (await sha256(new Uint8Array(await source.blob.arrayBuffer())) !== source.metadata.sha256) throw new Error('An original source hash does not match.');
    await add(sourcePath(source.metadata), source.blob, 'original', { sourceAssetId: source.metadata.assetId });
  }
  if (snapshot.masks.length > MAX_MASKS) throw new Error('This project has too many mask versions for one backup. No data was omitted.');
  for (const mask of snapshot.masks) {
    await add(maskPath(mask.metadata.maskId, 'json'), json(mask.metadata), 'mask', { sourceAssetId: mask.metadata.sourceAssetId });
    if (await sha256(new Uint8Array(await mask.blob.arrayBuffer())) !== mask.metadata.sha256) throw new Error('A mask hash does not match.');
    await add(maskPath(mask.metadata.maskId, 'png'), mask.blob, 'mask', { sourceAssetId: mask.metadata.sourceAssetId });
  }
  for (const job of snapshot.history.jobs) await add(`history/jobs/${job.jobId}.json`, json(job), 'receipt');
  for (const attempt of snapshot.history.attempts) await add(`history/attempts/${attempt.attemptId}.json`, json(attempt), 'receipt', { attemptId: attempt.attemptId });
  for (const asset of snapshot.history.assets) {
    const { blob, ...rest } = asset;
    const { ad, copyLayer, ...metadata } = rest as typeof rest & { ad?: Blob; copyLayer?: Blob };
    const refs = { attemptId: asset.attemptId };
    await add(`history/assets/${asset.assetId}.json`, json(metadata), 'receipt', refs);
    await add(`history/assets/${asset.assetId}.png`, blob, 'output', refs);
    if (ad) await add(`history/ads/${asset.assetId}.png`, ad, 'output', refs);
    if (copyLayer) await add(`history/copy-layers/${asset.assetId}.png`, copyLayer, 'output', refs);
  }
  for (const review of snapshot.history.reviews) await add(`history/qa/${review.qaId}.json`, json(review), 'qa', { attemptId: review.attemptId, qaId: review.qaId });
  for (const head of snapshot.history.heads) await add(`history/heads/${head.key.slice('visual-review-head:'.length)}.json`, json(head), 'receipt');
  const manifest: Manifest = { schemaVersion: snapshot.history.assets.some((asset) => 'kind' in asset && asset.kind === 'strict-composite' && Object.hasOwn(asset, 'protectedEvidenceSha256')) ? '4.0.0' : snapshot.masks.some((mask) => mask.metadata.protectedEvidence !== undefined) ? '3.0.0' : '2.0.0', exportId: crypto.randomUUID(), productId: snapshot.product.productId, createdAt: new Date().toISOString(), appVersion: __APP_VERSION__, approvedOnly: false, files };
  if (!validateManifest(manifest)) throw new Error('The backup manifest is invalid.');
  const manifestBytes = json(manifest);
  if (manifestBytes.length > MAX_JSON || files.reduce((sum, item) => sum + item.bytes, manifestBytes.length) > MAX_TOTAL) throw new Error('This project exceeds the backup size limit. No data was omitted.');
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false, level: 0 });
  try {
    for (const item of contents) {
      cancelled(signal);
      progress(`Adding ${item.path}…`);
      await writer.add(item.path, item.data instanceof Blob ? new BlobReader(item.data) : new Uint8ArrayReader(item.data), { signal });
    }
    await writer.add('export-manifest.json', new Uint8ArrayReader(manifestBytes), { signal });
    cancelled(signal);
    const archive = await writer.close();
    if (archive.size > MAX_ARCHIVE) throw new Error('This project exceeds the backup archive limit. No data was omitted.');
    return archive;
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
      if (!SAFE_PATH.test(entry.filename)) throw new Error('The archive contains an unsupported or unsafe path.');
      if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize) || entry.uncompressedSize < 0 || entry.compressedSize < 0 ||
          entry.uncompressedSize > (entry.filename.endsWith('.json') ? MAX_JSON : MAX_IMAGE) ||
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
    if ((manifest.schemaVersion === '1.0.0' && !manifest.approvedOnly) || (manifest.schemaVersion !== '1.0.0' && manifest.approvedOnly) || !['1.0.0', '2.0.0', '3.0.0', '4.0.0'].includes(manifest.schemaVersion) || manifest.files.length > MAX_FILES) throw new Error('This backup contains data that this version cannot safely restore.');
    const declared = new Map<string, ManifestFile>();
    for (const item of manifest.files) {
      if (declared.has(item.path) || item.approved || (manifest.schemaVersion === '1.0.0' && (!['project', 'original', 'mask'].includes(item.role) || item.attemptId || item.qaId || item.path.startsWith('history/')))) throw new Error('The backup contains unsupported or duplicate manifest entries.');
      declared.set(item.path, item);
    }
    if (declared.size + 1 !== entries.size || [...declared.keys()].some((path) => !entries.has(path))) throw new Error('The manifest and archive entries do not match.');
    const projectInfo = declared.get('project.json');
    if (!projectInfo || projectInfo.role !== 'project' || projectInfo.mimeType !== 'application/json' || projectInfo.sourceAssetId || projectInfo.attemptId || projectInfo.qaId) throw new Error('The project manifest entry is invalid.');
    const projectBlob = await readEntry(projectEntry, MAX_JSON, signal);
    const projectBytes = new Uint8Array(await projectBlob.arrayBuffer());
    if (projectBytes.length !== projectInfo.bytes || await sha256(projectBytes) !== projectInfo.sha256) throw new Error('The project metadata hash does not match.');
    let rawProduct: unknown;
    try { rawProduct = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(projectBytes)); }
    catch { throw new Error('The project metadata is invalid JSON.'); }
    assertNoSecrets(rawProduct);
    const product = validateBackupProduct(rawProduct);
    assertNoSecrets(product);
    if (product.productId !== manifest.productId) throw new Error('The project and manifest do not match.');
    checkBackupPixelWork(product, []);
    const sources: BackupSource[] = [];
    for (let index = 0; index < product.sourceAssets.length; index++) {
      cancelled(signal);
      const metadata = product.sourceAssets[index];
      const path = sourcePath(metadata);
      const info = declared.get(path), entry = entries.get(path);
      if (!info || !entry || info.role !== 'original' || info.sourceAssetId !== metadata.assetId || info.attemptId || info.qaId || info.mimeType !== metadata.mimeType || info.sha256 !== metadata.sha256 || info.bytes !== entry.uncompressedSize) throw new Error('The original source and manifest do not match.');
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
    const masks: BackupMask[] = [];
    const maskInfos = [...declared.values()].filter((item) => item.role === 'mask');
    if (maskInfos.length % 2 || maskInfos.length / 2 > MAX_MASKS) throw new Error('The backup has missing or extra mask entries.');
    for (const info of maskInfos.filter((item) => item.path.endsWith('.json'))) {
      cancelled(signal);
      const match = /^masks\/([0-9a-f-]{36})\.json$/i.exec(info.path);
      const entry = entries.get(info.path);
      if (!match || !entry || info.mimeType !== 'application/json' || !info.sourceAssetId || info.attemptId || info.qaId || info.bytes !== entry.uncompressedSize) throw new Error('A mask metadata entry is invalid.');
      const metadataBlob = await readEntry(entry, MAX_JSON, signal);
      const metadataBytes = new Uint8Array(await metadataBlob.arrayBuffer());
      if (await sha256(metadataBytes) !== info.sha256) throw new Error('Mask metadata hash does not match.');
      let metadata: MaskMetadata;
      try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes)) as MaskMetadata; }
      catch { throw new Error('Mask metadata is invalid JSON.'); }
      if (!metadata || typeof metadata !== 'object' || metadata.maskId !== match[1] || metadata.sourceAssetId !== info.sourceAssetId) throw new Error('Mask metadata and manifest do not match.');
      assertNoSecrets(metadata);
      const pngPath = maskPath(metadata.maskId, 'png'), pngInfo = declared.get(pngPath), pngEntry = entries.get(pngPath);
      if (!pngInfo || !pngEntry || pngInfo.role !== 'mask' || pngInfo.mimeType !== 'image/png' || pngInfo.sourceAssetId !== metadata.sourceAssetId || pngInfo.attemptId || pngInfo.qaId || pngInfo.sha256 !== metadata.sha256 || pngInfo.bytes !== pngEntry.uncompressedSize) throw new Error('The mask PNG and manifest do not match.');
      progress(`Verifying mask version ${masks.length + 1} of ${maskInfos.length / 2}…`);
      masks.push({ metadata, blob: await readEntry(pngEntry, MAX_IMAGE, signal) });
    }
    if (masks.length * 2 !== maskInfos.length) throw new Error('The backup has missing or extra mask entries.');
    const hasProtectedEvidence = masks.some((mask) => Object.hasOwn(mask.metadata, 'protectedEvidence') || Object.hasOwn(mask.metadata, 'protectedEvidenceSha256'));
    if (hasProtectedEvidence !== (manifest.schemaVersion === '3.0.0' || manifest.schemaVersion === '4.0.0')) throw new Error('The backup version does not match its protected mask evidence.');
    const history: BackupHistory = { jobs: [], attempts: [], assets: [], reviews: [], heads: [] };
    const consumed = new Set(['project.json', ...product.sourceAssets.map(sourcePath), ...maskInfos.map((item) => item.path)]);
    async function historyFile(path: string, role: ManifestFile['role'], attemptId?: string, qaId?: string): Promise<Blob> {
      const info = declared.get(path), entry = entries.get(path);
      const mime = path.endsWith('.json') ? 'application/json' : 'image/png';
      if (!info || !entry || consumed.has(path) || info.role !== role || info.mimeType !== mime || info.sourceAssetId != null || (info.attemptId ?? undefined) !== attemptId || (info.qaId ?? undefined) !== qaId || info.bytes !== entry.uncompressedSize) throw new Error('A history record and its manifest do not match.');
      const raw = await readEntry(entry, mime === 'application/json' ? MAX_JSON : MAX_IMAGE, signal);
      const bytes = new Uint8Array(await raw.arrayBuffer());
      if (await sha256(bytes) !== info.sha256) throw new Error('A history record hash does not match.');
      consumed.add(path);
      return new Blob([bytes], { type: mime });
    }
    async function historyJson(path: string, role: ManifestFile['role'], attemptId?: string, qaId?: string): Promise<Record<string, unknown>> {
      const blob = await historyFile(path, role, attemptId, qaId);
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer())); }
      catch { throw new Error('History metadata is invalid JSON.'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('History metadata is invalid.');
      assertNoSecrets(value);
      return value as Record<string, unknown>;
    }
    if (manifest.schemaVersion !== '1.0.0') {
      for (const path of declared.keys()) {
        const match = new RegExp(`^history/(jobs|attempts|assets|qa|heads)/(${UUID})\\.json$`).exec(path);
        if (!match) continue;
        const [, kind, id] = match;
        const info = declared.get(path)!;
        const value = await historyJson(path, kind === 'qa' ? 'qa' : 'receipt', kind === 'attempts' ? id : kind === 'assets' || kind === 'qa' ? info.attemptId ?? undefined : undefined, kind === 'qa' ? id : undefined);
        if (kind === 'jobs') {
          if (value.jobId !== id) throw new Error('Job path does not match its metadata.');
          history.jobs.push(value as unknown as BackupHistory['jobs'][number]);
        } else if (kind === 'attempts') {
          if (value.attemptId !== id) throw new Error('Attempt path does not match its metadata.');
          history.attempts.push(value as unknown as BackupHistory['attempts'][number]);
        } else if (kind === 'qa') {
          if (value.qaId !== id || value.attemptId !== info.attemptId) throw new Error('Review path does not match its metadata.');
          history.reviews.push(value as unknown as BackupHistory['reviews'][number]);
        } else if (kind === 'heads') {
          if (value.key !== `visual-review-head:${id}`) throw new Error('Review head path does not match its metadata.');
          history.heads.push(value as unknown as BackupHistory['heads'][number]);
        } else {
          if (value.assetId !== id || typeof value.attemptId !== 'string' || value.attemptId !== info.attemptId || 'blob' in value || 'ad' in value || 'copyLayer' in value) throw new Error('Asset metadata is invalid.');
          const blob = await historyFile(`history/assets/${id}.png`, 'output', value.attemptId);
          const asset: Record<string, unknown> = { ...value, blob };
          if (value.adSha256 !== undefined) asset.ad = await historyFile(`history/ads/${id}.png`, 'output', value.attemptId);
          const recipe = value.recipe;
          if (recipe && typeof recipe === 'object' && 'copyLayerSha256' in recipe) asset.copyLayer = await historyFile(`history/copy-layers/${id}.png`, 'output', value.attemptId);
          history.assets.push(asset as unknown as BackupHistory['assets'][number]);
        }
      }
    }
    const hasProtectedComposite = history.assets.some((asset) => Object.hasOwn(asset, 'protectedEvidenceSha256'));
    if (hasProtectedComposite !== (manifest.schemaVersion === '4.0.0')) throw new Error('The backup version does not match its protected composite evidence.');
    if (consumed.size !== declared.size) throw new Error('The backup contains missing or extra records.');
    await validateBackupHistory(product, sources, masks, history, signal);
    cancelled(signal);
    return { product, sources, masks, history, totalBytes, conflict: await hasImportConflict(product, masks, history) };
  } finally {
    await reader.close();
  }
}
