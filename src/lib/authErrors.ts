/**
 * One place that turns an auth failure into a sentence.
 *
 * Every credential surface (sign-in, sign-up, verification, reset, change
 * password) funnels through this so they cannot drift apart, and — more
 * importantly — so they all collapse unknown failures into the same generic
 * message. A form that distinguishes "no such account" from "wrong password"
 * is an account-enumeration oracle.
 */

import { interpolate, type Dict } from "@/lib/i18n";
import { parseAuthGuardError } from "@/convex/lib/authGuard";

/**
 * @param fallback the generic sentence to show for anything unrecognised.
 */
export function authErrorText(error: unknown, t: Dict, fallback: string): string {
  const message = error instanceof Error ? error.message : "";

  // A rate-limit / lockout carries the wait, so the user knows when to come back.
  const guard = parseAuthGuardError(message);
  if (guard) return interpolate(t.authLockout, { minutes: guard.minutes });

  // Password policy failures are safe to name: they say nothing about whether
  // the address exists.
  if (message === "errPasswordTooShort") return t.errPasswordTooShort;
  if (message === "errPasswordTooLong") return t.errPasswordTooLong;
  if (message === "errPasswordTooWeak") return t.errPasswordTooWeak;
  if (message === "errRateLimited") return t.errRateLimited;

  return fallback;
}