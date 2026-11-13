/**
 * Abuse limits for the credential flows.
 *
 * These are charged from inside the Convex Auth `Password` provider's `profile`
 * callback, which runs for *every* flow (signUp, signIn, reset,
 * reset-verification, email-verification) before any credential is checked.
 * That placement is what makes them unbypassable: a caller that invokes the
 * Convex Auth action directly still has to pass through here, because the
 * provider builds its profile before it looks at a password or a code.
 *
 * State reuses the `rateLimits` table (`key`, `count`, `windowStart`) rather
 * than adding a table of its own: the shape is exactly a fixed window, and a
 * second table would only create a second place for a limit to drift.
 *
 * The error message carries the wait so the client can render a real
 * "try again in X minutes" instead of a vague failure:
 *
 *     errAuthGuard:<kind>:<minutes>
 */

import type { MutationCtx } from "../_generated/server";

import { normalizeEmail } from "./security";

export type AuthGuardKind =
  /** Password sign-in attempts. */
  | "signIn"
  /** Account creations. */
  | "signUp"
  /** "Send me a reset code" requests, which is the 60s resend cooldown. */
  | "resetRequest"
  /** Guesses at the 6-digit reset code. */
  | "resetVerify"
  /** Guesses at the 6-digit new-account verification code. */
  | "emailVerify";

export type AuthGuardRule = {
  /** Attempts allowed inside one window. */
  limit: number;
  /** Length of the window; exhausting it locks the bucket for this long. */
  windowMs: number;
};

/**
 * Tuned to the product brief:
 *  - 5 password attempts, then a 15 minute lock;
 *  - 5 attempts at any 6-digit code;
 *  - one reset email per 60 seconds, which is the resend cooldown;
 *  - reset codes (and their window) are 10 minutes, matching the token TTL.
 */
export const AUTH_GUARD_RULES: Record<AuthGuardKind, AuthGuardRule> = {
  signIn: { limit: 5, windowMs: 15 * 60 * 1000 },
  signUp: { limit: 5, windowMs: 60 * 60 * 1000 },
  resetRequest: { limit: 1, windowMs: 60 * 1000 },
  resetVerify: { limit: 5, windowMs: 10 * 60 * 1000 },
  emailVerify: { limit: 5, windowMs: 10 * 60 * 1000 },
};

export class AuthGuardError extends Error {
  readonly kind: AuthGuardKind;
  /** Whole minutes the caller must wait, rounded up. Never below 1. */
  readonly retryMinutes: number;

  constructor(kind: AuthGuardKind, retryMinutes: number) {
    super(`errAuthGuard:${kind}:${retryMinutes}`);
    this.kind = kind;
    this.retryMinutes = retryMinutes;
    this.name = "AuthGuardError";
  }
}

/** Bucket key. Email-scoped on purpose: the threat is credential guessing. */
export function authGuardKey(kind: AuthGuardKind, email: string): string {
  return `authguard:${kind}:${normalizeEmail(email)}`;
}

/**
 * Count one attempt against `kind` for `email`, or throw if the bucket is
 * exhausted.
 *
 * Mutations run serizably, so the read-modify-write cannot interleave with
 * another guess: two simultaneous attempts cannot both slip past the limit.
 */
export async function consumeAuthGuard(
  ctx: MutationCtx,
  kind: AuthGuardKind,
  email: string,
  now: number = Date.now(),
): Promise<void> {
  const rule = AUTH_GUARD_RULES[kind];
  const key = authGuardKey(kind, email);
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  // No bucket, or the previous window has expired: start a fresh one.
  if (!existing || now - existing.windowStart >= rule.windowMs) {
    if (existing) await ctx.db.patch(existing._id, { count: 1, windowStart: now });
    else await ctx.db.insert("rateLimits", { key, count: 1, windowStart: now });
    return;
  }

  if (existing.count >= rule.limit) {
    const waitMs = existing.windowStart + rule.windowMs - now;
    throw new AuthGuardError(kind, Math.max(1, Math.ceil(waitMs / 60_000)));
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}

/**
 * Forget the counter for a bucket.
 *
 * Called after a *successful* sign-in so a user who fumbled a few times is not
 * left locked after they finally typed the right password. The caller is
 * responsible for proving the address belongs to them first.
 */
export async function clearAuthGuard(
  ctx: MutationCtx,
  kind: AuthGuardKind,
  email: string,
): Promise<void> {
  const key = authGuardKey(kind, email);
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (existing) await ctx.db.delete(existing._id);
}

/**
 * Map a Convex Auth flow name onto the bucket that must be charged for it.
 *
 * Unknown flows return null so a future provider flow is not silently throttled
 * under the wrong rule.
 */
export function guardKindForFlow(flow: string): AuthGuardKind | null {
  switch (flow) {
    case "signUp":
      return "signUp";
    case "signIn":
      return "signIn";
    case "reset":
      return "resetRequest";
    case "reset-verification":
      return "resetVerify";
    case "email-verification":
      return "emailVerify";
    default:
      return null;
  }
}

/** Pull the wait back out of an `errAuthGuard:...` message, if it is one. */
export function parseAuthGuardError(message: string): { minutes: number } | null {
  const match = /^errAuthGuard:\w+:(\d+)$/.exec(message);
  if (!match) return null;
  return { minutes: Number(match[1]) };
}