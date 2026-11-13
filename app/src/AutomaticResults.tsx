import { automaticErrorCode } from "./automaticErrors";
import { useEffect, useRef, useState } from "react";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { automaticEstimateUSD } from "../automatic-policy.mjs";
import { VISION_MODEL } from "../vision-policy.mjs";
import {
  STUDIO_MODEL,
  STUDIO_QUALITY,
  STUDIO_SIZE,
} from "../studio-policy.mjs";
import {
  Dialog,
  Button,
  Input,
  Select,
  Disclosure,
  DisclosureSummary,
  ImagePlaceholder,
  StatusBadge,
  ErrorNotice,
} from "./ui/components";
import { t } from "./ui/i18n";
import {
  checkedOutput,
  runHasUnreviewedCharge,
  type AutoRun,
  type AutoItem,
} from "./automaticStore";
import { needsAttention, usableItem } from "./automaticQuality";
import { mountAutomaticBillboard } from "./autoImaging";
import {
  resultLabel,
  imageFilename,
  downloadAutomatic,
  campaignCopy,
} from "./automaticPresentation";
import { sha256 } from "./prepareSource";
import {
  referenceTransmissionAllowed,
  setReferenceTransmissionConsent,
  onReferenceConsentChange,
} from "./browserByok";
function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
function ResultCard({
  item,
  busy,
  onOpen,
  onError,
}: {
  item: AutoItem;
  busy: boolean;
  onOpen: () => void;
  onError: (message: string) => void;
}) {
  const url = useBlobUrl(item.output),
    [downloading, setDownloading] = useState(false),
    lock = useRef(false),
    ready = usableItem(item);
  return (
    <article
      className="auto-result gallery-card"
      aria-label={t("{style} result", { style: resultLabel(item) })}
      aria-busy={busy && item.status === "SUBMITTED"}
    >
      <Button
        type="button"
        className="gallery-open"
        aria-label={t("Preview {style}", { style: resultLabel(item) })}
        onClick={onOpen}
      >
        {ready && url ? (
          <img src={url} alt={resultLabel(item)} />
        ) : (
          <ImagePlaceholder
            active={busy && item.status === "SUBMITTED"}
            label={t(
              item.status === "PENDING"
                ? "Queued"
                : item.status === "SUBMITTED"
                  ? "Creating…"
                  : "Unavailable",
            )}
          />
        )}
      </Button>
      <div className="gallery-caption">
        <div>
          <h3>{resultLabel(item)}</h3>
          {needsAttention(item) && (
            <StatusBadge tone="warning">{t("Check suggested")}</StatusBadge>
          )}
          {!ready && item.status !== "PENDING" && (
            <StatusBadge tone="neutral">
              {t(item.status === "UNKNOWN" ? "Outcome unknown" : "Unavailable")}
            </StatusBadge>
          )}
        </div>
        <div className="gallery-actions">
          <Button type="button" className="text-link" onClick={onOpen}>
            {t("Preview")}
          </Button>
          {ready && (
            <Button
              type="button"
              className="secondary-button"
              aria-label={t("Download {style}", { style: resultLabel(item) })}
              disabled={downloading}
              onClick={() => {
                if (lock.current) return;
                lock.current = true;
                setDownloading(true);
                void checkedOutput(item)
                  .then((blob) => downloadAutomatic(blob, imageFilename(item)))
                  .catch(() => onError("OUTPUT_INTEGRITY_FAILED"))
                  .finally(() => {
                    lock.current = false;
                    setDownloading(false);
                  });
              }}
            >
              {t("Download")}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
export function AutomaticResults({
  run,
  busy,
  onError,
  onRegenerate,
  regenerating,
}: {
  run: AutoRun;
  busy: boolean;
  onError: (message: string) => void;
  onRegenerate: (style: AutoItem["style"]) => Promise<void>;
  regenerating?: AutoItem["style"];
}) {
  const [selected, setSelected] = useState<AutoItem["style"] | null>(null),
    item = run.items.find((i) => i.style === selected);
  return (
    <>
      <div className="auto-results-grid result-gallery-grid">
        {run.items.map((item) => (
          <ResultCard
            key={item.style}
            item={item}
            busy={busy}
            onOpen={() => setSelected(item.style)}
            onError={onError}
          />
        ))}
      </div>
      {item && (
        <ImagePreview
          run={run}
          item={item}
          onClose={() => setSelected(null)}
          onRegenerate={onRegenerate}
          busy={busy || Boolean(regenerating)}
          regenerating={regenerating === item.style}
        />
      )}
    </>
  );
}
function ImagePreview({
  run,
  item,
  onClose,
  onRegenerate,
  busy,
  regenerating,
}: {
  run: AutoRun;
  item: AutoItem;
  onClose: () => void;
  onRegenerate: (style: AutoItem["style"]) => Promise<void>;
  busy: boolean;
  regenerating: boolean;
}) {
  const [version, setVersion] = useState(item.id),
    [compare, setCompare] = useState(false),
    [sourceChoice, setSourceChoice] = useState("original"),
    [zoom, setZoom] = useState(1),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [billboard, setBillboard] = useState<Blob>(),
    [copy, setCopy] = useState<Blob>(),
    [brand, setBrand] = useState(""),
    [headline, setHeadline] = useState(""),
    [working, setWorking] = useState(false),
    [appliedCopy, setAppliedCopy] = useState<{
      brand: string;
      headline: string;
      parentAttemptId: string;
      parentOutputSha256: string;
    }>();
  const current = useRef("");
  const [referenceAllowed, setReferenceAllowed] = useState(
    referenceTransmissionAllowed,
  );
  useEffect(
    () =>
      onReferenceConsentChange(() =>
        setReferenceAllowed(referenceTransmissionAllowed()),
      ),
    [],
  );
  useEffect(() => {
    setVersion(item.id);
    setCopy(undefined);
    setBillboard(undefined);
    setConfirm(false);
  }, [item.id]);
  const versions = [item, ...(item.versions ?? [])],
    view = versions.find((v) => v.id === version) ?? item,
    source =
      sourceChoice === "original"
        ? run.source
        : (run.preparedReferences?.[Number(sourceChoice)]?.blob ?? run.source),
    sourceUrl = useBlobUrl(source),
    outputUrl = useBlobUrl(billboard ?? copy ?? view.output);
  current.current = item.id + ":" + view.id;
  const isCampaign =
      view.style === "billboard" && view.provenance?.policyVersion === "2.0.0",
    semantic =
      !copy && !billboard && view.semantic?.outputSha256 === view.sha256
        ? view.semantic
        : undefined;
  const canRegenerate =
    run.pipelineVersion === "2.0.0" &&
    (run.mode !== "REFERENCE" || Boolean(run.preparedReferences?.length)) &&
    (item.style !== "macro" || Boolean(run.detail?.blob));
  const hasUncertainAttempt = !busy && runHasUnreviewedCharge(run);
  const cost = automaticEstimateUSD(
    item.style,
    run.mode,
    run.mode === "REFERENCE" ? 3 : 1,
  );
  async function download() {
    setWorking(true);
    try {
      if (billboard || copy) {
        const output = billboard ?? copy!,
          writer = new ZipWriter(new BlobWriter("application/zip"));
        await writer.add("campaign-variant.png", new BlobReader(output));
        await writer.add(
          "variant-information.json",
          new TextReader(
            JSON.stringify(
              {
                version: 1,
                parentAttemptId: view.id,
                parentOutputSha256: view.sha256,
                outputSha256: await sha256(
                  new Uint8Array(await output.arrayBuffer()),
                ),
                operation: billboard
                  ? "local-billboard-preview"
                  : "user-copy-overlay",
                userProvidedCopy: copy ? appliedCopy : undefined,
                humanApproval: false,
              },
              null,
              2,
            ),
          ),
        );
        downloadAutomatic(await writer.close(), "campaign-variant.zip");
      } else downloadAutomatic(await checkedOutput(view), imageFilename(view));
    } catch (e) {
      setError(automaticErrorCode(e, "OUTPUT_INTEGRITY_FAILED"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <Dialog
      title={resultLabel(view)}
      closeLabel={t("Close preview")}
      onDismiss={onClose}
    >
      <div className="preview-body">
        <div className="preview-toolbar">
          <Button
            type="button"
            className="secondary-button"
            onClick={() => setCompare((value) => !value)}
            aria-pressed={compare}
          >
            {t(compare ? "Hide source" : "Compare source")}
          </Button>
          {compare && Boolean(run.preparedReferences?.length) && (
            <label>
              {t("Comparison source")}
              <Select
                aria-label={t("Comparison source")}
                value={sourceChoice}
                onChange={(e) => setSourceChoice(e.target.value)}
              >
                <option value="original">{t("Original")}</option>
                {(run.preparedReferences ?? []).map((ref, index) => (
                  <option key={ref.sha256} value={String(index)}>
                    {t("Prepared reference {number}", { number: index + 1 })}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label>
            {t("Zoom")}
            <Input
              type="range"
              min="1"
              max="3"
              step=".25"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <Button
            type="button"
            className="text-link"
            onClick={() => setZoom(1)}
          >
            {t("Fit")}
          </Button>
          {usableItem(view) && (
            <Button
              type="button"
              className="primary-button"
              disabled={working}
              onClick={() => void download()}
            >
              {t(billboard || copy ? "Download local variant" : "Download")}
            </Button>
          )}
        </div>
        <div className={`preview-images ${compare ? "comparing" : ""}`}>
          <figure>
            <figcaption>
              {t(
                billboard
                  ? "Local billboard preview"
                  : copy
                    ? "Your copy variant"
                    : "Result",
              )}
            </figcaption>
            <div className="preview-scroll">
              {outputUrl && usableItem(view) ? (
                <img
                  src={outputUrl}
                  alt={resultLabel(view)}
                  style={{
                    width: "auto",
                    maxWidth: "100%",
                    maxHeight: "var(--preview-image-height)",
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                />
              ) : (
                <ImagePlaceholder active={false} label={t("Unavailable")} />
              )}
            </div>
          </figure>
          {compare && (
            <figure className="source-comparison">
              <figcaption>
                {t(sourceChoice === "original" ? "Original" : "Source subject")}
              </figcaption>
              <div className="preview-scroll">
                <img
                  src={sourceUrl}
                  alt={t("Original product reference")}
                  style={{
                    width: "auto",
                    maxWidth: "100%",
                    maxHeight: "var(--preview-image-height)",
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                />
              </div>
            </figure>
          )}
        </div>
        {hasUncertainAttempt && (
          <ErrorNotice title={t("Request interrupted")}>
            <p>{t("REQUEST_UNKNOWN")}</p>
            <p>
              {t(
                "Available images are kept.",
              )}
            </p>
          </ErrorNotice>
        )}
        {error && (
          <ErrorNotice title={t("Needs attention")}>{t(error)}</ErrorNotice>
        )}
        <div className="preview-assessment">
          <StatusBadge tone={needsAttention(view) ? "warning" : "neutral"}>
            {t(
              !usableItem(view)
                ? "Unavailable"
                : needsAttention(view)
                  ? "Check suggested"
                  : "Downloadable",
            )}
          </StatusBadge>
          <p>
            {t(
              run.mode === "REFERENCE"
                ? "Reference-guided concept. Labels, geometry and fine details can change."
                : "Original foreground is selected and resized locally. Fine details can change.",
            )}
          </p>
          {view.error && <p>{t(view.error)}</p>}
          {view.provenance?.detailRoi && (
            <p>
              {t(
                "Visible source crop: {width} × {height} px. Enlargement adds no authentic detail.",
                {
                  width: view.provenance.detailRoi.width,
                  height: view.provenance.detailRoi.height,
                },
              )}
            </p>
          )}
          <p>
            {t(
              semantic
                ? "Machine visual hints only. Check the product against the source."
                : "Visual quality not assessed. Technical checks are not brand approval.",
            )}
          </p>
          {semantic && (
            <ul>
              {(semantic.reasons.length
                ? semantic.reasons
                : [
                    semantic.identity === "conflict"
                      ? "identity_conflict"
                      : semantic.identity === "uncertain" ||
                          semantic.composition === "uncertain"
                        ? "perspective_uncertain"
                        : "NO_VISIBLE_CONFLICT_NOTICED",
                  ]
              ).map((reason) => (
                <li key={reason}>{t(reason)}</li>
              ))}
            </ul>
          )}
          {Boolean(view.similarity?.length) && (
            <p>
              {t(
                "Similar to another look. This is a local warning, not a quality verdict.",
              )}
            </p>
          )}
        </div>
        <Disclosure>
          <DisclosureSummary>
            {t("Source, parameters & history")}
          </DisclosureSummary>
          <p>
            {view.provenance?.operation === "local-detail"
              ? t("Local crop · no provider model or request")
              : t("Model") +
                ": " +
                STUDIO_MODEL +
                " · " +
                t("Quality") +
                ": " +
                STUDIO_QUALITY}{" "}
            · {t("Size")}: {STUDIO_SIZE}
          </p>
          {run.analysis && (
            <p>
              {t("Source analysis model")}: {VISION_MODEL}
            </p>
          )}
          <p>
            {t("Estimated request cost")}: ${view.estimatedUSD} USD
          </p>
          <p>
            {t("Attempt")}: {view.id}
          </p>
          <p>
            {t("Policy version")}:{" "}
            {view.provenance?.policyVersion ?? t("Legacy")}
          </p>
          {run.preparedReferences?.map((ref, index) => (
            <p key={ref.sha256}>
              {t("Reference {number}", { number: index + 1 })}: {ref.width}×
              {ref.height} · {t("Source crop")}: {ref.roi.x},{ref.roi.y},
              {ref.roi.width},{ref.roi.height} · SHA-256{" "}
              {ref.sha256.slice(0, 16)}…
            </p>
          ))}
          {versions.length > 1 && (
            <label>
              {t("Version history")}
              <Select
                aria-label={t("Version history")}
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value);
                  setCopy(undefined);
                  setBillboard(undefined);
                }}
              >
                {versions.map((v, index) => (
                  <option key={v.id} value={v.id}>
                    {t(index === 0 ? "Current result" : "Earlier attempt")} ·{" "}
                    {v.id.slice(0, 8)} ·{" "}
                    {t(
                      v.status === "READY"
                        ? "Downloadable"
                        : v.status === "UNKNOWN"
                          ? "Outcome unknown"
                          : "Unavailable",
                    )}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </Disclosure>
        <Disclosure>
          <DisclosureSummary>{t("Create another version")}</DisclosureSummary>
          {canRegenerate ? (
            <>
              <p>
                {t(
                  item.style === "macro"
                    ? "Recreate the saved local crop. No provider request."
                    : "One new image request. Earlier results are kept. No analysis call or automatic retry.",
                )}
              </p>
              <p>
                {t("Estimated request cost")}: ${cost} USD
              </p>
              {run.mode === "REFERENCE" &&
                item.style !== "macro" &&
                !referenceAllowed && (
                  <label className="checkbox-label">
                    <Input
                      type="checkbox"
                      checked={referenceAllowed}
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
                )}
              {!confirm ? (
                <Button
                  type="button"
                  className="secondary-button"
                  disabled={
                    busy ||
                    (run.mode === "REFERENCE" &&
                      item.style !== "macro" &&
                      !referenceAllowed)
                  }
                  onClick={() => setConfirm(true)}
                >
                  {t("Regenerate this look")}
                </Button>
              ) : (
                <div className="preview-toolbar">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirm(false);
                      void onRegenerate(item.style).catch((e) =>
                        setError(automaticErrorCode(e, "REQUEST_UNKNOWN")),
                      );
                    }}
                  >
                    {t(
                      item.style === "macro"
                        ? "Recreate locally"
                        : "Confirm new paid attempt",
                    )}
                  </Button>
                  <Button
                    type="button"
                    className="text-link"
                    onClick={() => setConfirm(false)}
                  >
                    {t("Cancel")}
                  </Button>
                </div>
              )}
              {regenerating && (
                <p role="status">{t("Creating another version…")}</p>
              )}
            </>
          ) : (
            <p>
              {t(
                item.style === "macro"
                  ? "A reliable detail crop is unavailable. Add a clear close-up in a new upload."
                  : "This legacy result has no frozen safe source plan. Start a new upload to create another version.",
              )}
            </p>
          )}
        </Disclosure>
        {isCampaign && usableItem(view) && (
          <Disclosure>
            <DisclosureSummary>
              {t("Optional local campaign variants")}
            </DisclosureSummary>
            <p>
              {t(
                "Use your own approved copy. No AI-written claims and no extra provider request. The saved campaign stays unchanged.",
              )}
            </p>
            <label>
              {t("Brand (optional)")}
              <Input
                value={brand}
                maxLength={80}
                onChange={(e) => setBrand(e.target.value)}
              />
            </label>
            <label>
              {t("Headline (optional)")}
              <Input
                value={headline}
                maxLength={160}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </label>
            <div className="preview-toolbar">
              <Button
                type="button"
                className="secondary-button"
                disabled={working || (!brand && !headline)}
                onClick={() => {
                  setWorking(true);
                  void checkedOutput(view)
                    .then((base) => campaignCopy(base, brand, headline))
                    .then(
                      (
                        (
                          identity: string,
                          applied: {
                            brand: string;
                            headline: string;
                            parentAttemptId: string;
                            parentOutputSha256: string;
                          },
                        ) =>
                        (blob: Blob) => {
                          if (current.current !== identity) return;
                          setCopy(blob);
                          setAppliedCopy(applied);
                          setBillboard(undefined);
                        }
                      )(current.current, {
                        brand,
                        headline,
                        parentAttemptId: view.id,
                        parentOutputSha256: view.sha256!,
                      }),
                    )
                    .catch((e) =>
                      setError(automaticErrorCode(e, "COPY_NOT_ALLOWED")),
                    )
                    .finally(() => setWorking(false));
                }}
              >
                {t("Preview my copy")}
              </Button>
              <Button
                type="button"
                className="secondary-button"
                disabled={working}
                onClick={() => {
                  setWorking(true);
                  void checkedOutput(view)
                    .then((base) =>
                      mountAutomaticBillboard(
                        copy ?? base,
                        new AbortController().signal,
                      ),
                    )
                    .then(
                      ((identity: string) => (blob: Blob) => {
                        if (current.current === identity) setBillboard(blob);
                      })(current.current),
                    )
                    .catch(() => setError("OUTPUT_UNREADABLE"))
                    .finally(() => setWorking(false));
                }}
              >
                {t("Billboard preview")}
              </Button>
              <Button
                type="button"
                className="text-link"
                onClick={() => {
                  setCopy(undefined);
                  setBillboard(undefined);
                }}
              >
                {t("Show saved campaign")}
              </Button>
            </div>
          </Disclosure>
        )}
      </div>
    </Dialog>
  );
}
export function SubjectChoices({
  candidates,
  onChoose,
}: {
  candidates: { id: string; preview: Blob }[];
  onChoose: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start" });
    ref.current?.querySelector("button")?.focus();
  }, []);
  return (
    <section
      ref={ref}
      className="subject-choices"
      aria-label={t("Choose the product")}
    >
      <h2>{t("Which product should we use?")}</h2>
      <p>
        {t(
          "Choose one photographed subject. No image edit is sent until you choose.",
        )}
      </p>
      <div className="subject-choice-grid">
        {candidates.map((candidate, index) => (
          <SubjectChoice
            key={candidate.id}
            candidate={candidate}
            number={index + 1}
            onChoose={onChoose}
          />
        ))}
      </div>
    </section>
  );
}
function SubjectChoice({
  candidate,
  number,
  onChoose,
}: {
  candidate: { id: string; preview: Blob };
  number: number;
  onChoose: (id: string) => void;
}) {
  const url = useBlobUrl(candidate.preview);
  return (
    <Button
      type="button"
      className="subject-choice"
      onClick={() => onChoose(candidate.id)}
    >
      <img src={url} alt={t("Product {number}", { number })} />
      <span>{t("Use product {number}", { number })}</span>
    </Button>
  );
}
