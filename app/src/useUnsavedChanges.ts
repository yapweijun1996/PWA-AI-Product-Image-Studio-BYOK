import { useEffect } from 'react';

const unsavedOwners = new Set<symbol>();

export function hasUnsavedChanges(): boolean {
  return unsavedOwners.size > 0;
}

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const owner = Symbol('unsaved-form');
    unsavedOwners.add(owner);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const link = target instanceof Element ? target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      if (!window.confirm('Discard unsaved changes?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigation, true);
    return () => {
      unsavedOwners.delete(owner);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeNavigation, true);
    };
  }, [dirty]);
}
