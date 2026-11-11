import { browserKeyStatus, onBrowserKeyChange } from "./browserByok";
let session: {
  id: string;
  limit: number;
  reserved: number;
  authorized: true;
} | null = null;
export function automaticSessionStatus() {
  return session && browserKeyStatus().connected ? { ...session } : null;
}
export function authorizeAutomaticSession(limit: string, consent: boolean) {
  const n = Number(limit);
  if (
    !consent ||
    !/^\d{1,5}(?:\.\d{1,6})?$/.test(limit) ||
    !Number.isFinite(n) ||
    n <= 0 ||
    n > 1000 ||
    !browserKeyStatus().connected
  )
    throw new Error(
      "Set a session estimate limit and authorize automatic processing.",
    );
  session = {
    id: crypto.randomUUID(),
    limit: Math.round(n * 1e6),
    reserved: 0,
    authorized: true,
  };
  window.dispatchEvent(new Event("studio-auto-session"));
}
export function reserveAutomaticRun(amount: string) {
  const n = Math.round(Number(amount) * 1e6);
  if (
    !session ||
    !browserKeyStatus().connected ||
    !Number.isSafeInteger(n) ||
    n < 1 ||
    session.reserved + n > session.limit
  )
    throw new Error(
      "This upload exceeds your remaining session estimate limit. Update it in Settings before uploading.",
    );
  session.reserved += n;
  window.dispatchEvent(new Event("studio-auto-session"));
  return session.id;
}
if (typeof window !== "undefined")
  onBrowserKeyChange(() => {
    session = null;
    window.dispatchEvent(new Event("studio-auto-session"));
  });
