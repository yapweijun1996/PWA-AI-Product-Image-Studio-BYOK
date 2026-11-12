import {
  STUDIO_STYLE_IDS,
  STUDIO_MODEL,
  STUDIO_QUALITY,
  STUDIO_SIZE,
  STUDIO_SCENE_PROMPT_VERSION,
  STUDIO_PRESET_VERSION,
} from "../studio-policy.mjs";
import { browserStudioRequest, referenceTransmissionAllowed } from "./browserByok";
import { AUTOMATIC_LAYOUTS, AUTOMATIC_PROMPT_VERSION, automaticPrompt, automaticEstimateUSD, type AutomaticMode } from "../automatic-policy.mjs";
import { prepareAutomaticReference, type PreparedReference } from "./automaticReference";
import { prepareForeground, composeAutomatic, automaticCompositionEvidence, mountAutomaticBillboard, validateAutomaticDecodedImage } from "./autoImaging";
import { listAutoRuns, saveAutoRun, type AutoRun } from "./automaticStore";
import { reserveAutomaticRun } from "./automaticSession";
import { inspectImageHeader } from "./imageHeader";
import { sha256 } from "./prepareSource";
export function automaticPlan(mode: AutomaticMode = "STRICT", referenceCount = 1) {
  const context = {
    productName: "Uploaded product",
    category: "user-supplied product",
    confirmedFacts: [],
    sourceView: "UNKNOWN" as const,
  };
  const items = STUDIO_STYLE_IDS.map((style) => {
    const prompt = style === "macro" ? "Local crop of measured visible foreground pixels; no provider request or invented detail." : automaticPrompt(style, mode);
    return {
      id: crypto.randomUUID(),
      style,
      prompt,
      estimatedUSD: automaticEstimateUSD(style, mode, referenceCount),
      status: "PENDING" as const,
    };
  });
  return {
    context,
    items,
    estimatedUSD: (
      items.reduce((n, i) => n + Math.round(Number(i.estimatedUSD) * 1e6), 0) /
      1e6
    ).toFixed(6),
  };
}
export async function runAutomatic(
  file: File,
  signal: AbortSignal,
  changed: (run: AutoRun) => void,
  options: { mode?: AutomaticMode; additionalReferences?: File[] } = {},
) {
  const mode = options.mode ?? "STRICT", additionalReferences = options.additionalReferences ?? [];
  if (!["STRICT", "REFERENCE"].includes(mode) || !Array.isArray(additionalReferences) || additionalReferences.length > 2 || (mode === "STRICT" && additionalReferences.length)) throw new Error("Invalid image mode or reference count.");
  if (mode === "REFERENCE" && !referenceTransmissionAllowed()) throw new Error("Authorize reference-image transmission before uploading. No image was sent.");
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image up to 20 MiB.");
  if (!navigator.locks)
    throw new Error(
      "This browser cannot safely coordinate image requests. Use a current Chrome or Safari browser.",
    );
  await navigator.locks.request(
    "studio-automatic-upload-v1",
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "Another upload is already processing. No new requests were sent.",
        );
      const prior = await listAutoRuns();
      if (
        prior.some((r) =>
          r.items.some(
            (i) =>
              (i.status === "UNKNOWN" || i.status === "SUBMITTED") &&
              !i.reviewedAt,
          ),
        )
      )
        throw new Error(
          "An earlier request has an uncertain charge. New paid requests are paused. Saved finished images remain available.",
        );
      const plan = automaticPlan(mode, 1 + additionalReferences.length);
      const references: PreparedReference[] = [];
      const run: AutoRun = {
        version: 1,
        mode,
        id: crypto.randomUUID(),
        filename: file.name,
        source: file,
        sourceSha256: await sha256(new Uint8Array(await file.arrayBuffer())),
        createdAt: new Date().toISOString(),
        state: "PREPARING",
        items: plan.items,
        estimatedUSD: plan.estimatedUSD,
        sessionId: "",
      };
      const emit = () =>
        changed({ ...run, items: run.items.map((i) => ({ ...i })) });
      const check = () => {
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      };
      try {
        emit();
        if (mode === "REFERENCE") {
          for (const reference of [file, ...additionalReferences]) {
            check();
            if (!referenceTransmissionAllowed()) throw new Error("Reference transmission consent was removed. No further image was sent.");
            references.push(await prepareAutomaticReference(reference, signal));
          }
          run.referenceImages = references.map(({ sha256, width, height, mimeType }) => ({ sha256, width, height, mimeType }));
        }
        try {
          run.foreground = await prepareForeground(file, signal, (message) => { run.message = message; emit(); });
        } catch (error) {
          check();
          if (mode === "STRICT") throw error;
          // Reference editing does not require successful local segmentation.
          // An unavailable authentic crop is failed explicitly, never synthesized.
        }
        check();
        if (run.foreground && run.foreground.sourceSha256 !== run.sourceSha256)
          throw new Error("The original changed during preparation.");
        run.capabilities = run.foreground?.capabilities;
        // Reserve the entire upload estimate once, before the first paid send.
        run.sessionId = reserveAutomaticRun(plan.estimatedUSD);
        run.state = "RUNNING";
        run.message = undefined;
        await saveAutoRun(run);
        emit();
        for (const item of [...run.items.filter(i => i.style === "macro"), ...run.items.filter(i => i.style !== "macro")]) {
          check();
          item.provenance = { policyVersion: AUTOMATIC_PROMPT_VERSION, mode, operation: item.style === "macro" ? "local-detail" : mode === "REFERENCE" ? "reference-edit" : "generated-scene-composite", ...(run.foreground ? automaticCompositionEvidence(run.foreground, item.style) : { layout: { ...AUTOMATIC_LAYOUTS[item.style] }, visualAssessment: "NOT_ASSESSED" as const, ...(item.style === "billboard" ? { artworkLayer: "local-full-text-free-ad-v1" as const } : {}) }) };
          if (item.style === "macro") {
            try {
              if (!run.foreground) throw new Error("No authentic foreground crop available.");
              item.output = await composeAutomatic(run.foreground, undefined, item.style, signal);
              item.sha256 = await sha256(new Uint8Array(await item.output.arrayBuffer()));
              item.qa = { status: "AUTOMATIC_CHECKS_PASSED", sourceSha256: run.sourceSha256, foregroundSha256: await sha256(new Uint8Array(await run.foreground.blob.arrayBuffer())), outputSha256: item.sha256, checkedAt: new Date().toISOString(), humanReview: false, visualAssessment: "NOT_ASSESSED" };
              item.status = "READY";
            } catch { item.status = "FAILED"; item.error = "The local visible detail crop could not be prepared. No detail request was sent."; }
            await saveAutoRun(run); emit(); continue;
          }
          const revision = await (
            await browserStudioRequest("/images/revision")
          ).json();
          const body = {
            clientAttemptId: item.id,
            productId: run.id,
            styleId: item.style,
            lockMode: mode === "REFERENCE" ? "BALANCED" : "STRICT",
            operation: mode === "REFERENCE" ? "reference_edit" : "generate_scene",
            automaticMode: mode,
            automaticPromptVersion: AUTOMATIC_PROMPT_VERSION,
            ...(mode === "REFERENCE" ? { referenceInputs: references } : {}),
            model: STUDIO_MODEL,
            quality: STUDIO_QUALITY,
            size: STUDIO_SIZE,
            prompt: item.prompt,
            promptVersion: STUDIO_SCENE_PROMPT_VERSION,
            presetVersion: STUDIO_PRESET_VERSION,
            sceneContext: plan.context,
            sourceAssetHashes: [run.sourceSha256],
            estimatedUSD: item.estimatedUSD,
            outputFormat: "png",
            reviewRevision: revision.reviewRevision,
          };
          const approval = await browserStudioRequest("/images/approvals", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (!approval.ok)
            throw new Error(
              "The connection or request history changed. Remaining images were not sent.",
            );
          const receipt = await approval.json();
          check();
          item.status = "SUBMITTED";
          await saveAutoRun(run);
          emit();
          const response = await browserStudioRequest("/images/generate", {
            method: "POST",
            headers: {
              "X-Client-Request-Id": item.id,
              "X-Attempt-Approval": receipt.approvalId,
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            const failure = await response.json();
            item.status =
              failure.error?.outcome === "DEFINITIVE_FAILURE"
                ? "FAILED"
                : "UNKNOWN";
            item.error =
              response.status === 401
                ? "OpenAI rejected authentication (401). Replace your key in Settings before starting a new attempt."
                : response.status === 429
                  ? "Provider rate limit reached."
                  : failure.error?.code === "RECOVERY_REQUIRED"
                    ? "Request history could not be saved. This request was not sent."
                    : "Could not read the provider response. Check your API key and connection in Settings. The request outcome is unknown.";
            await saveAutoRun(run);
            throw new Error(item.error);
          }
          try {
            const result = await response.json();
            if (
              result.clientAttemptId !== item.id ||
              typeof result.image?.dataBase64 !== "string"
            )
              throw new Error("Invalid image response.");
            const raw = atob(result.image.dataBase64),
              bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)),
              header = inspectImageHeader(bytes);
            if (
              header.mimeType !== "image/png" ||
              header.width !== 1024 ||
              header.height !== 1024
            )
              throw new Error("Unexpected generated image.");
            item.scene = new Blob([bytes], { type: "image/png" });
            if (mode === "REFERENCE") await validateAutomaticDecodedImage(item.scene, signal);
            item.output = mode === "REFERENCE"
              ? item.style === "billboard" ? await mountAutomaticBillboard(item.scene, signal) : item.scene
              : await composeAutomatic(run.foreground!, item.scene, item.style, signal);
            item.sha256 = await sha256(
              new Uint8Array(await item.output.arrayBuffer()),
            );
            const outputHeader = inspectImageHeader(
              new Uint8Array(await item.output.arrayBuffer()),
            );
            if (
              outputHeader.mimeType !== "image/png" ||
              outputHeader.width !== 1024 ||
              outputHeader.height !== 1024
            )
              throw new Error("Output check failed.");
            item.qa = {
              status: "AUTOMATIC_CHECKS_PASSED",
              sourceSha256: run.sourceSha256,
              foregroundSha256: mode === "STRICT" && run.foreground ? await sha256(
                new Uint8Array(await run.foreground.blob.arrayBuffer()),
              ) : undefined,
              sceneSha256: await sha256(bytes),
              outputSha256: item.sha256,
              checkedAt: new Date().toISOString(),
              humanReview: false,
              visualAssessment: "NOT_ASSESSED",
            };
            item.status = "READY";
          } catch {
            item.status = "FAILED";
            item.error =
              "This result could not be composed or checked. It was excluded from downloads.";
          }
          await saveAutoRun(run);
          emit();
        }
        run.state = "COMPLETE";
        run.message = undefined;
        await saveAutoRun(run);
        emit();
      } catch (error) {
        for (const item of run.items) {
          if (item.status === "SUBMITTED") {
            item.status = "UNKNOWN";
            item.error =
              "Request interrupted. A charge may have occurred; no automatic retry.";
          } else if (item.status === "PENDING") item.status = "NOT_SENT";
        }
        run.state = "STOPPED";
        run.message =
          error instanceof Error ? error.message : "Processing stopped.";
        // Preserve original and successful outputs. A failed write is never followed by another paid send.
        try {
          await saveAutoRun(run);
        } catch {
          run.unsavedOutputs = true;
          run.message =
            "Result storage is unavailable. Processing stopped; download any finished images below before leaving.";
        }
        emit();
      }
    },
  );
}

// Exceptional recovery is explicit; it never changes the original outcome or resends.
export async function resolveAutomaticHolds(confirmed: boolean) {
  if (!confirmed || !navigator.locks)
    throw new Error(
      "Confirm that you checked provider billing and waiting periods.",
    );
  await navigator.locks.request(
    "studio-automatic-upload-v1",
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error("An upload is still active. Wait until it stops.");
      const runs = await listAutoRuns();
      for (const run of runs) {
        let changed = false;
        for (const item of run.items) {
          if (
            (item.status === "UNKNOWN" || item.status === "SUBMITTED") &&
            !item.reviewedAt
          ) {
            const receipt = await browserStudioRequest(
              `/images/attempts/${item.id}/acknowledgement`,
              {
                method: "POST",
                body: JSON.stringify({ acknowledgePossibleCharge: true }),
              },
            );
            if (!receipt.ok)
              throw new Error(
                "The request history could not be reconciled. Preserve your local data.",
              );
            item.reviewedAt = (await receipt.json()).acknowledgedAt;
            changed = true;
          }
        }
        if (changed) await saveAutoRun(run);
      }
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
