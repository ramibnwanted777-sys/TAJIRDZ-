/**
 * Scroll handling on route change.
 *
 * Covers the behaviours that are easy to regress and impossible to spot by
 * reading the component: the push jump is instant, a hash-only change is left
 * alone, a back navigation restores the offset the user had, and inner scroll
 * panes are rewound.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { render, cleanup } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
  type NavigateFunction,
} from "react-router";

import {
  ScrollToTop,
  offsetForNavigation,
  resetInnerScrollContainers,
  rememberScrollPosition,
  resetScrollPositionStore,
} from "@/components/ScrollToTop";

/**
 * Captured from the router so the test can drive real navigations. Held in an
 * object rather than a `let` so nothing is reassigned during render.
 */
const nav: { current: NavigateFunction | null } = { current: null };

function Harness() {
  const navigate = useNavigate();
  // Assigned in an effect rather than during render: the test must not depend
  // on a value produced as a side effect of rendering.
  useEffect(() => {
    nav.current = navigate;
  }, [navigate]);
  return (
    <div>
      <main id="landmark" tabIndex={-1}>
        <div id="thread-list" data-route-scroll />
      </main>
    </div>
  );
}

function renderHarness(initial = "/a") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ScrollToTop />
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ScrollToTop", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetScrollPositionStore();
    scrollTo = vi.fn();
    // happy-dom has no layout, so the scroll position is faked. The component
    // only ever reads window.scrollX/scrollY, it never measures anything.
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true });
    Object.defineProperty(window, "scrollX", { value: 0, writable: true });
    Object.defineProperty(window, "scrollY", { value: 0, writable: true });
  });

  afterEach(() => {
    cleanup();
    resetScrollPositionStore();
  });

  it("does not scroll on the initial page load", () => {
    renderHarness();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("jumps instantly to the top on a route change", () => {
    renderHarness();
    act(() => nav.current?.("/b"));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  it("treats a search-param change as a route change", () => {
    renderHarness("/search");
    act(() => nav.current?.("/search?q=phone"));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("leaves a hash-only change alone so anchors keep working", () => {
    renderHarness("/faq");
    act(() => nav.current?.("/faq#refunds"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("moves focus to the main landmark on navigation", () => {
    renderHarness();
    expect(document.activeElement).not.toBe(document.getElementById("landmark"));
    act(() => nav.current?.("/b"));
    expect(document.activeElement).toBe(document.getElementById("landmark"));
  });

  it("restores the remembered offset on back navigation", () => {
    rememberScrollPosition("restored-entry", { x: 0, y: 900 });
    expect(offsetForNavigation("POP", "restored-entry", "/b")).toEqual({ x: 0, y: 900 });
    // A push is a fresh page, whatever was remembered for that key.
    expect(offsetForNavigation("PUSH", "restored-entry", "/b")).toEqual({ x: 0, y: 0 });
    // A POP we never saw (shared link, restored tab) starts at the top.
    expect(offsetForNavigation("POP", "never-seen", "/b")).toEqual({ x: 0, y: 0 });
  });

  it("rewinds inner scroll containers and leaves other elements alone", () => {
    const marked = document.createElement("div");
    marked.setAttribute("data-route-scroll", "");
    marked.scrollTop = 120;

    const untouched = document.createElement("div");
    untouched.scrollTop = 80;

    const root = document.createElement("div");
    root.append(marked, untouched);

    expect(resetInnerScrollContainers(root)).toBe(1);
    expect(marked.scrollTop).toBe(0);
    expect(untouched.scrollTop).toBe(80);
  });
});