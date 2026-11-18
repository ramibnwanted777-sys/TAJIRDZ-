/**
 * Product analytics (PostHog), loaded lazily and switched on by one variable.
 *
 * `VITE_POSTHOG_KEY` is a *project* key (`phc_…`): it ships in the browser by
 * design, so it is not a secret. When it is missing — as it is in a checkout
 * without analytics set up — every function here is a no-op and `posthog-js`
 * is never downloaded, so the bundle and the network stay untouched.
 *
 * The library is imported dynamically for that reason: the analytics chunk is
 * only fetched once a key exists.
 */

type PosthogClient = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
};

let client: PosthogClient | null = null;
let starting: Promise<PosthogClient | null> | null = null;

function projectKey(): string {
  return String(import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
}

function apiHost(): string {
  const configured = String(import.meta.env.VITE_POSTHOG_HOST ?? "").trim();
  return configured || "https://us.i.posthog.com";
}

/** Honour the browser's Do-Not-Track signal: no key, no DNT, no analytics. */
function optedOut(): boolean {
  const dnt =
    typeof navigator !== "undefined" &&
    (navigator.doNotTrack === "1" ||
      (navigator as unknown as { msDoNotTrack?: string }).msDoNotTrack === "1");
  return Boolean(dnt);
}

/** Start the client once. Safe to call on every render. */
export function initAnalytics(): void {
  if (client || starting) return;
  if (!projectKey() || optedOut()) return;

  starting = import("posthog-js")
    .then(({ default: posthog }) => {
      const instance = posthog as unknown as PosthogClient;
      instance.init(projectKey(), {
        api_host: apiHost(),
        // Pageviews are sent by the router so client-side navigation is
        // counted once, not twice.
        capture_pageview: false,
        capture_pageleave: true,
        // Only build person profiles for users who sign in.
        person_profiles: "identified_only",
        persistence: "localStorage",
      });
      client = instance;
      return instance;
    })
    .catch(() => null)
    .finally(() => {
      starting = null;
    }) as Promise<PosthogClient | null>;
}

/** One pageview per route change. */
export function capturePageview(path: string): void {
  if (!client) return;
  client.capture("$pageview", {
    $current_url: `${window.location.origin}${path}`,
  });
}

/** Tie later events to the signed-in account (never the e-mail address). */
export function identifyUser(
  userId: string,
  properties?: Record<string, unknown>,
): void {
  if (!client) return;
  client.identify(userId, properties);
}

/** Called on sign-out so the next person on this device starts clean. */
export function resetAnalytics(): void {
  if (!client) return;
  client.reset();
}
