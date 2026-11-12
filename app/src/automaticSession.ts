import { browserKeyStatus } from "./browserByok";
import { listAutoRuns, allRunAttempts, type AutoRun } from "./automaticStore";
import {
  estimateMicros,
  utcUsageMonth,
  usageImported,
  importLegacyUsage,
  reserveStoredUpload,
  readMonthlyUsage,
  type UsageReservation,
} from "./browserCredentialStore";
export { type MonthlyUsage } from "./browserCredentialStore";
export function automaticSessionStatus() {
  const key = browserKeyStatus(),
    auth = key.uploadAuthorization;
  return key.connected && auth
    ? {
        id: auth.id,
        credentialId: key.credentialId,
        monthlyCapMicros: auth.monthlyCapMicros,
      }
    : null;
}
async function ensureUsageImported() {
  if (await usageImported()) return;
  const runs = await listAutoRuns();
  const rows: UsageReservation[] = runs
    .filter((run) => run.sessionId)
    .map((run) => ({
      id: run.id,
      month: run.createdAt.slice(0, 7),
      createdAt: run.createdAt,
      authorizationId: "legacy",
      credentialId: "legacy",
      legacy: true,
      attempts: allRunAttempts(run)
        .filter((item) => estimateMicros(item.estimatedUSD) > 0)
        .map((item) => ({
          id: item.id,
          estimatedMicros: estimateMicros(item.estimatedUSD),
          outcome:
            item.status === "READY"
              ? "DEFINITIVE_SUCCESS"
              : item.status === "UNKNOWN" || item.status === "SUBMITTED"
                ? "UNKNOWN"
                : item.status === "FAILED"
                  ? "DEFINITIVE_FAILURE"
                  : "RESERVED",
        })),
    }));
  await importLegacyUsage(rows);
}
export async function monthlyAutomaticUsage() {
  await ensureUsageImported();
  return readMonthlyUsage();
}
export async function reserveAutomaticRun(
  run: Pick<AutoRun, "id" | "items" | "auxiliary">,
) {
  const auth = automaticSessionStatus();
  if (!auth)
    throw new Error(
      "Authorize future uploads once in Settings for your saved key.",
    );
  await ensureUsageImported();
  const now = new Date();
  await reserveStoredUpload(
    {
      id: run.id,
      month: utcUsageMonth(now),
      createdAt: now.toISOString(),
      credentialId: auth.credentialId,
      authorizationId: auth.id,
      attempts: [
        ...run.items
          .filter((item) => estimateMicros(item.estimatedUSD) > 0)
          .map((item) => ({
            kind: "image" as const,
            id: item.id,
            estimatedMicros: estimateMicros(item.estimatedUSD),
            outcome: "RESERVED" as const,
          })),
        ...(run.auxiliary ?? []).map((item) => ({
          kind: item.kind,
          id: item.id,
          estimatedMicros: estimateMicros(item.estimatedUSD),
          outcome: "RESERVED" as const,
        })),
      ],
    },
    auth.credentialId,
    auth.id,
  );
  const current = automaticSessionStatus();
  if (
    !current ||
    current.id !== auth.id ||
    current.credentialId !== auth.credentialId
  )
    throw new Error(
      "The saved key or upload authorization changed. No request was sent.",
    );
  window.dispatchEvent(new Event("studio-auto-usage"));
  return auth.id;
}
