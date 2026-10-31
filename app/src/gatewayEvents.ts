const CHANNEL = 'product-image-studio-gateway';
const REVOKED = 'session-revoked';

// Notifications only invalidate local UI state; the gateway remains authoritative.
export function notifyGatewayRevoked(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    try { channel.postMessage(REVOKED); } finally { channel.close(); }
  } catch { /* Other tabs still enforce the gateway's response. */ }
}

export function onGatewayRevoked(invalidate: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => { if (event.data === REVOKED) invalidate(); };
    return () => channel.close();
  } catch { return () => {}; }
}
