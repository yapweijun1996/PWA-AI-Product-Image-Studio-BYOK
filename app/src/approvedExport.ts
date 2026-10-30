import { BlobReader, BlobWriter, Uint8ArrayReader, ZipWriter, configure } from '@zip.js/zip.js/lib/zip-core-native.js';
import validateManifest from 'virtual:export-manifest-validator';
import { STUDIO_MODEL, STUDIO_PROMPT, STUDIO_PROMPT_VERSION, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PRICING_SNAPSHOT, studioBuildPrompt, studioEstimateUSD, studioObservedUSD } from '../studio-policy.mjs';
import { recipeMapping } from './strictComposite';
import type { ApprovedExportProvenance, ApprovedExportSelection } from './products';
import { inspectImageHeader } from './imageHeader';
import { sha256 } from './prepareSource';

configure({ useWebWorkers: false });
export type OutputFormat = 'png' | 'jpeg' | 'webp';
export type OutputRatio = '1:1' | '4:5' | '9:16' | '16:9';
export type OutputConversion = { sourceSha256: string; sourceWidth: 1024; sourceHeight: 1024; format: OutputFormat; mimeType: string; ratio: OutputRatio; outputWidth: number; outputHeight: number; scale: number; x: number; y: number; width: number; height: number; background: 'transparent' | 'white' };
export type RenderedApprovedOutput = { blob: Blob; sha256: string; conversion: OutputConversion };
export type ApprovedOutputSelection = ApprovedExportSelection;
export type ApprovedOutputProvenance = ApprovedExportProvenance;
export type ApprovedOutputEntry = { selection: ApprovedOutputSelection; provenance: ApprovedOutputProvenance; rendered: RenderedApprovedOutput; ad?: Blob; copyLayer?: Blob };

const MAX_IMAGE = 20 * 1024 * 1024, MAX_TOTAL = 320 * 1024 * 1024, MAX_OUTPUTS = 100, MAX_JSON = 1024 * 1024;
const dimensions: Record<OutputRatio, [number, number]> = { '1:1': [1024, 1024], '4:5': [1024, 1280], '9:16': [900, 1600], '16:9': [1600, 900] };
const mimes: Record<OutputFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function cancelled(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Cancelled by user.', 'AbortError'); }
function invalid(): never { throw new Error('Invalid or unsupported approved output provenance.'); }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validDate(value: unknown): boolean { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function validUsage(value: unknown): boolean {
  if (value === null) return true;
  const token = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  if (!isObject(value) || Object.keys(value).some((key) => !['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details'].includes(key)) ||
      !token(value.input_tokens) || !token(value.output_tokens) || !token(value.total_tokens) ||
      value.input_tokens > value.total_tokens || value.output_tokens !== value.total_tokens - value.input_tokens) return false;
  for (const [key, limit] of [['input_tokens_details', value.input_tokens], ['output_tokens_details', value.output_tokens]] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const details = value[key];
    if (!isObject(details) || !Object.keys(details).length || Object.keys(details).some((field) => !['text_tokens', 'image_tokens'].includes(field))) return false;
    let remaining = limit;
    for (const field of ['image_tokens', 'text_tokens']) {
      if (!Object.hasOwn(details, field)) continue;
      const amount = details[field];
      if (!token(amount) || amount > remaining) return false;
      remaining -= amount;
    }
  }
  return true;
}
function conversionFor(sourceSha256: string, format: OutputFormat, ratio: OutputRatio): OutputConversion {
  const [outputWidth, outputHeight] = dimensions[ratio];
  const scale = Math.min(outputWidth / 1024, outputHeight / 1024), width = 1024 * scale, height = 1024 * scale;
  return { sourceSha256, sourceWidth: 1024, sourceHeight: 1024, format, mimeType: mimes[format], ratio, outputWidth, outputHeight, scale, x: (outputWidth - width) / 2, y: (outputHeight - height) / 2, width, height, background: format === 'jpeg' ? 'white' : 'transparent' };
}
async function imageBytes(blob: Blob, mime: string, width: number, height: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  cancelled(signal);
  if (!(blob instanceof Blob) || blob.type !== mime || blob.size < 1 || blob.size > MAX_IMAGE) throw new Error('Invalid image or unsupported browser encoder.');
  const bytes = new Uint8Array(await blob.arrayBuffer()); cancelled(signal);
  const header = inspectImageHeader(bytes);
  if (header.mimeType !== mime || header.width !== width || header.height !== height || header.orientation !== 1) throw new Error('Image format or dimensions do not match.');
  return bytes;
}
type DecodedOutput = { image: CanvasImageSource; width: number; height: number; release: () => void };
async function decodeOutput(blob: Blob, signal: AbortSignal): Promise<DecodedOutput> {
  cancelled(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(blob);
      if (signal.aborted) { image.close(); cancelled(signal); }
      return { image, width: image.width, height: image.height, release: () => image.close() };
    } catch (error) {
      cancelled(signal);
      if (typeof Image === 'undefined') throw error;
    }
  }
  if (typeof Image === 'undefined') throw new Error('Image decoding is unavailable on this device.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
      const abort = () => { cleanup(); reject(new DOMException('Cancelled by user.', 'AbortError')); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('The image could not be decoded.')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else image.src = url;
    });
    cancelled(signal);
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
export async function renderApprovedOutput(blob: Blob, format: OutputFormat, ratio: OutputRatio, signal: AbortSignal): Promise<RenderedApprovedOutput> {
  cancelled(signal);
  if (!Object.hasOwn(mimes, format) || !Object.hasOwn(dimensions, ratio)) throw new Error('Unsupported output format or ratio.');
  const source = await imageBytes(blob, 'image/png', 1024, 1024, signal);
  const sourceSha256 = await sha256(source); cancelled(signal);
  const conversion = conversionFor(sourceSha256, format, ratio);
  const decoded = await decodeOutput(blob, signal);
  try {
    cancelled(signal);
    if (decoded.width !== 1024 || decoded.height !== 1024) throw new Error('Composite dimensions do not match.');
    const canvas = document.createElement('canvas'); canvas.width = conversion.outputWidth; canvas.height = conversion.outputHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas rendering is unavailable.');
    if (conversion.background === 'white') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(decoded.image, conversion.x, conversion.y, conversion.width, conversion.height);
    const rendered = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image encoder failed.')), conversion.mimeType));
    const bytes = await imageBytes(rendered, conversion.mimeType, conversion.outputWidth, conversion.outputHeight, signal);
    const outputHash = await sha256(bytes); cancelled(signal);
    return { blob: rendered, sha256: outputHash, conversion };
  } finally { decoded.release(); }
}

function checkedProvenance(entry: ApprovedOutputEntry) {
  if (!isObject(entry) || !isObject(entry.selection) || !isObject(entry.provenance) || !isObject(entry.rendered)) invalid();
  const s = entry.selection, p = entry.provenance;
  for (const id of [s.attemptId, s.assetId, s.reviewId, s.decisionId, p.attemptId, p.jobId, p.reviewId, p.decisionId, p.sourceAssetId, p.maskId, p.sceneAssetId]) if (typeof id !== 'string' || !uuid.test(id)) invalid();
  for (const h of [s.productSha256, s.assetSha256, p.sourceSha256, p.maskSha256, p.sceneSha256, p.assetSha256, p.productSha256, p.promptSha256]) if (typeof h !== 'string' || !hash.test(h)) invalid();
  if (s.attemptId !== p.attemptId || s.reviewId !== p.reviewId || s.decisionId !== p.decisionId || s.assetSha256 !== p.assetSha256 || s.productSha256 !== p.productSha256 || p.model !== STUDIO_MODEL || p.quality !== STUDIO_QUALITY || p.size !== STUDIO_SIZE || !validUsage(p.usage) || !validDate(p.createdAt) || !validDate(p.submittedAt) || !validDate(p.reviewedAt) || !validDate(p.decidedAt)) invalid();
  const versioned = p.promptVersion === STUDIO_SCENE_PROMPT_VERSION;
  let extra = {};
  if (versioned) {
    const allowed = ['attemptId', 'jobId', 'assetId', 'model', 'promptVersion', 'prompt', 'promptSha256', 'styleId', 'quality', 'size', 'usage', 'estimatedUSD', 'observedUSD', 'pricingSnapshot', 'createdAt', 'submittedAt', 'reviewId', 'reviewedAt', 'decisionId', 'decidedAt', 'sourceAssetId', 'sourceSha256', 'maskId', 'maskSha256', 'sceneAssetId', 'sceneSha256', 'assetSha256', 'productSha256', 'presetVersion', 'sceneContext', 'selectedFactIds', 'productSnapshotFingerprint', 'topViewConfirmed', 'recipe', 'recipeSha256', 'adSha256', 'mapping'];
    if (Object.keys(p).some((key) => !allowed.includes(key)) || ('assetId' in p && p.assetId !== s.assetId)) invalid();
    if (p.presetVersion !== STUDIO_PRESET_VERSION || !p.sceneContext || !p.recipe || !p.mapping ||
        !Array.isArray(p.selectedFactIds) || p.selectedFactIds.length !== p.sceneContext.confirmedFacts?.length ||
        p.selectedFactIds.some((id) => typeof id !== 'string' || !uuid.test(id)) || new Set(p.selectedFactIds).size !== p.selectedFactIds.length ||
        typeof p.productSnapshotFingerprint !== 'string' || !hash.test(p.productSnapshotFingerprint) ||
        typeof p.recipeSha256 !== 'string' || !hash.test(p.recipeSha256) ||
        p.recipe.styleId !== p.styleId || p.recipe.sourceView !== p.sceneContext.sourceView || p.recipe.topViewConfirmed !== p.topViewConfirmed ||
        (p.topViewConfirmed !== undefined && p.topViewConfirmed !== true)) invalid();
    try { if (p.prompt !== studioBuildPrompt(p.styleId, p.sceneContext) || p.estimatedUSD !== studioEstimateUSD(p.prompt)) invalid(); } catch { invalid(); }
    const mapping = recipeMapping(p.recipe, p.mapping.sourceWidth, p.mapping.sourceHeight);
    if (Object.keys(p.mapping).length !== 6 || Object.entries(mapping).some(([key, value]) => p.mapping![key as keyof typeof mapping] !== value)) invalid();
    if (p.recipe.copy && /\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9_-]{8,}|(?:api[\s-]*key|password|secret|token)\s*[:=]\s*\S+)/i.test(p.recipe.copy)) invalid();
    if (p.styleId === 'billboard' ? (!entry.ad || typeof p.adSha256 !== 'string' || !hash.test(p.adSha256)) : (entry.ad !== undefined || p.adSha256 !== undefined)) invalid();
    if (p.styleId === 'billboard' && p.recipe.copy ? (!entry.copyLayer || typeof p.recipe.copyLayerSha256 !== 'string' || !hash.test(p.recipe.copyLayerSha256)) : (entry.copyLayer !== undefined || p.recipe.copyLayerSha256 !== undefined)) invalid();
    const rect = (r: NonNullable<typeof p.recipe>['crop']) => r && Object.fromEntries(Object.keys(r).map((key) => [key, r[key as keyof typeof r]]));
    const recipeValues = { version: p.recipe.version, styleId: p.recipe.styleId, sourceView: p.recipe.sourceView, topViewConfirmed: p.recipe.topViewConfirmed,
      crop: rect(p.recipe.crop), display: rect(p.recipe.display), displayFrontFacing: p.recipe.displayFrontFacing, copy: p.recipe.copy, copyLayerSha256: p.recipe.copyLayerSha256 };
    const recipe = Object.fromEntries(Object.keys(p.recipe).map((key) => [key, recipeValues[key as keyof typeof recipeValues]]));
    extra = { presetVersion: p.presetVersion, sceneContext: { productName: p.sceneContext.productName, category: p.sceneContext.category, confirmedFacts: [...p.sceneContext.confirmedFacts], sourceView: p.sceneContext.sourceView },
      selectedFactIds: [...p.selectedFactIds], productSnapshotFingerprint: p.productSnapshotFingerprint, ...(p.topViewConfirmed === undefined ? {} : { topViewConfirmed: p.topViewConfirmed }),
      recipe, recipeSha256: p.recipeSha256, ...(p.adSha256 === undefined ? {} : { adSha256: p.adSha256 }), mapping };
  } else if (p.promptVersion !== STUDIO_PROMPT_VERSION || p.prompt !== STUDIO_PROMPT || p.styleId !== 'studio' || p.estimatedUSD !== studioEstimateUSD() ||
      p.presetVersion !== undefined || p.sceneContext !== undefined || p.selectedFactIds !== undefined || p.productSnapshotFingerprint !== undefined || p.topViewConfirmed !== undefined ||
      p.recipe !== undefined || p.recipeSha256 !== undefined || p.adSha256 !== undefined || p.mapping !== undefined || entry.ad !== undefined || entry.copyLayer !== undefined) invalid();
  if (p.observedUSD === null ? p.pricingSnapshot !== null : p.pricingSnapshot !== STUDIO_PRICING_SNAPSHOT || studioObservedUSD(p.usage) !== p.observedUSD) invalid();
  // Reconstruct every exported field; never serialize stored objects wholesale.
  const usage = p.usage === null ? null : Object.fromEntries(Object.entries(p.usage).map(([key, value]) => [key, isObject(value) ? Object.fromEntries(Object.entries(value)) : value]));
  return { attemptId: p.attemptId, jobId: p.jobId, assetId: s.assetId, sourceAssetId: p.sourceAssetId, maskId: p.maskId, sceneAssetId: p.sceneAssetId, reviewId: p.reviewId, decisionId: p.decisionId, sourceSha256: p.sourceSha256, maskSha256: p.maskSha256, sceneSha256: p.sceneSha256, assetSha256: p.assetSha256, productSha256: p.productSha256, model: p.model, promptVersion: p.promptVersion, prompt: p.prompt, promptSha256: p.promptSha256, quality: p.quality, size: p.size, styleId: p.styleId, createdAt: p.createdAt, usage, estimatedUSD: p.estimatedUSD, observedUSD: p.observedUSD, pricingSnapshot: p.pricingSnapshot, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, decidedAt: p.decidedAt, ...extra };
}
export async function packageApprovedOutputs(productId: string, entries: ApprovedOutputEntry[], signal: AbortSignal): Promise<Blob> {
  cancelled(signal);
  if (typeof productId !== 'string' || !uuid.test(productId) || !Array.isArray(entries) || !entries.length || entries.length > MAX_OUTPUTS) throw new Error('Invalid output bundle selection.');
  const files: Array<{ path: string; sha256: string; bytes: number; mimeType: string; approved: boolean; role: 'output' | 'receipt'; sourceAssetId: string; attemptId: string; qaId: string }> = [];
  const items: Array<{ path: string; blob: Blob | Uint8Array }> = [];
  const seen = new Set<string>(); let total = 0;
  for (const entry of entries) {
    cancelled(signal);
    const provenance = checkedProvenance(entry), r = entry.rendered, c = r.conversion;
    if (await sha256(new TextEncoder().encode(provenance.prompt)) !== provenance.promptSha256) invalid();
    if (entry.provenance.recipe && await sha256(new TextEncoder().encode(JSON.stringify(entry.provenance.recipe))) !== entry.provenance.recipeSha256) invalid();
    if (seen.has(provenance.assetId)) throw new Error('Duplicate output IDs.'); seen.add(provenance.assetId);
    if (!isObject(c) || !Object.hasOwn(mimes, c.format) || !Object.hasOwn(dimensions, c.ratio) || c.sourceSha256 !== provenance.assetSha256 || JSON.stringify(c) !== JSON.stringify(conversionFor(provenance.assetSha256, c.format, c.ratio))) invalid();
    const bytes = await imageBytes(r.blob, c.mimeType, c.outputWidth, c.outputHeight, signal);
    if (!hash.test(r.sha256) || await sha256(bytes) !== r.sha256) throw new Error('Rendered output hash does not match.');
    cancelled(signal);
    const path = `outputs/${provenance.assetId}.${c.format === 'jpeg' ? 'jpg' : c.format}`;
    const infoPath = `provenance/${provenance.assetId}.json`;
    const info = new TextEncoder().encode(JSON.stringify({ bundleType: 'approved-output-bundle', ...provenance, outputSha256: r.sha256, conversion: conversionFor(provenance.assetSha256, c.format, c.ratio) }, null, 2));
    if (info.length > MAX_JSON) throw new Error('Output provenance exceeds the limit.');
    const meta = { approved: true, sourceAssetId: provenance.sourceAssetId, attemptId: provenance.attemptId, qaId: provenance.decisionId };
    files.push({ path, sha256: r.sha256, bytes: bytes.length, mimeType: c.mimeType, role: 'output', ...meta }, { path: infoPath, sha256: await sha256(info), bytes: info.length, mimeType: 'application/json', role: 'receipt', ...meta });
    items.push({ path, blob: r.blob }, { path: infoPath, blob: info }); total += bytes.length + info.length;
    if (entry.ad) {
      const ad = await imageBytes(entry.ad, 'image/png', 1024, 1024, signal);
      if (await sha256(ad) !== entry.provenance.adSha256) invalid();
      const adPath = `ads/${provenance.assetId}.png`;
      files.push({ path: adPath, sha256: entry.provenance.adSha256!, bytes: ad.length, mimeType: 'image/png', role: 'output', ...meta });
      items.push({ path: adPath, blob: entry.ad }); total += ad.length;
    }
    if (entry.copyLayer) {
      const layer = await imageBytes(entry.copyLayer, 'image/png', 1024, 1024, signal);
      const layerHash = entry.provenance.recipe?.copyLayerSha256;
      if (!layerHash || await sha256(layer) !== layerHash) invalid();
      const layerPath = `copy-layers/${provenance.assetId}.png`;
      files.push({ path: layerPath, sha256: layerHash, bytes: layer.length, mimeType: 'image/png', role: 'output', ...meta });
      items.push({ path: layerPath, blob: entry.copyLayer }); total += layer.length;
    }
    if (total > MAX_TOTAL) throw new Error('Output bundle exceeds the size limit.');
  }
  const manifest = { schemaVersion: '1.0.0', exportId: crypto.randomUUID(), productId, createdAt: new Date().toISOString(), approvedOnly: true, files, appVersion: __APP_VERSION__ };
  if (!validateManifest(manifest)) throw new Error('The output bundle manifest is invalid.');
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (manifestBytes.length > MAX_JSON || total + manifestBytes.length > MAX_TOTAL) throw new Error('Output bundle exceeds the size limit.');
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false, level: 0 });
  try {
    for (const item of items) { cancelled(signal); await writer.add(item.path, item.blob instanceof Blob ? new BlobReader(item.blob) : new Uint8ArrayReader(item.blob), { signal }); }
    await writer.add('export-manifest.json', new Uint8ArrayReader(manifestBytes), { signal });
    cancelled(signal); const archive = await writer.close(); cancelled(signal);
    if (archive.size > MAX_TOTAL + 1024 * 1024) throw new Error('Output bundle exceeds the archive limit.');
    return archive;
  } catch (error) { await writer.close().catch(() => undefined); throw error; }
}
