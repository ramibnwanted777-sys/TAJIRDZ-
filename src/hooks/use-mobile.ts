import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Viewport width as a subscription rather than mirrored state.
 *
 * The previous version wrote `window.innerWidth` into state from an effect,
 * which fires an extra render on mount and can flash the desktop layout first.
 * `useSyncExternalStore` reads the current value during render and re-reads it
 * when the media query changes, so the first paint is already correct.
 *
 * The server snapshot is `false`: this is a client-only Vite app, but the
 * third argument keeps the hook safe if it is ever rendered during SSR.
 */
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(query).matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
