import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

const unsavedOwners = new Set<symbol>();
export const UNSAVED_CHANGES_EVENT = 'studio-unsaved-changes';

function removeOwner(owner: symbol) {
  if (unsavedOwners.delete(owner)) window.dispatchEvent(new Event(UNSAVED_CHANGES_EVENT));
}

export function hasUnsavedChanges(): boolean {
  return unsavedOwners.size > 0;
}

export function useUnsavedChanges(dirty: boolean): () => void {
  const owner = useRef(Symbol('unsaved-form'));
  useEffect(() => {
    if (!dirty) return;
    unsavedOwners.add(owner.current);
    window.dispatchEvent(new Event(UNSAVED_CHANGES_EVENT));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      removeOwner(owner.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);
  return () => { removeOwner(owner.current); };
}

export function UnsavedNavigationGuard(): null {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && hasUnsavedChanges());
  const handled = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;
    if (window.confirm('Discard unsaved changes?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  return null;
}
