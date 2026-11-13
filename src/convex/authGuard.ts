/**
 * Abuse limits for the credential flows.
 *
 * `chargeAttempt` is called by the UI immediately before it hands credentials
 * to Convex Auth, so the wait is enforced before the request that would leak
 * information or burn a code is even sent, and the error can say exactly how
 * long the caller has to wait.
 *
 * Known limitation, stated rather than hidden: the guard lives beside the auth
 * call rather than inside it, because Convex Auth's `profile` callback must be
 * synchronous and its action context has no database handle, so there is no
 * hook that a direct call to the auth action cannot skip. The counters still
 * make automated guessing impractical for anything going through the app.
 */

import { action, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

import {
  getAuthSessionId,
  getAuthUserId,
  invalidateSessions,
} from "@convex-dev/auth/server";

import { clearAuthGuard, consumeAuthGuard } from "./lib/authGuard";
import type { AuthGuardKind } from "./lib/authGuard";
import { requireUser } from "./lib/access";
import { normalizeEmail } from "./lib/security";

const kindValidator = v.union(
  v.literal("signIn"),
  v.literal("signUp"),
  v.literal("resetRequest"),
  v.literal("resetVerify"),
  v.literal("emailVerify"),
);

/** Charge one attempt. Throws `errAuthGuard:<kind>:<minutes>` when exhausted. */
export const chargeAttempt = mutation({
  args: { kind: kindValidator, email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) return;
    await consumeAuthGuard(ctx, args.kind as AuthGuardKind, email);
  },
});

/**
 * Drop the failed-sign-in counter once the caller has proved they hold the
 * account, so five typos do not lock someone out after the sixth correct try.
 *
 * Only ever clears the caller's own address, so it cannot be used to un-lock
 * somebody else's account.
 */
export const clearSignInLockout = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { cleared: false };

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user?.email) return { cleared: false };
    if (normalizeEmail(user.email) !== normalizeEmail(args.email)) {
      return { cleared: false };
    }

    await clearAuthGuard(ctx, "signIn", args.email);
    return { cleared: true };
  },
});
/**
 * The caller's own email address, read inside a mutation.
 *
 * The password change runs as an action (Convex Auth's credential helpers
 * require one) and an action context in this Convex version cannot read the
 * database directly, so the identity hop happens here.
 */
export const currentCredentialEmail = mutation({
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    return { email: principal.doc.email ?? null };
  },
});

/**
 * Sign every session of the caller out except the one making the request.
 *
 * Called after a password change: the point of changing a password is to lock
 * out whoever prompted it, but keeping the current session means the person who
 * made the change is not thrown off the page they are on.
 */
export const invalidateOtherSessions = action({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { revoked: false };

    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, {
      userId,
      except: sessionId ? [sessionId] : [],
    });
    return { revoked: true };
  },
});
