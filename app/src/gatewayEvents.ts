const CHANNEL = 'product-image-studio-gateway';
// Keep the existing marker so older open tabs also invalidate their state.
const INVALIDATE = 'session-revoked';

// Notifications only invalidate local UI state; the gateway remains authoritative.
export function notifyGatewayChanged(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    try { channel.postMessage(INVALIDATE); } finally { channel.close(); }
  } catch { /* Other tabs still enforce the gateway's response. */ }
}

export function onGatewayChanged(invalidate: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => { if (event.data === INVALIDATE) invalidate(); };
    return () => channel.close();
  } catch { return () => {}; }
}
