import { useEffect, useRef, useState } from 'react';

type UpdateState = 'idle' | 'waiting' | 'activating' | 'activated-elsewhere' | 'error';

export function useServiceWorker() {
  const [state, setState] = useState<UpdateState>('idle');
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const requestedUpdate = useRef(false);
  const timeout = useRef<number | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let hadController = Boolean(navigator.serviceWorker.controller);
    let checking = false;
    let current: ServiceWorkerRegistration | null = null;
    const installingListeners = new Map<ServiceWorker, () => void>();

    const onControllerChange = () => {
      if (requestedUpdate.current) {
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        window.location.reload();
      } else if (hadController) {
        setState('activated-elsewhere');
      }
      hadController = true;
    };
    const onUpdateFound = () => {
      const worker = current?.installing;
      if (!worker) return;
      const onStateChange = () => {
        if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) setState('waiting');
      };
      installingListeners.set(worker, onStateChange);
      worker.addEventListener('statechange', onStateChange);
    };
    const checkForUpdate = async () => {
      if (!current || checking || document.visibilityState !== 'visible' || !navigator.onLine) return;
      checking = true;
      try {
        await current.update();
      } catch {
        // A later visit or connection can check again; no update was activated.
      } finally {
        checking = false;
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((value) => {
      if (disposed) return;
      current = value;
      registration.current = value;
      if (value.waiting && navigator.serviceWorker.controller) setState('waiting');
      value.addEventListener('updatefound', onUpdateFound);
      if (value.installing) onUpdateFound();
    }).catch(() => {
      if (!disposed && navigator.onLine) setState('error');
    });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', checkForUpdate);
      window.removeEventListener('online', checkForUpdate);
      current?.removeEventListener('updatefound', onUpdateFound);
      for (const [worker, listener] of installingListeners) worker.removeEventListener('statechange', listener);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
    };
  }, []);

  function updateNow() {
    if (state === 'activated-elsewhere') {
      window.location.reload();
      return;
    }
    const worker = registration.current?.waiting;
    if (!worker) {
      setState('error');
      return;
    }
    requestedUpdate.current = true;
    setState('activating');
    timeout.current = window.setTimeout(() => {
      requestedUpdate.current = false;
      setState('error');
    }, 15000);
    window.setTimeout(() => {
      if (requestedUpdate.current) worker.postMessage('SKIP_WAITING');
    }, 100);
  }

  return { state, updateNow };
}
