import { Link } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import { listAutoRuns } from "./automaticStore";
import { automaticPlan, resolveAutomaticHolds } from "./automaticPipeline";
import { authorizeAutomaticSession } from "./automaticSession";
import { useUnsavedChanges } from "./useUnsavedChanges";
import {
  browserKeyStatus,
  browserWaitReviewNeeded,
  clearBrowserKey,
  onBrowserKeyChange,
  setBrowserKey,
} from "./browserByok";
export function BrowserKeyPanel() {
  const [recovery, setRecovery] = useState(false),
    [hasHolds, setHasHolds] = useState(false);
  useEffect(() => {
    void listAutoRuns()
      .then((rows) =>
        setHasHolds(
          browserWaitReviewNeeded() ||
            rows.some((r) =>
              r.items.some(
                (i) =>
                  (i.status === "UNKNOWN" || i.status === "SUBMITTED") &&
                  !i.reviewedAt,
              ),
            ),
        ),
      )
      .catch(() => setError("Saved request history is unavailable."));
  }, []);
  const [limit, setLimit] = useState("1.00"),
    [consent, setConsent] = useState(false);
  const [value, setValue] = useState(""),
    [status, setStatus] = useState(browserKeyStatus),
    [error, setError] = useState("");
  useUnsavedChanges(Boolean(value));
  useEffect(() => onBrowserKeyChange(() => setStatus(browserKeyStatus())), []);
  async function connect(event: FormEvent) {
    event.preventDefault();
    try {
      if (!consent || Number(limit) <= 0) throw new Error();
      setBrowserKey(value.trim());
      if (recovery) await resolveAutomaticHolds(true);
      authorizeAutomaticSession(limit, consent);
      setValue("");
      setError("");
      setHasHolds(false);
    } catch {
      setError(
        "Enter a valid key, estimate limit and automatic-processing consent.",
      );
    }
  }
  return (
    <section>
      <h2>Bring your own OpenAI key</h2>
      <p>
        Requests go directly from this browser to OpenAI and are billed to your
        account. Product images and masks stay local; the selected product name,
        category and facts are sent in scene prompts.
      </p>
      <p>
        Your key is kept in this tab’s memory for up to one hour. Refreshing or
        closing the page clears it. Browser extensions or malicious scripts can
        still read it. Use a dedicated project key and set spending limits in
        your OpenAI account.
      </p>
      <p role="status">
        {status.connected
          ? `Key available in this tab until ${status.expiresAt}. It has not been verified with OpenAI.`
          : "No key connected. Set up your key and budget to start uploading."}
      </p>
      <p>
        Each upload starts up to seven image requests automatically, estimated $
        {automaticPlan().estimatedUSD} USD per upload. No automatic retries.
      </p>
      <form onSubmit={connect}>
        {hasHolds && (
          <label>
            <input
              type="checkbox"
              checked={recovery}
              onChange={(e) => setRecovery(e.target.checked)}
            />
            I checked provider billing and waiting periods for interrupted
            requests and authorize new uploads. Previous outcomes remain unknown
            and will not be retried.
          </label>
        )}
        <label>
          OpenAI API key
          <input
            type="password"
            value={value}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label>
          Session estimate limit (USD)
          <input
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I have rights to my uploads and authorize up to seven potentially
          billable image requests per upload within this session estimate limit.
          Estimates are not a hard provider spending cap.
        </label>
        <button
          type="submit"
          disabled={!value.trim() || !consent || (hasHolds && !recovery)}
        >
          Set up session
        </button>
      </form>
      <button
        type="button"
        className="secondary-button"
        disabled={!status.connected}
        onClick={() => {
          clearBrowserKey();
          setValue("");
        }}
      >
        Clear key
      </button>
      {status.connected && (
        <p>
          <Link className="primary-button" to="/">
            Upload a product
          </Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        No automatic retries. A timeout or interrupted request may still be
        charged. Reconnect after a refresh, inspect saved history and provider
        billing before authorizing another attempt.
      </p>
    </section>
  );
}
