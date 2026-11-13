import { automaticErrorCode } from "./automaticErrors";
import { prepareAutomaticStores } from "./automaticMigration";
import {
  STUDIO_STYLE_IDS,
  STUDIO_MODEL,
  STUDIO_QUALITY,
  STUDIO_SIZE,
} from "../studio-policy.mjs";
import {
  AUTOMATIC_PROMPT_VERSION,
  automaticLayout,
  automaticPrompt,
  automaticEstimateUSD,
  type AutomaticMode,
} from "../automatic-policy.mjs";
import {
  VISION_MODEL,
  VISION_POLICY_VERSION,
  visionPrompt,
  visionEstimateUSD,
  validateSourceAnalysis,
  validateOutputReview,
  automaticSubjectId,
  subjectCandidates,
  type SourceAnalysis,
  type VisionPurpose,
} from "../vision-policy.mjs";
import {
  browserStudioRequest,
  referenceTransmissionAllowed,
} from "./browserByok";
import {
  prepareAutomaticReference,
  type PreparedReference,
} from "./automaticReference";
import {
  prepareSubject,
  candidatePreview,
  thawReferences,
} from "./subjectPreparation";
import {
  prepareForeground,
  composeAutomatic,
  automaticCompositionEvidence,
  validateAutomaticDecodedImage,
  strictDetailReliable,
  strictForegroundReliable,
} from "./autoImaging";
import {
  listAutoRuns,
  saveAutoRun,
  type AutoRun,
  type AutoItem,
  type AuxiliaryAttempt,
} from "./automaticStore";
import { reserveAutomaticRun } from "./automaticSession";
import { localSimilarity } from "./automaticQuality";
import { inspectImageHeader } from "./imageHeader";
import { sha256 } from "./prepareSource";
const check = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("REQUEST_STOPPED", "AbortError");
};
export function automaticPlan(
  mode: AutomaticMode = "STRICT",
  _referenceCount = 1,
) {
  const items = STUDIO_STYLE_IDS.map((style) => ({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    style,
    prompt:
      style === "macro"
        ? "Local authenticated visible source crop only. No generation."
        : automaticPrompt(style, mode),
    estimatedUSD: automaticEstimateUSD(
      style,
      mode,
      mode === "REFERENCE" ? 3 : 1,
    ),
    status: "PENDING" as const,
  }));
  const auxiliary: AuxiliaryAttempt[] =
    mode === "REFERENCE"
      ? (["source-analysis", "output-review"] as const).map((kind) => ({
          id: crypto.randomUUID(),
          kind,
          estimatedUSD: visionEstimateUSD(kind, 3),
          status: "PENDING",
        }))
      : [];
  return {
    items,
    auxiliary,
    estimatedUSD: (
      [...items, ...auxiliary].reduce(
        (n, i) => n + Math.round(Number(i.estimatedUSD) * 1e6),
        0,
      ) / 1e6
    ).toFixed(6),
  };
}
async function invoke(
  run: AutoRun,
  item: AutoItem | AuxiliaryAttempt,
  body: Record<string, unknown>,
  signal: AbortSignal,
  emit: () => void,
) {
  check(signal);
  const revision = await (
    await browserStudioRequest("/images/revision")
  ).json();
  const request = {
    ...body,
    clientAttemptId: item.id,
    productId: "style" in item ? (item.reservationId ?? run.id) : run.id,
    estimatedUSD: item.estimatedUSD,
    reviewRevision: revision.reviewRevision,
  };
  const approval = await browserStudioRequest("/images/approvals", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
  if (!approval.ok)
    throw new Error(
      approval.status === 401 ? "API_KEY_REQUIRED" : "APPROVAL_CHANGED",
    );
  const receipt = await approval.json();
  check(signal);
  item.status = "SUBMITTED";
  await saveAutoRun(run);
  emit();
  const response = await browserStudioRequest("/images/generate", {
    method: "POST",
    headers: {
      "X-Client-Request-Id": item.id,
      "X-Attempt-Approval": receipt.approvalId,
    },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const result = await response.json();
    item.status = ["DEFINITIVE_FAILURE", "DEFINITIVE_SUCCESS"].includes(
      result.error?.outcome,
    )
      ? "FAILED"
      : "UNKNOWN";
    item.error = ["SOURCE_ANALYSIS_INVALID", "OUTPUT_REVIEW_INVALID"].includes(
      result.error?.code,
    )
      ? result.error.code
      : response.status === 401
        ? "API_KEY_REJECTED"
        : response.status === 429
          ? "PROVIDER_LIMIT"
          : item.status === "UNKNOWN"
            ? "REQUEST_UNKNOWN"
            : "REQUEST_NOT_SENT";
    await saveAutoRun(run);
    throw new Error(item.error);
  }
  const result = await response.json();
  if (result.clientAttemptId !== item.id)
    throw new Error("INVALID_PROVIDER_RESULT");
  return result;
}
async function visualCall(
  run: AutoRun,
  purpose: VisionPurpose,
  refs: PreparedReference[],
  styles: AutoItem["style"][],
  sourceReferenceCount: number,
  signal: AbortSignal,
  emit: () => void,
) {
  const item = run.auxiliary!.find((a) => a.kind === purpose)!;
  const result = await invoke(
    run,
    item,
    {
      operation: "visual_analysis",
      visionPurpose: purpose,
      schemaVersion: VISION_POLICY_VERSION,
      automaticMode: "REFERENCE",
      model: VISION_MODEL,
      referenceInputs: refs,
      sourceReferenceCount,
      reviewStyles: styles,
      prompt: visionPrompt(purpose, styles, sourceReferenceCount),
    },
    signal,
    emit,
  );
  item.status = "READY";
  await saveAutoRun(run);
  emit();
  return result.analysis;
}
async function finishTechnical(
  run: AutoRun,
  item: AutoItem,
  output: Blob,
  sceneBytes?: Uint8Array<ArrayBuffer>,
) {
  await validateAutomaticDecodedImage(output, new AbortController().signal);
  item.output = output;
  item.sha256 = await sha256(new Uint8Array(await output.arrayBuffer()));
  item.qa = {
    status: "AUTOMATIC_CHECKS_PASSED",
    sourceSha256:
      run.mode === "REFERENCE"
        ? (run.preparedReferences?.[0]?.sourceSha256 ?? run.sourceSha256)
        : run.sourceSha256,
    foregroundSha256:
      run.mode !== "REFERENCE" && run.foreground
        ? await sha256(new Uint8Array(await run.foreground.blob.arrayBuffer()))
        : undefined,
    sceneSha256: sceneBytes ? await sha256(sceneBytes) : undefined,
    outputSha256: item.sha256,
    checkedAt: new Date().toISOString(),
    humanReview: false,
    visualAssessment: "NOT_ASSESSED",
  };
  item.status = "READY";
}
async function createItem(
  run: AutoRun,
  item: AutoItem,
  refs: PreparedReference[],
  signal: AbortSignal,
  emit: () => void,
) {
  check(signal);
  const mode = run.mode ?? "STRICT";
  item.provenance = {
    policyVersion: AUTOMATIC_PROMPT_VERSION,
    mode,
    operation:
      item.style === "macro"
        ? "local-detail"
        : mode === "REFERENCE"
          ? "reference-edit"
          : "generated-scene-composite",
    ...(run.foreground
      ? automaticCompositionEvidence(run.foreground, item.style)
      : {
          layout: automaticLayout(item.style, mode, run.compositionContext),
          visualAssessment: "NOT_ASSESSED" as const,
        }),
  };
  if (item.style === "macro") {
    if (!run.detail?.blob) {
      item.status = "FAILED";
      item.error = run.detail?.reason ?? "DETAIL_UNRELIABLE";
      return;
    }
    if (run.detail.roi)
      item.provenance = {
        ...item.provenance,
        detailRoi: run.detail.roi,
        detailUpscaled: run.detail.roi.width < 1024,
        detailLimitation: "Source pixels only; enlargement adds no detail.",
      };
    await finishTechnical(run, item, run.detail.blob);
    return;
  }
  item.prompt = automaticPrompt(item.style, mode, run.compositionContext);
  const result = await invoke(
    run,
    item,
    {
      styleId: item.style,
      lockMode: mode === "REFERENCE" ? "BALANCED" : "STRICT",
      operation: mode === "REFERENCE" ? "reference_edit" : "generate_scene",
      automaticMode: mode,
      automaticPromptVersion: AUTOMATIC_PROMPT_VERSION,
      compositionContext: run.compositionContext ?? {
        category: "unknown",
        camera: "unknown",
      },
      ...(mode === "REFERENCE" ? { referenceInputs: refs } : {}),
      model: STUDIO_MODEL,
      quality: STUDIO_QUALITY,
      size: STUDIO_SIZE,
      prompt: item.prompt,
      outputFormat: "png",
    },
    signal,
    emit,
  );
  try {
    if (typeof result.image?.dataBase64 !== "string")
      throw new Error("Invalid generated image.");
    const bytes = Uint8Array.from(atob(result.image.dataBase64), (c) =>
        c.charCodeAt(0),
      ),
      header = inspectImageHeader(bytes);
    if (
      header.mimeType !== "image/png" ||
      header.width !== 1024 ||
      header.height !== 1024
    )
      throw new Error("Unexpected generated image.");
    item.scene = new Blob([bytes], { type: "image/png" });
    await validateAutomaticDecodedImage(item.scene, signal);
    const output =
      mode === "REFERENCE"
        ? item.scene
        : await composeAutomatic(
            run.foreground!,
            item.scene,
            item.style,
            signal,
          );
    check(signal);
    await finishTechnical(run, item, output, bytes);
  } catch {
    item.status = "FAILED";
    item.error = "OUTPUT_UNREADABLE";
  }
}
async function reviewOutputs(
  run: AutoRun,
  refs: PreparedReference[],
  signal: AbortSignal,
  emit: () => void,
) {
  const items = run.items.filter(
    (i) => i.style !== "macro" && i.status === "READY" && i.output,
  );
  const attempt = run.auxiliary!.find((a) => a.kind === "output-review")!;
  if (!items.length) {
    attempt.status = "NOT_SENT";
    return;
  }
  try {
    const reviewRefs: PreparedReference[] = [];
    for (const ref of run.preparedReferences!)
      reviewRefs.push(
        await prepareAutomaticReference(
          new File([ref.blob], "reference.png", { type: "image/png" }),
          signal,
          { maxEdge: 384, maxBytes: 1024 * 1024 },
        ),
      );
    for (const item of items)
      reviewRefs.push(
        await prepareAutomaticReference(
          new File([item.output!], "output.png", { type: "image/png" }),
          signal,
          { maxEdge: 384, maxBytes: 1024 * 1024 },
        ),
      );
    const result = validateOutputReview(
      await visualCall(
        run,
        "output-review",
        reviewRefs,
        items.map((i) => i.style),
        refs.length,
        signal,
        emit,
      ),
      items.map((i) => i.style),
    );
    for (const finding of result.findings) {
      const item = items.find((i) => i.style === finding.styleId)!;
      item.semantic = {
        ...finding,
        attemptId: attempt.id,
        outputSha256: item.sha256!,
        reviewedAt: new Date().toISOString(),
      };
    }
    run.qualityStatus = "MACHINE_HINTS_AVAILABLE";
  } catch {
    if (attempt.status === "SUBMITTED") attempt.status = "UNKNOWN";
    else if (attempt.status === "PENDING") attempt.status = "FAILED";
    if (attempt.error !== "OUTPUT_REVIEW_INVALID")
      attempt.error = "QUALITY_UNAVAILABLE";
    run.qualityStatus = "NOT_ASSESSED";
  }
}
export type AutomaticOptions = {
  mode?: AutomaticMode;
  additionalReferences?: File[];
  selectSubject?: (
    candidates: { id: string; preview: Blob }[],
  ) => Promise<string>;
};
export async function runAutomatic(
  file: File,
  signal: AbortSignal,
  changed: (run: AutoRun) => void,
  options: AutomaticOptions = {},
) {
  const mode = options.mode ?? "STRICT",
    additional = options.additionalReferences ?? [];
  if (
    !["STRICT", "REFERENCE"].includes(mode) ||
    additional.length > 2 ||
    (mode === "STRICT" && additional.length)
  )
    throw new Error("INVALID_REFERENCE_COUNT");
  if (mode === "REFERENCE" && !referenceTransmissionAllowed())
    throw new Error("REFERENCE_CONSENT_REQUIRED");
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("SOURCE_TOO_LARGE");
  if (!navigator.locks) throw new Error("SAFE_COORDINATION_REQUIRED");
  await prepareAutomaticStores();
  await navigator.locks.request(
    "studio-automatic-upload-v1",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("UPLOAD_ALREADY_ACTIVE");
      // Validate saved history without treating an older uncertain attempt as a
      // prohibition on a new, independently authorized upload.
      await listAutoRuns();
      const plan = automaticPlan(mode);
      const run: AutoRun = {
        version: 1,
        pipelineVersion: "2.0.0",
        mode,
        id: crypto.randomUUID(),
        filename: file.name,
        source: file,
        sourceSha256: await sha256(new Uint8Array(await file.arrayBuffer())),
        createdAt: new Date().toISOString(),
        state: "PREPARING",
        items: plan.items,
        auxiliary: plan.auxiliary,
        estimatedUSD: plan.estimatedUSD,
        sessionId: "",
        qualityStatus: "NOT_ASSESSED",
      };
      const emit = () =>
        changed({
          ...run,
          items: run.items.map((i) => ({ ...i })),
          auxiliary: run.auxiliary?.map((a) => ({ ...a })),
        });
      let refs: PreparedReference[] = [];
      try {
        emit();
        if (mode === "STRICT") {
          run.foreground = await prepareForeground(file, signal, (message) => {
            run.message = message;
            emit();
          });
          check(signal);
          if (run.foreground.sourceSha256 !== run.sourceSha256)
            throw new Error("SOURCE_CHANGED");
          if (!(await strictForegroundReliable(run.foreground)))
            throw new Error("STRICT_SUBJECT_UNCERTAIN");
          run.foregroundSha256 = await sha256(
            new Uint8Array(await run.foreground.blob.arrayBuffer()),
          );
          run.capabilities = run.foreground.capabilities;
          run.compositionContext = { category: "unknown", camera: "unknown" };
          if (await strictDetailReliable(run.foreground))
            run.detail = {
              blob: await composeAutomatic(
                run.foreground,
                undefined,
                "macro",
                signal,
              ),
            };
          else run.detail = { reason: "DETAIL_UNRELIABLE" };
          if (run.detail?.blob) {
            run.detail.sha256 = await sha256(
              new Uint8Array(await run.detail.blob.arrayBuffer()),
            );
            run.detail.sourceSha256 = run.sourceSha256;
          }
          run.sessionId = await reserveAutomaticRun(run);
          await saveAutoRun(run);
        } else {
          run.message = "ANALYZING_SOURCE";
          emit();
          const files = [file, ...additional],
            normalized: PreparedReference[] = [];
          for (const source of files) {
            check(signal);
            normalized.push(await prepareAutomaticReference(source, signal));
          }
          // Reserve all six worst-case image attempts and both bounded auxiliary calls BEFORE analysis.
          run.sessionId = await reserveAutomaticRun(run);
          await saveAutoRun(run);
          const report = validateSourceAnalysis(
            await visualCall(
              run,
              "source-analysis",
              normalized,
              [],
              normalized.length,
              signal,
              emit,
            ),
            normalized.length,
          );
          run.analysis = {
            report,
            bindings: normalized.map(({ sha256, width, height }) => ({
              sha256,
              width,
              height,
            })),
          };
          let selected = automaticSubjectId(report),
            selectedBy: "automatic" | "user" = "automatic";
          if (!selected) {
            const candidates = [];
            for (const subject of subjectCandidates(report))
              candidates.push({
                id: subject.id,
                preview: await candidatePreview(files, subject, signal),
              });
            if (!candidates.length || !options.selectSubject)
              throw new Error("SUBJECT_UNRELIABLE");
            run.selectionCandidates = candidates;
            run.message = "CHOOSE_SUBJECT";
            emit();
            selected = await options.selectSubject(candidates);
            check(signal);
            if (!candidates.some((c) => c.id === selected))
              throw new Error("SUBJECT_UNRELIABLE");
            selectedBy = "user";
          }
          run.selectionCandidates = undefined;
          run.analysis.selectedSubjectId = selected;
          run.analysis.selectedBy = selectedBy;
          const prepared = await prepareSubject(
            files,
            normalized,
            report,
            selected,
            signal,
          );
          refs = prepared.references;
          run.preparedReferences = prepared.frozen;
          run.referenceImages = refs.map(
            ({ sha256, width, height, mimeType }) => ({
              sha256,
              width,
              height,
              mimeType,
            }),
          );
          run.detail = {
            blob: prepared.detail,
            sha256: prepared.detail
              ? await sha256(
                  new Uint8Array(await prepared.detail.arrayBuffer()),
                )
              : undefined,
            sourceSha256: prepared.frozen[0].sourceSha256,
            normalizedSha256: prepared.frozen[0].normalizedSha256,
            subjectId: selected,
            roi: prepared.detailRoi,
            reason: prepared.detailReason,
          };
          run.compositionContext = {
            category:
              prepared.subject.confidence >= 0.8
                ? prepared.subject.category
                : "unknown",
            camera:
              prepared.subject.confidence >= 0.8
                ? prepared.subject.camera
                : "unknown",
          };
        }
        run.state = "RUNNING";
        run.message = undefined;
        await saveAutoRun(run);
        emit();
        for (const item of [
          ...run.items.filter((i) => i.style === "macro"),
          ...run.items.filter((i) => i.style !== "macro"),
        ]) {
          await createItem(run, item, refs, signal, emit);
          await saveAutoRun(run);
          emit();
        }
        await localSimilarity(run.items);
        if (mode === "REFERENCE") await reviewOutputs(run, refs, signal, emit);
        run.state = "COMPLETE";
        run.message = undefined;
        await saveAutoRun(run);
        emit();
      } catch (error) {
        run.selectionCandidates = undefined;
        for (const item of [...run.items, ...(run.auxiliary ?? [])]) {
          if (item.status === "SUBMITTED") {
            item.status = "UNKNOWN";
            item.error = "REQUEST_UNKNOWN";
          } else if (item.status === "PENDING") item.status = "NOT_SENT";
        }
        run.state = "STOPPED";
        run.message = automaticErrorCode(error);
        try {
          await saveAutoRun(run);
        } catch {
          run.unsavedOutputs = true;
          run.message = "LOCAL_SAVE_FAILED";
        }
        emit();
      }
    },
  );
}
export async function regenerateAutomatic(
  runId: string,
  style: AutoItem["style"],
  signal: AbortSignal,
  changed: (run: AutoRun) => void,
) {
  if (!navigator.locks) throw new Error("SAFE_COORDINATION_REQUIRED");
  await prepareAutomaticStores();
  await navigator.locks.request(
    "studio-automatic-upload-v1",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("UPLOAD_ALREADY_ACTIVE");
      const run = (await listAutoRuns()).find((r) => r.id === runId);
      if (!run || run.pipelineVersion !== "2.0.0")
        throw new Error("LEGACY_REGEN_UNAVAILABLE");
      if (
        style !== "macro" &&
        run.mode === "REFERENCE" &&
        (!referenceTransmissionAllowed() || !run.preparedReferences?.length)
      )
        throw new Error("REFERENCE_CONSENT_REQUIRED");
      if (
        (await sha256(new Uint8Array(await run.source.arrayBuffer()))) !==
        run.sourceSha256
      )
        throw new Error("SOURCE_CHANGED");
      if (
        run.mode !== "REFERENCE" &&
        (!run.foreground ||
          !run.foregroundSha256 ||
          (await sha256(
            new Uint8Array(await run.foreground.blob.arrayBuffer()),
          )) !== run.foregroundSha256)
      )
        throw new Error("SOURCE_CHANGED");
      if (
        style === "macro" &&
        (!run.detail?.blob ||
          !run.detail.sha256 ||
          (await sha256(
            new Uint8Array(await run.detail.blob.arrayBuffer()),
          )) !== run.detail.sha256 ||
          run.detail.sourceSha256 !==
            (run.mode === "REFERENCE"
              ? run.preparedReferences?.[0]?.sourceSha256
              : run.sourceSha256))
      )
        throw new Error("DETAIL_INTEGRITY_FAILED");
      const item = run.items.find((i) => i.style === style)!;
      if (!item || (item.versions?.length && item.versions.length >= 50))
        throw new Error("VERSION_LIMIT");
      const attempt: AutoItem = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        reservationId: crypto.randomUUID(),
        style,
        prompt:
          style === "macro"
            ? "Local source crop only."
            : automaticPrompt(style, run.mode, run.compositionContext),
        estimatedUSD: automaticEstimateUSD(
          style,
          run.mode,
          run.mode === "REFERENCE" ? 3 : 1,
        ),
        status: "PENDING",
      };
      if (style !== "macro")
        await reserveAutomaticRun({
          id: attempt.reservationId!,
          items: [attempt],
          auxiliary: [],
        });
      const prior = { ...item };
      delete prior.versions;
      item.versions = [...(item.versions ?? []), attempt];
      await saveAutoRun(run);
      const emit = () =>
        changed({ ...run, items: run.items.map((i) => ({ ...i })) });
      emit();
      try {
        await createItem(
          run,
          attempt,
          run.mode === "REFERENCE" && style !== "macro"
            ? await thawReferences(run.preparedReferences!, signal)
            : [],
          signal,
          emit,
        );
        if (attempt.status === "READY") {
          const versions = [
            prior,
            ...item.versions.filter((v) => v.id !== attempt.id),
          ];
          run.items[run.items.indexOf(item)] = { ...attempt, versions };
          await localSimilarity(run.items);
          run.qualityStatus = run.items.some(
            (current) =>
              current.semantic?.outputSha256 === current.sha256 &&
              Boolean(current.semantic),
          )
            ? "MACHINE_HINTS_AVAILABLE"
            : "NOT_ASSESSED";
        }
      } catch (error) {
        if (attempt.status === "SUBMITTED") attempt.status = "UNKNOWN";
        else if (attempt.status === "PENDING") attempt.status = "NOT_SENT";
        attempt.error = automaticErrorCode(error, "REQUEST_UNKNOWN");
      }
      try {
        await saveAutoRun(run);
      } catch {
        run.unsavedOutputs = true;
        run.message = "LOCAL_SAVE_FAILED";
      }
      emit();
    },
  );
}

// Exceptional recovery is explicit; it never changes the original outcome or resends.
export async function reviewProviderWaits(confirmed: boolean) {
  if (!confirmed || !navigator.locks)
    throw new Error(
      "Confirm that you checked the provider waiting period.",
    );
  await navigator.locks.request(
    "studio-automatic-upload-v1",
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error("An upload is still active. Wait until it stops.");
      const waits = await (
        await browserStudioRequest("/images/legacy-waits")
      ).json();
      for (const wait of waits.waits ?? []) {
        const revision = await (
          await browserStudioRequest("/images/revision")
        ).json();
        const result = await browserStudioRequest(
          `/images/attempts/${wait.clientAttemptId}/legacy-wait-review`,
          {
            method: "POST",
            body: JSON.stringify({
              reviewedProviderWait: true,
              reviewRevision: revision.reviewRevision,
            }),
          },
        );
        if (!result.ok)
          throw new Error("Provider waiting-period review could not be saved.");
      }
    },
  );
}
