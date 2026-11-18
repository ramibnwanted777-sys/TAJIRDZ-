/**
 * Account self-service.
 *
 * Only two things live here, and both are about the caller's own credentials:
 * changing the password and reporting whether one is set at all. Anything that
 * touches the marketplace profile belongs to `wholesaler.ts`, which owns the
 * onboarding mutations.
 */

import { action, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import {
  createAccount,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";

import { currentPrincipal } from "./lib/access";
import { validatePassword } from "./lib/security";

/** Provider id registered in `src/convex/auth.ts`. */
const PASSWORD_PROVIDER = "password";

/**
 * Does this account have a password yet?
 *
 * Accounts created with a one-time code have none, and the Account page uses
 * this to offer "set a password" instead of "change password".
 */
export const passwordStatus = query({
  handler: async (ctx) => {
    const principal = await currentPrincipal(ctx);
    if (!principal) return { hasPassword: false };

    const email = principal.doc.email;
    if (!email) return { hasPassword: false };

    // Indexed by user: the caller's own row, so no scan and no chance of
    // matching somebody else's account.
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", principal.userId).eq("provider", PASSWORD_PROVIDER),
      )
      .first();
    return { hasPassword: account !== null };
  },
});

/**
 * Change the caller's own password.
 *
 * An action rather than a mutation: Convex Auth's credential helpers are typed
 * against an action context, and reusing them is the point — there is exactly
 * one implementation of "is this secret right" in the app.
 *
 * Every other session is invalidated afterwards: a password change exists to
 * lock out whoever prompted it, and keeping other sessions alive would defeat
 * that. The session making the change is kept so the user is not thrown out of
 * the page they are on.
 */
export const changePassword = action({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { email } = await ctx.runMutation(api.authGuard.currentCredentialEmail);
    if (!email) throw new Error("errNoEmailOnAccount");

    // Shares the sign-in bucket: a password change is a credential operation,
    // and hammering it should be as hard as hammering sign-in.
    await ctx.runMutation(api.authGuard.chargeAttempt, { kind: "signIn", email });

    // Reject a weak or unchanged new password with the same rules sign-up uses,
    // so an existing password cannot be weakened by "changing" it.
    validatePassword(args.newPassword);

    const { hasPassword } = await ctx.runQuery(api.account.passwordStatus);

    if (!hasPassword) {
      // First password for an account created with an emailed code. There is no
      // secret to confirm — being signed in is the proof of ownership — and
      // `modifyAccountCredentials` cannot be used here because it throws when
      // the account row does not exist yet. `createAccount` links the new
      // credentials account to the user who already owns this verified email.
      await createAccount(ctx, {
        provider: PASSWORD_PROVIDER,
        account: { id: email, secret: args.newPassword },
        profile: { email },
        shouldLinkViaEmail: true,
      });
    } else {
      if (args.newPassword === args.currentPassword) {
        throw new Error("errPasswordUnchanged");
      }

      const verified = await retrieveAccount(ctx, {
        provider: PASSWORD_PROVIDER,
        account: { id: email, secret: args.currentPassword },
      });
      if (!verified) {
        // The client shows one generic message for this, exactly as it does for
        // a wrong password at sign-in.
        throw new Error("errInvalidCredentials");
      }

      await modifyAccountCredentials(ctx, {
        provider: PASSWORD_PROVIDER,
        account: { id: email, secret: args.newPassword },
      });
    }

    await ctx.runAction(api.authGuard.invalidateOtherSessions);

    return { changed: true as const };
  },
});