/**
 * Scroll handling for client-side navigation.
 *
 * react-router keeps the window scroll position between routes, so a shopper
 * who scrolls halfway down a category list and then taps a product lands
 * halfway down the product page. This component restores sane behaviour:
 *
 *  - on a PUSH navigation the window jumps to the top **instantly** (a smooth
 *    scroll would still be animating while the user starts reading), any inner
 *    scroll container is reset, and focus moves to the `<main>` landmark so
 *    screen-reader and keyboard users are actually told the page changed;
 *  - on a POP (back/forward) the offset the user had on that entry is restored,
 *    which is what the browser itself would have done with native history;
 *  - a hash-only change is left alone, so `#faq` anchors still jump;
 *  - in-page state (a filter chip, a tab) never reaches this component, because
 *    it does not change the location at all.
 *
 * Render it once, inside `<BrowserRouter>`.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/**
 * Opt-in marker for scrollable regions that must rewind with the route (the
 * chat thread list, tab panels). Querying for it beats keeping a registry of
 * refs: the containers are rendered by pages that know nothing about this
 * component.
 */
export const ROUTE_SCROLL_ATTRIBUTE = "data-route-scroll";

type Offset = { x: number; y: number };

/**
 * Saved scroll offsets keyed by history entry.
 *
 * Module-level on purpose: it has to outlive the component across a route
 * change, and it is cleared on a fresh load anyway.
 */
const savedOffsets = new Map<string, Offset>();

/** Test seam: forget every saved position. */
export function resetScrollPositionStore(): void {
  savedOffsets.clear();
}

/** Test seam: seed a position for a history entry. */
export function rememberScrollPosition(key: string, offset: Offset): void {
  savedOffsets.set(key, offset);
}

/** The window scroll we should apply: the remembered one, or the top. */
export function offsetForNavigation(
  navigationType: string,
  key: string,
  route: string,
): Offset {
  if (navigationType === "POP") {
    const saved = savedOffsets.get(key);
    if (saved) return saved;
  }
  // A POP that we have never seen (a shared link, a restored tab) is treated as
  // a fresh page rather than being left wherever the previous route was.
  void route;
  return { x: 0, y: 0 };
}

/** Rewind every marked inner scroll container. */
export function resetInnerScrollContainers(root: ParentNode = document): number {
  const nodes = root.querySelectorAll(`[${ROUTE_SCROLL_ATTRIBUTE}]`);
  let reset = 0;
  nodes.forEach((node) => {
    if (node instanceof HTMLElement && node.scrollTop !== 0) {
      node.scrollTop = 0;
      reset += 1;
    }
  });
  return reset;
}

/**
 * Move focus to the page's `<main>` landmark.
 *
 * `tabIndex={-1}` makes the element focusable without adding it to the tab
 * order; the components below already set it. `preventScroll` keeps the focus
 * from undoing the scroll we just applied.
 */
export function focusMainLandmark(root: ParentNode = document): boolean {
  const main = root.querySelector("main");
  if (!(main instanceof HTMLElement)) return false;
  main.focus({ preventScroll: true });
  return main.ownerDocument.activeElement === main;
}

/** Jump the window to `offset` without animation. */
export function scrollWindowTo(offset: Offset): void {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: offset.y, left: offset.x, behavior: "instant" });
}

export function ScrollToTop() {
  const { pathname, search, key } = useLocation();
  const navigationType = useNavigationType();
  const route = `${pathname}${search}`;
  const previousRoute = useRef<string | null>(null);
  const currentKey = useRef(key);

  // Take over from the browser so POP is ours to restore, not a race with
  // native restoration.
  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Remember where the user was on this entry, so back/forward can return it.
  // rAF-throttled so a fling-scroll does not hammer the map.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const save = () => {
      frame = 0;
      savedOffsets.set(currentKey.current, { x: window.scrollX, y: window.scrollY });
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(save);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      save();
    };
  }, []);

  useEffect(() => {
    // First render is the initial page load, not a navigation.
    if (previousRoute.current === null) {
      previousRoute.current = route;
      currentKey.current = key;
      return;
    }
    // Hash-only change: leave the browser's anchor handling alone.
    if (previousRoute.current === route) return;

    // The outgoing entry's offset is deliberately kept: that is exactly what a
    // back navigation to it will restore.
    previousRoute.current = route;
    currentKey.current = key;

    resetInnerScrollContainers();
    scrollWindowTo(offsetForNavigation(navigationType, key, route));
    // Announce the new page to assistive tech. `preventScroll` means this never
    // fights the scroll we just applied.
    focusMainLandmark();
  }, [route, key, navigationType]);

  return null;
}