import { t } from "./ui/i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAutoRuns, type AutoRun } from "./automaticStore";
import {
  PageHeader,
  LoadingState,
  EmptyState,
  StatusBadge,
  ErrorNotice,
} from "./ui/components";
function Thumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return (
    <img src={url || undefined} alt={t("Product preview")} loading="lazy" />
  );
}
export function ImageLibrary() {
  const [rows, setRows] = useState<AutoRun[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    listAutoRuns()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((error) => {
        if (alive)
          setError(
            error instanceof Error ? error.message : "HISTORY_UNAVAILABLE",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <PageHeader eyebrow={t("YOUR LIBRARY")} title={t("My images")}>
        {t("Your uploads and finished images, saved on this device.")}
      </PageHeader>
      {loading ? (
        <LoadingState>{t("Loading your images…")}</LoadingState>
      ) : error ? (
        <ErrorNotice title={t("Library unavailable")}>{t(error)}</ErrorNotice>
      ) : !rows.length ? (
        <section className="surface-card">
          <EmptyState
            title={t("Your next product starts here.")}
            action={
              <Link className="primary-button" to="/">
                {t("Upload image")}
              </Link>
            }
          >
            {t(
              "Create product images from your photo, then inspect each look.",
            )}
          </EmptyState>
        </section>
      ) : (
        <div className="library-grid">
          {rows.map((row) => (
            <Link className="library-card" key={row.id} to={`/?run=${row.id}`}>
              <div className="library-image">
                <Thumbnail
                  blob={
                    row.items.find((i) => i.status === "READY")?.output ??
                    row.source
                  }
                />
              </div>
              <div className="library-caption">
                <StatusBadge
                  tone={
                    row.items.some(
                      (i) => i.status === "UNKNOWN" || i.status === "FAILED",
                    )
                      ? "warning"
                      : row.items.some((i) => i.status === "READY")
                        ? "success"
                        : "neutral"
                  }
                >
                  {t("{count} downloadable", {
                    count: row.items.filter((i) => i.status === "READY").length,
                  })}
                </StatusBadge>
                <strong>{row.filename}</strong>
                <span>
                  {t(
                    row.mode === "REFERENCE" ? "Reference concepts" : "STRICT",
                  )}{" "}
                  ·{" "}
                  {t("{count} downloadable", {
                    count: row.items.filter((i) => i.status === "READY").length,
                  })}{" "}
                  · {new Date(row.createdAt).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="workspace-note">
        {t(
          "Original files stay local. Reference analysis sends normalized copies with your tab consent; selected crops remain in local history. Estimates are local records, not your OpenAI bill.",
        )}
      </p>
    </>
  );
}
