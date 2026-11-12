import { automaticStyleLabel, type AutomaticMode } from "../automatic-policy.mjs";
import {Icon} from './ui/Icon';
import {Disclosure, DisclosureSummary} from './ui/components';
import { t } from './ui/i18n';
import { Button, Input, Progress, ImagePlaceholder, ErrorNotice } from './ui/components';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { automaticPlan, runAutomatic } from "./automaticPipeline";
import { automaticSessionStatus } from "./automaticSession";
import { browserKeyStatus, onBrowserKeyChange, referenceTransmissionAllowed, setReferenceTransmissionConsent, onReferenceConsentChange } from "./browserByok";
import {
  checkedOutput,
  listAutoRuns,
  type AutoRun,
  type AutoItem,
} from "./automaticStore";
import { useUnsavedChanges } from "./useUnsavedChanges";
function resultLabel(item: AutoItem) {
  if (!item.provenance) return item.style === "macro" ? "Detail · legacy layout" : item.style === "flat_lay" ? "Tabletop · source angle (legacy)" : automaticStyleLabel(item.style);
  return automaticStyleLabel(item.style, item.provenance.mode);
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function ResultCard({
  item,
  processing = false,
  showError = true,
  onError,
}: {
  item: AutoItem;
  processing?: boolean;
  showError?: boolean;
  onError: (s: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [downloading,setDownloading] = useState(false);
  const downloadLock = useRef(false);
  useEffect(() => {
    if (!item.output) return;
    const value = URL.createObjectURL(item.output);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [item.output]);
  return (
    <article
      className="auto-result"
      aria-label={`${resultLabel(item)} result`}
      aria-busy={processing && item.status === "SUBMITTED"}
    >
      <div className="auto-result-image">
        {url && item.status === "READY" ? (
          <img src={url} alt={`${resultLabel(item)} product composition`} />
        ) : (
          <ImagePlaceholder active={processing && item.status === "SUBMITTED"} label={t(
            item.status === "SUBMITTED" ? (processing ? "Creating…" : "Request interrupted")
            : item.status === "PENDING" ? (processing ? "Queued" : "Not sent")
            : item.status === "UNKNOWN" ? "Request interrupted"
            : item.status === "FAILED" ? "Could not finish" : "Not sent"
          )}/>

        )}
      </div>
      <div className="auto-result-caption">
        <h3>{resultLabel(item)}</h3>
        {item.status === "READY" && (
          <Button
            type="button"
            className="secondary-button"
            disabled={downloading}
            aria-label={`Download ${resultLabel(item)}`}
            aria-busy={downloading}
            onClick={() => {
              if(downloadLock.current)return;
              downloadLock.current=true; setDownloading(true);
              void checkedOutput(item)
                .then((blob) => download(blob, `${item.style}.png`))
                .catch(() =>
                  onError("This saved image failed its integrity check."),
                ).finally(()=>{downloadLock.current=false;setDownloading(false)});
            }}
          >
            {downloading ? t("Preparing…") : t("Download")}
          </Button>
        )}
      </div>
      {item.provenance?.detailRoi && <p className="muted">Visible source crop · {item.provenance.detailRoi.width} × {item.provenance.detailRoi.height} px{item.provenance.detailUpscaled ? " · enlarged; no added detail" : ""}. No paid request.</p>}
      {item.style === "billboard" && item.provenance && <p className="muted">Complete text-free ad in a local display mockup.</p>}
      {item.provenance?.operation === "reference-edit" && <p className="muted">Reference-guided concept · product details may change.</p>}
      {item.error && (showError ? <p className="muted">{item.error}</p> : <Disclosure className="result-details"><DisclosureSummary>Image details</DisclosureSummary><p>{item.error}</p></Disclosure>)}
    </article>
  );
}
export function UploadStudio() {
  const [mode, setMode] = useState<AutomaticMode>("STRICT");
  const [referenceConsent, setReferenceConsent] = useState(referenceTransmissionAllowed);
  const [additionalReferences, setAdditionalReferences] = useState<File[]>([]);
  const [params] = useSearchParams();
  const selectedRun = params.get("run");
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [run, setRun] = useState<AutoRun | null>(null),
    [history, setHistory] = useState<AutoRun[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [session, setSession] = useState(automaticSessionStatus),
    [connected, setConnected] = useState(browserKeyStatus().connected);
  const active = useRef<AbortController | null>(null),
    running = useRef(false);
  useUnsavedChanges(busy || exporting || Boolean(run?.unsavedOutputs));
  useEffect(() => {
    let mounted = true;
    void listAutoRuns()
      .then((rows) => {
        if (mounted) {
          setHistory(rows);
          setRun(rows.find(row=>row.id===selectedRun) ?? rows[0] ?? null);
        }
      })
      .catch(() =>
        setError(
          "Saved results are unavailable. Preserve browser data and try again.",
        ),
      );
    const refresh = () => {
      setSession(automaticSessionStatus());
      setConnected(browserKeyStatus().connected);
      setReferenceConsent(referenceTransmissionAllowed());
    };
    const stop = onBrowserKeyChange(refresh);
    const stopReference = onReferenceConsentChange(refresh);
    window.addEventListener("studio-auto-session", refresh);
    window.addEventListener("online", refresh);window.addEventListener("offline", refresh);
    return () => {
      mounted = false;
      stop(); stopReference();
      window.removeEventListener("studio-auto-session", refresh);
      window.removeEventListener("online", refresh);window.removeEventListener("offline", refresh);
      active.current?.abort();
    };
  }, []);
  const handledSelection = useRef<string | null | undefined>(undefined);
  useEffect(()=>{
    if(!history.length || busy || run?.unsavedOutputs || exporting || handledSelection.current===selectedRun)return;
    handledSelection.current=selectedRun;
    if(selectedRun){const saved=history.find(row=>row.id===selectedRun);if(saved)setRun(saved);else setError("This saved upload is unavailable on this device.");}
  },[selectedRun,history,busy,run?.unsavedOutputs,exporting]);
  const unresolved = [...history,...(run?[run]:[])].some(row=>row.items.some(item=>(item.status==="SUBMITTED"||item.status==="UNKNOWN")&&!item.reviewedAt));
  const estimate = automaticPlan(mode, mode === "REFERENCE" ? 1 + additionalReferences.length : 1).estimatedUSD,
    ready = Boolean(
      session &&
      connected &&
      navigator.onLine &&
      navigator.locks &&
      !run?.unsavedOutputs && !exporting && !unresolved && (mode === "STRICT" || referenceConsent),
    ),
    completed = run?.items.filter((i) => i.status === "READY") ?? [];
  async function upload(file: File) {
    if (running.current || !ready) return;
    if (!file.size || file.size > 20 * 1024 * 1024) {
      setError("Choose an image up to 20 MiB.");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    active.current = controller;
    try {
      await runAutomatic(file, controller.signal, setRun, { mode, additionalReferences: mode === "REFERENCE" ? additionalReferences : [] });
      const rows = await listAutoRuns();
      setHistory(rows);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The upload could not be processed.",
      );
    } finally {
      running.current = false;
      active.current = null;
      setBusy(false);
    }
  }
  async function all() {
    if (!run || !completed.length || exportLock.current) return;
    exportLock.current=true; setExporting(true);
    setError("");
    try {
      const writer = new ZipWriter(new BlobWriter("application/zip"));
      try {
        for (const item of completed)
          await writer.add(
            `${item.style}.png`,
            new BlobReader(await checkedOutput(item)),
          );
        await writer.add(
          "image-information.json",
          new TextReader(
            JSON.stringify(
              {
                version: 1,
                runId: run.id,
                createdAt: run.createdAt,
                sourceSha256: run.sourceSha256,
                mode: run.mode ?? "STRICT",
                referenceImages: run.referenceImages,
                sourceCapabilities: run.capabilities,
                maskMethod: run.foreground?.method,
                validation: "AUTOMATIC_TECHNICAL_CHECKS_ONLY",
                humanApproval: false,
                limitations:
                  run.mode === "REFERENCE" ? "Reference-guided concepts can alter product geometry, labels and branding. The visible detail output is a local source crop. Technical integrity checks only; visual quality and brand accuracy are NOT_ASSESSED." : "Original foreground pixels are selected and resized locally. Automatic masks and resampling may alter details. Technical integrity checks only; visual quality and brand accuracy are NOT_ASSESSED.",
                images: completed.map((i) => ({
                  style: i.style,
                  sha256: i.sha256,
                  attemptId: i.id,
                  prompt: i.prompt,
                  estimatedUSD: i.estimatedUSD,
                  qa: i.qa,
                  provenance: i.provenance ?? { mode: "STRICT", operation: "legacy-composite", visualAssessment: "NOT_ASSESSED" },
                })),
              },
              null,
              2,
            ),
          ),
        );
        download(
          await writer.close(),
          `product-images-${run.id.slice(0, 8)}.zip`,
        );
      } catch (e) {
        await writer.close().catch(() => {});
        throw e;
      }
    } catch {
      setError(
        "The download could not be prepared. Your saved images have not been deleted.",
      );
    }
    finally { exportLock.current=false; setExporting(false); }
  }
  return (
    <>
      <div className="eyebrow">UPLOAD. CREATE. DOWNLOAD.</div>
      <div className="page-heading">
        <div>
          <h1>{t("One product. Seven looks.")}</h1>
          <p className="lead">{t("Upload your product photo. Get complete images, ready to download.")}</p>
        </div>
      </div>
      {!connected || !session ? (
        <section className="auto-setup">
          <h2>{t("Set up this session")}</h2>
          <p>
            Add your OpenAI key and set a spending estimate limit once for this
            tab. Then uploading a photo starts processing automatically.
          </p>
          <Link className="primary-button" to="/settings">
            Set up key &amp; budget
          </Link>
        </section>
      ) : (
        <p className="muted">
          Seven outputs · six paid requests + one local detail crop · estimated ${estimate} USD · session estimate
          remaining ${((session.limit - session.reserved) / 1e6).toFixed(6)} ·{" "}
          <Link to="/settings">{t("Session settings")}</Link>
        </p>
      )}
      {!busy && <section className="automatic-options" aria-label="Image mode">
        <div className="automatic-mode-options">
          <label className="checkbox-label"><Input type="radio" name="automatic-mode" checked={mode === "STRICT"} onChange={() => { setMode("STRICT"); setReferenceTransmissionConsent(false); setAdditionalReferences([]); }} /><span>STRICT · photos stay local</span></label>
          <label className="checkbox-label"><Input type="radio" name="automatic-mode" checked={mode === "REFERENCE"} onChange={() => setMode("REFERENCE")} /><span>Reference-guided · AI edits</span></label>
        </div>
        {mode === "STRICT" ? <Disclosure><DisclosureSummary>How STRICT works</DisclosureSummary><p>Original foreground pixels are selected and placed locally over generated surroundings. Camera angle stays as supplied; selection and resizing can affect fine details. Tabletop does not invent an overhead view. Visual quality and brand fidelity are not assessed automatically.</p></Disclosure> : <>
          <p className="muted">Reference-guided concepts can change labels, logos and geometry. Faithful unseen views are not promised.</p>
          <label className="checkbox-label"><Input type="checkbox" checked={referenceConsent} onChange={e => setReferenceTransmissionConsent(e.target.checked)} /><span>I authorize sending resized, metadata-stripped copies of my product photos directly to OpenAI for this tab, separate from spending consent.</span></label>
          <Disclosure><DisclosureSummary>Additional views &amp; estimate details ({additionalReferences.length} of 2)</DisclosureSummary>
            <label htmlFor="additional-reference-images">Optional additional views · up to two images</label>
            <Input id="additional-reference-images" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length > 2 || files.some(f => !f.size || f.size > 20 * 1024 * 1024)) { setError("Choose up to two additional reference images, each up to 20 MiB."); return; } setAdditionalReferences(files); }} />
            {additionalReferences.length > 0 && <><ul>{additionalReferences.map((file, index) => <li key={index}>{file.name}</li>)}</ul><Button type="button" className="secondary-button" onClick={() => setAdditionalReferences([])}>Clear additional views</Button></>}
            <p className="muted">Each reference becomes a PNG up to 1024 px per edge. Additional views are evidence, not proof of faithful hidden geometry. Filenames stay local.</p>
            <p className="muted">Estimate ${estimate} USD includes {1 + additionalReferences.length} reference image(s) per paid request, assuming 8,192 image-input tokens per image and 196 output tokens. These are planning assumptions; actual usage can differ. This is not an invoice or hard cap.</p>
          </Disclosure>
        </>}
      </section>}
      <section
        className={`auto-upload ${busy ? "processing" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length === 1)
            void upload(e.dataTransfer.files[0]);
          else setError("Upload one product image at a time.");
        }}
        aria-label="Upload product image"
      >
        <span className="upload-symbol"><Icon name="upload"/></span><span className="section-kicker">{mode === "STRICT" ? "YOUR ORIGINAL STAYS LOCAL" : "REFERENCE COPIES GO TO OPENAI"}</span>
        <h2>{busy ? t("Making your images…") : t("Drop your product photo here")}</h2>
        <p>
          {busy
            ? run?.state === "PREPARING"
              ? (run.message ?? "Preparing your product…")
              : "Keep this tab open. Finished images appear below and can be downloaded immediately."
            : unresolved ? "Review the interrupted request in Settings before uploading again." : "PNG, JPEG or WebP · up to 20 MiB · one product per photo"}
        </p>
        {!busy && (
          <label
            className={`primary-button auto-file ${!ready ? "disabled" : ""}`}
          >{t("Upload image")}<Input
              aria-label="Upload product image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!ready}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        )}
        {busy && mode === "REFERENCE" && <label className="checkbox-label"><Input type="checkbox" checked={referenceConsent} onChange={e => setReferenceTransmissionConsent(e.target.checked)} /><span>Allow reference transmission · uncheck to stop further image sends</span></label>}
        {!navigator.onLine && (
          <p role="status">
            You are offline. Saved images remain available; generation needs an
            internet connection.
          </p>
        )}
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {run && (
        <section
          className="auto-results"
          aria-labelledby="auto-results-heading"
        >
          <div className="section-heading">
            <div>
              <span className="section-kicker">YOUR IMAGES</span>
              <h2 id="auto-results-heading" aria-live="polite">{t("{count} of 7 ready",{count:completed.length})}</h2>
            </div>
            <Button
              className="primary-button"
              type="button"
              disabled={!completed.length || exporting}
              onClick={() => void all()}
            >
              {exporting ? t("Preparing download…") : completed.length === 7 ? t("Download all") : !completed.length ? t("Download images") : completed.length === 1 ? t("Download 1 image") : t("Download {count} images",{count:completed.length})}
            </Button>
          </div>
          {run.unsavedOutputs && (
            <p role="alert">
              These finished images are only in this tab’s memory. Download them
              before leaving.{" "}
              <Button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (
                    window.confirm(
                      "These images could not be saved locally. Have you downloaded everything you need? Starting another upload discards the in-memory results.",
                    )
                  )
                    setRun(null);
                }}
              >
                Start another upload
              </Button>
            </p>
          )}
          {(run.state === "STOPPED" || (!busy && run.items.some(i=>(i.status==="UNKNOWN"||i.status==="SUBMITTED")&&!i.reviewedAt))) && (
            <ErrorNotice title={t(run.message?.includes('(401)') ? "API key issue" : "Generation stopped")}>
              <p>{run.message ?? "An earlier request was interrupted. Review its outcome before starting again."}</p>
              <p>{completed.length ? 'Finished images are kept below.' : 'No images were completed.'} No request is retried automatically.</p>
              {run.items.some(i=>(i.status==='UNKNOWN'||i.status==='SUBMITTED')&&!i.reviewedAt) && <p>The interrupted request may have been charged. Check provider billing before authorizing another upload.</p>}
              <Link className="secondary-button" to="/settings">{t("Open Settings")}</Link>
            </ErrorNotice>
          )}
          {busy && <Progress value={completed.length} label={`${completed.length} of 7 images ready`}/>}
          <div className="auto-results-grid">
            {run.items.map((item) => (
              <ResultCard key={item.id} item={item} processing={busy} showError={run.state!=="STOPPED"} onError={setError} />
            ))}
          </div>
          <p className="muted">{run.mode === "REFERENCE" ? "Reference-guided concepts may change product details, labels and geometry. The detail output is a local visible source crop. " : "Made with selected original product pixels and generated surroundings. Automatic selection and resizing can affect fine details. "}Technical checks verify integrity and image format. Visual quality, product fidelity, lighting and contact are not assessed; these images are not human-reviewed. Tabletop keeps the source viewpoint. Billboard is a local display mockup.</p>
        </section>
      )}
      <Disclosure className="auto-secondary">
        <DisclosureSummary>Previous uploads &amp; image information</DisclosureSummary>
        {history.map((row) => (
          <Button
            key={row.id}
            type="button"
            className="secondary-button"
            disabled={busy || exporting || Boolean(run?.unsavedOutputs)}
            onClick={() => setRun(row)}
          >
            {new Date(row.createdAt).toLocaleString()} ·{" "}
            {row.items.filter((i) => i.status === "READY").length}/7 · {row.mode === "REFERENCE" ? "Reference concepts" : "STRICT"}
          </Button>
        ))}
        {run && (
          <Button
            type="button"
            className="secondary-button"
            onClick={() => download(run.source, run.filename)}
          >
            Download original
          </Button>
        )}
        <p>
          Cutout and the visible detail crop run on this device. STRICT sends only scene instructions; Reference-guided sends up to three prepared image copies after separate tab consent. Original files and additional-view filenames are never sent. Estimates reserve local budget, not provider charges or hard account limits.
        </p>
        <Link to="/workspace">Advanced workspace and existing projects</Link>
      </Disclosure>
    </>
  );
}
