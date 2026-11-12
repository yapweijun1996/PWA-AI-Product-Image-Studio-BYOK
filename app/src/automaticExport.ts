import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { checkedOutput, type AutoRun } from "./automaticStore";
import { imageFilename } from "./automaticPresentation";
export async function automaticArchive(run: AutoRun) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  try {
    for (const item of run.items.filter(
      (i) => i.status === "READY" && i.output,
    ))
      await writer.add(
        imageFilename(item),
        new BlobReader(await checkedOutput(item)),
      );
    const info = {
      version: 2,
      runId: run.id,
      pipelineVersion: run.pipelineVersion ?? "legacy",
      createdAt: run.createdAt,
      sourceSha256: run.sourceSha256,
      mode: run.mode ?? "STRICT",
      sourceCapabilities: run.capabilities,
      validation: "AUTOMATIC_TECHNICAL_CHECKS_ONLY",
      humanApproval: false,
      qualityStatus: run.qualityStatus ?? "NOT_ASSESSED",
      reviewCoverage: {
        evaluated: run.items.filter(
          (i) => i.semantic && i.semantic.outputSha256 === i.sha256,
        ).length,
        totalGenerated: run.items.filter(
          (i) => i.style !== "macro" && i.status === "READY",
        ).length,
      },
      limitations:
        "Technical checks and machine visual hints are not human approval or verified brand fidelity. References can change labels/geometry; enlargement adds no authentic detail.",
      referenceImages:
        run.preparedReferences?.map((ref) => ({
          sha256: ref.sha256,
          width: ref.width,
          height: ref.height,
          sourceSha256: ref.sourceSha256,
          normalizedSha256: ref.normalizedSha256,
          roi: ref.roi,
        })) ?? run.referenceImages,
      analysis: run.analysis
        ? {
            classification: run.analysis.report.classification,
            confidence: run.analysis.report.confidence,
            selectedSubjectId: run.analysis.selectedSubjectId,
            selectedBy: run.analysis.selectedBy,
            bindings: run.analysis.bindings,
          }
        : undefined,
      auxiliary: run.auxiliary?.map((a) => ({
        attemptId: a.id,
        purpose: a.kind,
        status: a.status,
        estimatedUSD: a.estimatedUSD,
        reviewedAt: a.reviewedAt,
      })),
      images: run.items.map((item) => ({
        style: item.style,
        outputMeaning:
          item.style === "billboard"
            ? item.provenance?.policyVersion === "2.0.0"
              ? "Campaign"
              : "Legacy billboard mockup"
            : item.style,
        attemptId: item.id,
        status: item.status,
        sha256: item.sha256,
        prompt: item.prompt,
        estimatedUSD: item.estimatedUSD,
        qa: item.qa,
        provenance: item.provenance ?? {
          mode: "STRICT",
          operation: "legacy-composite",
          visualAssessment: "NOT_ASSESSED",
        },
        semantic:
          item.semantic?.outputSha256 === item.sha256
            ? item.semantic
            : undefined,
        similarity: item.similarity,
        versions: item.versions?.map((v) => ({
          attemptId: v.id,
          createdAt: v.createdAt,
          status: v.status,
          sha256: v.sha256,
          estimatedUSD: v.estimatedUSD,
          policyVersion: v.provenance?.policyVersion,
        })),
      })),
    };
    await writer.add(
      "image-information.json",
      new TextReader(JSON.stringify(info, null, 2)),
    );
    return await writer.close();
  } catch (error) {
    await writer.close().catch(() => {});
    throw error;
  }
}
