/**
 * Vitest setup.
 *
 * React 19 only applies `act` semantics when the environment opts in, and the
 * component tests drive navigations by hand, so the flag has to be set before
 * anything renders.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The language provider reads a stored preference; an empty store must fall
// back to the default without touching a DOM API happy-dom lacks.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export {};