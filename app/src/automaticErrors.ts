// Do not expose arbitrary decoder/provider/storage exception text in product UI.
const codes = new Set([
  "UPGRADE_WAIT_FOR_UPLOAD",
  "UPGRADE_CLOSE_IDLE_TABS",
  "UPGRADE_CHECK_UNAVAILABLE",
  "LOCAL_UPGRADE_FAILED",
  "NEWER_APP_REQUIRED",
  "BILLING_REVIEW_REQUIRED",
  "REFERENCE_CONSENT_REQUIRED",
  "SUBJECT_UNRELIABLE",
  "SUBJECT_OVERLAPS_ANNOTATION",
  "STRICT_SUBJECT_UNCERTAIN",
  "DETAIL_UNRELIABLE",
  "DETAIL_LOW_RESOLUTION",
  "DETAIL_INTEGRITY_FAILED",
  "SOURCE_CHANGED",
  "OUTPUT_UNREADABLE",
  "OUTPUT_INTEGRITY_FAILED",
  "QUALITY_UNAVAILABLE",
  "REQUEST_UNKNOWN",
  "REQUEST_NOT_SENT",
  "REQUEST_STOPPED",
  "PROVIDER_LIMIT",
  "API_KEY_REQUIRED",
  "API_KEY_REJECTED",
  "APPROVAL_CHANGED",
  "LOCAL_SAVE_FAILED",
  "UPLOAD_ALREADY_ACTIVE",
  "SAFE_COORDINATION_REQUIRED",
  "INVALID_REFERENCE_COUNT",
  "SOURCE_TOO_LARGE",
  "LEGACY_REGEN_UNAVAILABLE",
  "VERSION_LIMIT",
  "COPY_NOT_ALLOWED",
  "COPY_TOO_LONG",
  "HISTORY_UNAVAILABLE",
  "PROCESSING_STOPPED",
  "MONTHLY_LIMIT_REACHED",
  "SOURCE_INVALID",
  "UPLOAD_AUTHORIZATION_CHANGED",
]);
export function automaticErrorCode(
  error: unknown,
  fallback = "PROCESSING_STOPPED",
) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (codes.has(message)) return message;
  if (message.includes("optional monthly local estimate limit"))
    return "MONTHLY_LIMIT_REACHED";
  if (/saved key|upload authorization|reservation changed/i.test(message))
    return "UPLOAD_AUTHORIZATION_CHANGED";
  if (/integrity check|format check|dimensions check/i.test(message))
    return "OUTPUT_INTEGRITY_FAILED";
  if (
    /not a supported|invalid.*(?:PNG|EXIF)|file type does not match|invalid reference/i.test(
      message,
    )
  )
    return "SOURCE_INVALID";
  if (/up to 20 MiB|up to 24 megapixels/i.test(message))
    return "SOURCE_TOO_LARGE";
  if (
    /product selection|separated from its background|No clear product/i.test(
      message,
    )
  )
    return "STRICT_SUBJECT_UNCERTAIN";
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "LOCAL_SAVE_FAILED";
  if (error instanceof DOMException && error.name === "AbortError")
    return "REQUEST_STOPPED";
  return fallback;
}
