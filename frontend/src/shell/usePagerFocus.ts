import { useEffect, useRef } from 'react';

/**
 * Keeps keyboard focus in a list's pager across a page turn. The list keeps its rows and pager mounted while the
 * next page loads; when that page disables the pressed button (the first or last page), focus moves to the pager's
 * other button instead of falling to the document body. `loaded` is the list's current page result.
 */
export function usePagerFocus(loaded: unknown) {
  const pager = useRef<HTMLDivElement>(null);
  const turning = useRef(false);
  useEffect(() => {
    if (!turning.current || !loaded) return;
    turning.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && !(active instanceof HTMLButtonElement && active.disabled)) return;
    pager.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [loaded]);
  return { pager, markTurn: () => { turning.current = true; } };
}
