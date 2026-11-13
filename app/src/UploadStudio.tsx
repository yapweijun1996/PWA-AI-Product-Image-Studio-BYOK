import { automaticErrorCode } from "./automaticErrors";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AutomaticMode } from "../automatic-policy.mjs";
import {
  Button,
  Input,
  Progress,
  ErrorNotice,
  Disclosure,
  DisclosureSummary,
} from "./ui/components";
import { Icon } from "./ui/Icon";
import { t } from "./ui/i18n";
import {
  automaticPlan,
  runAutomatic,
  regenerateAutomatic,
} from "./automaticPipeline";
import { AutomaticUsage } from "./AutomaticUsage";
import { AutomaticResults, SubjectChoices } from "./AutomaticResults";
import { automaticSessionStatus } from "./automaticSession";
import {
  browserKeyStatus,
  onBrowserKeyChange,
  referenceTransmissionAllowed,
  setReferenceTransmissionConsent,
  onReferenceConsentChange,
} from "./browserByok";
import {
  listAutoRuns,
  runHasUnreviewedCharge,
  type AutoRun,
  type AutoItem,
} from "./automaticStore";
import { usableItem, needsAttention } from "./automaticQuality";
import { automaticArchive } from "./automaticExport";
import { downloadAutomatic } from "./automaticPresentation";
import { useUnsavedChanges } from "./useUnsavedChanges";
export function UploadStudio() {
  const [params] = useSearchParams(),
    selected = params.get("run");
  const [run, setRun] = useState<AutoRun | null>(null),
    [history, setHistory] = useState<AutoRun[]>([]),
    [mode, setMode] = useState<AutomaticMode>("STRICT"),
    [referenceConsent, setConsent] = useState(referenceTransmissionAllowed),
    [additional, setAdditional] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [regenerating, setRegenerating] = useState<AutoItem["style"]>(),
    [error, setError] = useState(""),
    [setupOpen, setSetupOpen] = useState(false),
    [session, setSession] = useState(automaticSessionStatus),
    [connected, setConnected] = useState(browserKeyStatus().connected);
  const active = useRef<AbortController | null>(null),
    working = useRef(false),
    exportLock = useRef(false),
    choice = useRef<((id: string) => void) | null>(null);
  useUnsavedChanges(
    busy || Boolean(regenerating) || exporting || Boolean(run?.unsavedOutputs),
  );
  useEffect(() => {
    let alive = true;
    void listAutoRuns()
      .then((rows) => {
        if (alive) {
          setHistory(rows);
          setRun(rows.find((r) => r.id === selected) ?? rows[0] ?? null);
        }
      })
      .catch((e) => {
        if (alive) setError(automaticErrorCode(e, "HISTORY_UNAVAILABLE"));
      });
    const refresh = () => {
      setSession(automaticSessionStatus());
      setConnected(browserKeyStatus().connected);
      setConsent(referenceTransmissionAllowed());
    };
    const stop = onBrowserKeyChange(refresh),
      stopReference = onReferenceConsentChange(refresh);
    refresh();
    window.addEventListener("studio-auto-usage", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      alive = false;
      stop();
      stopReference();
      window.removeEventListener("studio-auto-usage", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (selected && !busy && !exporting && !run?.unsavedOutputs) {
      const saved = history.find((r) => r.id === selected);
      if (saved) setRun(saved);
    }
  }, [selected, history]);
  const estimate = automaticPlan(mode).estimatedUSD,
    ready = Boolean(
      session &&
      connected &&
      navigator.onLine &&
      navigator.locks &&
      !run?.unsavedOutputs &&
      !exporting &&
      (mode === "STRICT" || referenceConsent),
    );
  const completed = run?.items.filter(usableItem) ?? [],
    unavailable =
      run?.items.filter(
        (i) => !usableItem(i) && !["PENDING", "SUBMITTED"].includes(i.status),
      ).length ?? 0,
    attention = completed.filter(needsAttention).length;
  async function upload(file: File) {
    if (working.current || !ready) return;
    working.current = true;
    setBusy(true);
    setError("");
    setSetupOpen(false);
    const controller = new AbortController();
    active.current = controller;
    try {
      await runAutomatic(file, controller.signal, setRun, {
        mode,
        additionalReferences: mode === "REFERENCE" ? additional : [],
        selectSubject: () =>
          new Promise<string>((resolve, reject) => {
            const abort = () => {
              choice.current = null;
              reject(new DOMException("REQUEST_STOPPED", "AbortError"));
            };
            controller.signal.addEventListener("abort", abort, { once: true });
            choice.current = (id) => {
              choice.current = null;
              controller.signal.removeEventListener("abort", abort);
              resolve(id);
            };
          }),
      });
      setHistory(await listAutoRuns());
    } catch (e) {
      setError(automaticErrorCode(e));
    } finally {
      working.current = false;
      active.current = null;
      setBusy(false);
    }
  }
  async function regenerate(style: AutoItem["style"]) {
    if (!run || working.current || run.unsavedOutputs) return;
    working.current = true;
    setRegenerating(style);
    setError("");
    const controller = new AbortController();
    active.current = controller;
    try {
      await regenerateAutomatic(run.id, style, controller.signal, setRun);
      setHistory(await listAutoRuns());
    } catch (e) {
      throw e;
    } finally {
      working.current = false;
      active.current = null;
      setRegenerating(undefined);
    }
  }
  async function all() {
    if (!run || !completed.length || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try {
      downloadAutomatic(
        await automaticArchive(run),
        `product-images-${run.id.slice(0, 8)}.zip`,
      );
    } catch {
      setError("OUTPUT_INTEGRITY_FAILED");
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }
  const showSetup = !run || setupOpen;
  return (
    <>
      <div className={`page-heading ${run ? "completed-heading" : ""}`}>
        <div>
          {!run && <div className="eyebrow">{t("PRODUCT IMAGE STUDIO")}</div>}
          <h1>{t(run ? "Your images" : "One product. Distinct looks.")}</h1>
          {!run && (
            <p className="lead">
              {t(
                "Create product images from your photo, then inspect each look.",
              )}
            </p>
          )}
        </div>
      </div>
      <div className="create-context">
        <AutomaticUsage compact={Boolean(run)} />
        {session && connected && (
          <Link to="/settings" aria-label={t("Usage & key settings")}>
            {t(run ? "Details" : "Usage & key settings")}
          </Link>
        )}
      </div>
      {!connected || !session ? (
        <section className="auto-setup">
          <h2>{t("Connect once, then upload")}</h2>
          <p>
            {t(
              "Save your OpenAI key and allow future uploads once. An optional monthly limit is available in Settings.",
            )}
          </p>
          <Link className="primary-button" to="/settings">
            {t("Set up key")}
          </Link>
        </section>
      ) : null}
      {run && !busy && (
        <div className="source-bar">
          <span title={run.filename}>
            <strong>{t("Source")}</strong> · {run.filename}
          </span>
          <Button
            type="button"
            className="secondary-button"
            disabled={
              exporting || Boolean(run.unsavedOutputs) || Boolean(regenerating)
            }
            onClick={() => setSetupOpen((value) => !value)}
          >
            {t(setupOpen ? "Hide upload controls" : "Upload another")}
          </Button>
        </div>
      )}
      {showSetup && !busy && (
        <section className="automatic-options" aria-label={t("Image mode")}>
          <div className="automatic-mode-options">
            <label className="checkbox-label">
              <Input
                type="radio"
                name="automatic-mode"
                checked={mode === "STRICT"}
                onChange={() => {
                  setMode("STRICT");
                  setReferenceTransmissionConsent(false);
                  setAdditional([]);
                }}
              />
              <span>{t("STRICT · photos stay local")}</span>
            </label>
            <label className="checkbox-label">
              <Input
                type="radio"
                name="automatic-mode"
                checked={mode === "REFERENCE"}
                onChange={() => setMode("REFERENCE")}
              />
              <span>{t("Reference-guided · analyzed source")}</span>
            </label>
          </div>
          {mode === "STRICT" ? (
            <Disclosure>
              <DisclosureSummary>{t("How STRICT works")}</DisclosureSummary>
              <p>
                {t(
                  "Only scene instructions leave this device. Local selection cannot understand product semantics; uncertain selections stop before payment. Detail is available only for a reliable visible local crop.",
                )}
              </p>
            </Disclosure>
          ) : (
            <>
              <p className="muted">
                {t(
                  "Reference-guided concepts can change labels, logos and geometry. Faithful unseen views are not promised.",
                )}
              </p>
              <label className="checkbox-label">
                <Input
                  type="checkbox"
                  checked={referenceConsent}
                  onChange={(e) =>
                    setReferenceTransmissionConsent(e.target.checked)
                  }
                />
                <span>
                  {t(
                    "I allow OpenAI source analysis, cropped-reference image edits and output review in this tab.",
                  )}
                </span>
              </label>
              <p className="muted">
                {t(
                  "Up to 6 image requests and 2 auxiliary calls per upload. Estimated ${amount} USD.",
                  { amount: estimate },
                )}
              </p>
              <Disclosure>
                <DisclosureSummary>
                  {t("Additional views & estimate details")}
                </DisclosureSummary>
                <label htmlFor="additional-reference-images">
                  {t("Optional additional views · up to two images")}
                </label>
                <Input
                  id="additional-reference-images"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (
                      files.length > 2 ||
                      files.some((f) => !f.size || f.size > 20 * 1024 * 1024)
                    ) {
                      setError("INVALID_REFERENCE_COUNT");
                      return;
                    }
                    setAdditional(files);
                  }}
                />
                {additional.map((file, index) => (
                  <p key={index}>{file.name}</p>
                ))}
                {additional.length > 0 && (
                  <Button
                    type="button"
                    className="text-link"
                    onClick={() => setAdditional([])}
                  >
                    {t("Clear additional views")}
                  </Button>
                )}
                <p>
                  {t(
                    "Estimates reserve up to 3 cropped references per image request and a batch review of up to 9 small images. Token counts are conservative assumptions, not an invoice or spending cap.",
                  )}
                </p>
                <p>
                  {t(
                    "Normalized subject crops stay in local history for comparison and new versions. Additional raw original files remain in this tab. Image ZIPs contain hashes and coordinates, not reference image data.",
                  )}
                </p>
              </Disclosure>
            </>
          )}
          {mode === "STRICT" && (
            <p className="muted">
              {t(
                "Up to 6 image requests, no auxiliary calls. Estimated ${amount} USD.",
                { amount: estimate },
              )}
            </p>
          )}
        </section>
      )}
      {(showSetup || busy) && !run?.selectionCandidates && (
        <section
          className={`auto-upload ${busy ? "processing" : ""}`}
          aria-label={t("Upload product image")}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length === 1)
              void upload(e.dataTransfer.files[0]);
            else setError("INVALID_REFERENCE_COUNT");
          }}
        >
          <span className="upload-symbol">
            <Icon name="upload" />
          </span>
          <h2>
            {t(busy ? "Creating your looks…" : "Drop your product photo here")}
          </h2>
          <p>
            {t(
              busy
                ? (run?.message ?? "PROCESSING_OUTPUTS")
                : "PNG, JPEG or WebP · up to 20 MiB",
            )}
          </p>
          {!busy && (
            <label
              className={`primary-button auto-file ${!ready ? "disabled" : ""}`}
            >
              {t("Upload image")}
              <Input
                type="file"
                aria-label={t("Upload product image")}
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
          {busy && (
            <Button
              type="button"
              className="text-link"
              onClick={() => active.current?.abort()}
            >
              {t("Stop generation")}
            </Button>
          )}
          {busy && mode === "REFERENCE" && (
            <label className="checkbox-label">
              <Input
                type="checkbox"
                checked={referenceConsent}
                onChange={(e) =>
                  setReferenceTransmissionConsent(e.target.checked)
                }
              />
              <span>
                {t("Allow image transmission · uncheck to stop further sends")}
              </span>
            </label>
          )}
          {!navigator.onLine && (
            <p role="status">
              {t(
                "Offline. Saved images remain available; generation needs a connection.",
              )}
            </p>
          )}
        </section>
      )}
      {run?.selectionCandidates && (
        <SubjectChoices
          candidates={run.selectionCandidates}
          onChoose={(id) => choice.current?.(id)}
        />
      )}
      {error && (
        <ErrorNotice title={t("Needs attention")}>{t(error)}</ErrorNotice>
      )}
      {run && (
        <section
          className="auto-results"
          aria-labelledby="auto-results-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="auto-results-heading" aria-live="polite">
                {t("{count} downloadable", { count: completed.length })}
              </h2>
              <p className="muted">
                {t(
                  run.mode === "REFERENCE" &&
                    run.qualityStatus !== "MACHINE_HINTS_AVAILABLE" &&
                    !busy
                    ? "{unavailable} unavailable · visual review not assessed"
                    : "{attention} check suggested · {unavailable} unavailable",
                  { attention, unavailable },
                )}
              </p>
            </div>
            <Button
              type="button"
              className="primary-button"
              disabled={!completed.length || exporting}
              onClick={() => void all()}
            >
              {t(exporting ? "Preparing download…" : "Download available")}
            </Button>
          </div>
          {run.unsavedOutputs && (
            <ErrorNotice title={t("LOCAL_SAVE_FAILED")}>
              <p>
                {t(
                  "Keep this tab open and download the available images before leaving.",
                )}
              </p>
              <Button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (
                    window.confirm(
                      t(
                        "Have you downloaded the images you need? Discard the unsaved results to start again?",
                      ),
                    )
                  )
                    setRun(null);
                }}
              >
                {t("Start another upload")}
              </Button>
            </ErrorNotice>
          )}
          {(run.state === "STOPPED" ||
            (!busy && runHasUnreviewedCharge(run))) && (
            <ErrorNotice
              title={t(
                runHasUnreviewedCharge(run)
                  ? "Request interrupted"
                  : "Generation stopped",
              )}
            >
              <p>
                {t(
                  runHasUnreviewedCharge(run) ||
                    run.message === "BILLING_REVIEW_REQUIRED"
                    ? "REQUEST_UNKNOWN"
                    : (run.message ?? "REQUEST_UNKNOWN"),
                )}
              </p>
              {completed.length > 0 && (
                <p>{t("Available images are kept.")}</p>
              )}
            </ErrorNotice>
          )}
          {busy && (
            <Progress
              value={
                run.items.filter(
                  (i) => !["PENDING", "SUBMITTED"].includes(i.status),
                ).length
              }
              label={t("Processing {count} of 7 styles", {
                count: run.items.filter(
                  (i) => !["PENDING", "SUBMITTED"].includes(i.status),
                ).length,
              })}
            />
          )}
          {run.mode === "REFERENCE" &&
            !busy &&
            run.qualityStatus !== "MACHINE_HINTS_AVAILABLE" &&
            completed.length > 0 && (
              <p className="gallery-quality-note" role="status">
                {t(
                  run.auxiliary?.find((a) => a.kind === "output-review")
                    ?.error === "OUTPUT_REVIEW_INVALID"
                    ? "OUTPUT_REVIEW_INVALID"
                    : run.auxiliary?.find((a) => a.kind === "output-review")
                          ?.error === "QUALITY_UNAVAILABLE"
                      ? "QUALITY_UNAVAILABLE"
                      : "Visual quality not assessed. Technical checks are not brand approval.",
                )}
              </p>
            )}
          {run.mode === "REFERENCE" &&
            !busy &&
            run.qualityStatus === "MACHINE_HINTS_AVAILABLE" && (
              <p className="gallery-quality-note">
                {t(
                  "{count} generated images have machine hints; other images are unassessed.",
                  {
                    count: run.items.filter(
                      (i) => i.semantic && i.semantic.outputSha256 === i.sha256,
                    ).length,
                  },
                )}
              </p>
            )}
          <AutomaticResults
            run={run}
            busy={busy}
            onError={setError}
            onRegenerate={regenerate}
            regenerating={regenerating}
          />
          <p className="muted gallery-caveat">
            {t(
              run.mode === "REFERENCE"
                ? "Reference concepts can change product details. Machine hints are not human approval. Inspect the source comparison."
                : "Original pixels are selected locally. Technical integrity checks do not assess visual quality or certify branding.",
            )}
          </p>
        </section>
      )}
      <Disclosure className="auto-secondary">
        <DisclosureSummary>
          {t("Previous uploads & image information")}
        </DisclosureSummary>
        {history.map((row) => (
          <Button
            key={row.id}
            type="button"
            className="secondary-button"
            disabled={
              busy ||
              exporting ||
              Boolean(regenerating) ||
              Boolean(run?.unsavedOutputs)
            }
            onClick={() => {
              setRun(row);
              setSetupOpen(false);
            }}
          >
            {new Date(row.createdAt).toLocaleString()} ·{" "}
            {t("{count} downloadable", {
              count: row.items.filter(usableItem).length,
            })}{" "}
            · {t(row.mode === "REFERENCE" ? "Reference concepts" : "STRICT")}
          </Button>
        ))}
        {run && (
          <Button
            type="button"
            className="secondary-button"
            onClick={() => downloadAutomatic(run.source, run.filename)}
          >
            {t("Download original")}
          </Button>
        )}
        <p>
          {t(
            "Original files stay local. Reference analysis sends normalized copies with your tab consent; selected crops remain in local history. Estimates are local records, not your OpenAI bill.",
          )}
        </p>
        <Link to="/workspace">
          {t("Advanced workspace and existing projects")}
        </Link>
      </Disclosure>
    </>
  );
}
