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
import { browserKeyStatus, onBrowserKeyChange } from "./browserByok";
import {
  checkedOutput,
  listAutoRuns,
  type AutoRun,
  type AutoItem,
} from "./automaticStore";
import { useUnsavedChanges } from "./useUnsavedChanges";
const labels = {
  studio: "Studio",
  hero: "Hero",
  lifestyle: "Lifestyle",
  flat_lay: "Flat lay",
  macro: "Detail",
  ugc: "Everyday",
  billboard: "Billboard",
};
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
      aria-label={`${labels[item.style]} result`}
      aria-busy={processing && item.status === "SUBMITTED"}
    >
      <div className="auto-result-image">
        {url && item.status === "READY" ? (
          <img src={url} alt={`${labels[item.style]} product composition`} />
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
        <h3>{labels[item.style]}</h3>
        {item.status === "READY" && (
          <Button
            type="button"
            className="secondary-button"
            disabled={downloading}
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
      {item.error && (showError ? <p className="muted">{item.error}</p> : <Disclosure className="result-details"><DisclosureSummary>Image details</DisclosureSummary><p>{item.error}</p></Disclosure>)}
    </article>
  );
}
export function UploadStudio() {
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
    };
    const stop = onBrowserKeyChange(refresh);
    window.addEventListener("studio-auto-session", refresh);
    window.addEventListener("online", refresh);window.addEventListener("offline", refresh);
    return () => {
      mounted = false;
      stop();
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
  const estimate = automaticPlan().estimatedUSD,
    ready = Boolean(
      session &&
      connected &&
      navigator.onLine &&
      navigator.locks &&
      !run?.unsavedOutputs && !exporting && !unresolved,
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
      await runAutomatic(file, controller.signal, setRun);
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
                maskMethod: run.foreground?.method,
                validation: "AUTOMATIC_TECHNICAL_CHECKS_ONLY",
                humanApproval: false,
                limitations:
                  "Automatic masks and resampling may alter details. No claim of verified brand accuracy.",
                images: completed.map((i) => ({
                  style: i.style,
                  sha256: i.sha256,
                  attemptId: i.id,
                  prompt: i.prompt,
                  estimatedUSD: i.estimatedUSD,
                  qa: i.qa,
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
          Seven images per upload · estimated ${estimate} USD · session estimate
          remaining ${((session.limit - session.reserved) / 1e6).toFixed(6)} ·{" "}
          <Link to="/settings">{t("Session settings")}</Link>
        </p>
      )}
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
        <span className="upload-symbol"><Icon name="upload"/></span><span className="section-kicker">YOUR ORIGINAL STAYS LOCAL</span>
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
          <p className="muted">
            Made with your original product pixels and generated surroundings.
            Automatic selection and resizing can affect fine details; these
            images are not human-reviewed. Flat lay and detail looks keep the
            supplied viewpoint.
          </p>
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
            {row.items.filter((i) => i.status === "READY").length}/7
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
          Automatic image tools are bundled with the app. Processing stays on
          your device. Images and keys are not uploaded for cutout; generation
          sends only scene instructions. Estimates are local reservations, not
          provider charges or hard account limits.
        </p>
        <Link to="/workspace">Advanced workspace and existing projects</Link>
      </Disclosure>
    </>
  );
}
