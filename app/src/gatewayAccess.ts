// The development gateway's origin restriction is shared by settings and generation.
export function gatewayOriginSupported(): boolean {
  return window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';
}

export const unsupportedGatewayMessage = 'This development gateway works only when the app is opened at http://127.0.0.1 on the same device as the gateway. On a phone, 127.0.0.1 refers to the phone, not your computer. Remote mobile gateway access is not available yet. Projects are stored separately in each browser; downloaded backups are separate files.';
