import { useEffect, useRef, useState } from 'react';
import { hasUnsavedChanges, UNSAVED_CHANGES_EVENT } from './useUnsavedChanges';

type UpdateState = 'idle' | 'waiting' | 'activating' | 'activated-elsewhere' | 'cache-limit' | 'error';

export function useServiceWorker() {
  const [checkingUpdate,setCheckingUpdate]=useState(false);
  const [checkMessage,setCheckMessage]=useState('');
  const manualCheck=useRef(false);
  const [state, setState] = useState<UpdateState>('idle');
  const [blockedByDraft, setBlockedByDraft] = useState(false);
  const [clearingCaches, setClearingCaches] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');
  const [cacheCleanupAvailable, setCacheCleanupAvailable] = useState(true);
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
        requestedUpdate.current = false;
        if (hasUnsavedChanges()) {
          setBlockedByDraft(true);
          setState('activated-elsewhere');
        } else {
          window.location.reload();
        }
      } else if (hadController) {
        setBlockedByDraft(hasUnsavedChanges());
        setState('activated-elsewhere');
      }
      hadController = true;
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SHELL_CACHE_LIMIT') {
        const available = event.data.cleanupAvailable === true;
        setCacheCleanupAvailable(available);
        setCacheMessage(available ? '' : 'This browser cannot safely clear old app caches. Export a backup before changing browser storage.');
        setState('cache-limit');
      }
    };
    const onDraftChange = () => {
      if (!hasUnsavedChanges()) setBlockedByDraft(false);
    };
    const onUpdateFound = () => {
      const worker = current?.installing;
      if (!worker) return;
      const onStateChange = () => {
        if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) {setState('waiting');setCheckMessage('New version available');}
        else if (!disposed && worker.state === 'redundant' && navigator.serviceWorker.controller) {
          setState((old) => old === 'cache-limit' ? old : 'error');
        }
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
    navigator.serviceWorker.addEventListener('message', onMessage);
    window.addEventListener(UNSAVED_CHANGES_EVENT, onDraftChange);
    document.addEventListener('visibilitychange', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then((value) => {
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
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.removeEventListener(UNSAVED_CHANGES_EVENT, onDraftChange);
      document.removeEventListener('visibilitychange', checkForUpdate);
      window.removeEventListener('online', checkForUpdate);
      current?.removeEventListener('updatefound', onUpdateFound);
      for (const [worker, listener] of installingListeners) worker.removeEventListener('statechange', listener);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
    };
  }, []);

  async function checkNow() {
    if(manualCheck.current || requestedUpdate.current)return;
    if(!navigator.onLine){setCheckMessage('Connect to check for updates.');return;}
    const current=registration.current;
    if(!current){setCheckMessage('Updates are unavailable in this session.');return;}
    manualCheck.current=true;setCheckingUpdate(true);setCheckMessage('Checking…');
    try {
      let checkTimer:number|undefined;
      try {await Promise.race([current.update(),new Promise<never>((_,reject)=>{checkTimer=window.setTimeout(()=>reject(new Error('Update check timed out.')),15000)})]);}
      finally {if(checkTimer!==undefined)window.clearTimeout(checkTimer);}
      const worker=current.installing;
      if(worker && worker.state!=='installed' && worker.state!=='redundant'){
        setCheckMessage('Installing update…');
        await new Promise<void>((resolve,reject)=>{
          const done=()=>{if(worker.state==='installed'||worker.state==='redundant'){cleanup();worker.state==='installed'?resolve():reject(new Error('Update installation failed.'))}};
          const timer=window.setTimeout(()=>{cleanup();reject(new Error('Update check timed out.'))},30000);
          const cleanup=()=>{window.clearTimeout(timer);worker.removeEventListener('statechange',done)};
          worker.addEventListener('statechange',done);done();
        });
      }
      if(current.waiting){setState('waiting');setCheckMessage('New version available');}
      else setCheckMessage('No new version found.');
    }catch{setCheckMessage('Update check failed. Try again.');}
    finally{manualCheck.current=false;setCheckingUpdate(false);}
  }

  function updateNow() {
    if(requestedUpdate.current)return;
    if (hasUnsavedChanges()) {
      setBlockedByDraft(true);
      return;
    }
    setBlockedByDraft(false);
    if (state === 'activated-elsewhere' || state === 'error' || state === 'cache-limit') {
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
      if (!requestedUpdate.current) return;
      if (hasUnsavedChanges()) {
        requestedUpdate.current = false;
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        setBlockedByDraft(true);
        setState('waiting');
        return;
      }
      worker.postMessage('SKIP_WAITING');
    }, 100);
  }

  async function clearOldCaches() {
    if (clearingCaches) return;
    if (hasUnsavedChanges()) {
      setBlockedByDraft(true);
      return;
    }
    setBlockedByDraft(false);
    const confirmed = window.confirm('Save your work, close every other app tab (including suspended tabs), and do not deploy while clearing caches. Older or still-loading tabs may stop working. Product data is not deleted. Continue?');
    if (!confirmed || hasUnsavedChanges()) return;
    const controller = navigator.serviceWorker.controller;
    if (!controller || !registration.current) {
      setCacheMessage('The active application worker is unavailable. Reload after saving your work.');
      return;
    }
    const scriptUrl = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!scriptUrl) {
      setCacheMessage('The current app version could not be verified. Reload after saving your work.');
      return;
    }
    setClearingCaches(true);
    setCacheMessage('');
    try {
      const result = await new Promise<{ ok: boolean; message?: string }>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('Cache cleanup timed out.')); }, 10000);
        channel.port1.onmessage = (event: MessageEvent<{ ok: boolean; message?: string }>) => {
          window.clearTimeout(timer); channel.port1.close(); resolve(event.data);
        };
        try { controller.postMessage({ type: 'CLEAR_OLD_SHELL_CACHES', scriptUrl }, [channel.port2]); }
        catch (error) { window.clearTimeout(timer); channel.port1.close(); reject(error); }
      });
      if (!result?.ok) throw new Error(result?.message || 'Old app caches could not be cleared.');
      setState('idle');
      await registration.current.update();
    } catch (error) {
      setCacheMessage(error instanceof Error ? error.message : 'Old app caches could not be cleared.');
      setState('cache-limit');
    } finally {
      setClearingCaches(false);
    }
  }

  return { state, checkNow, checkingUpdate, checkMessage, updateNow, blockedByDraft, clearOldCaches, clearingCaches, cacheMessage, cacheCleanupAvailable };
}
