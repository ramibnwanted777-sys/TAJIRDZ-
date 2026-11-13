/**
 * Subscription expiry sweep.
 *
 * Kept in its own module because it calls back into `billing`: declaring the
 * action next to its callees makes TypeScript infer a self-referential `api`
 * type, which the compiler rejects.
 */

import { action } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { GRACE_PERIOD_DAYS } from "../lib/catalog";
import { DAY_MS } from "./lib/access";

/**
 * Sends renewal reminders 7, 3 and 1 day before expiry plus one during the
 * 3-day grace period, and expires anything past the grace window so its shop
 * disappears from the public feed.
 *
 * Schedule it externally (cron -> this action) in production; it is also
 * callable on demand so the behaviour can be verified.
 */
export const sendExpiryReminders = action({
  args: {},
  // Return type is declared explicitly: inferring it from `ctx.runQuery` makes
  // the module's own type self-referential.
  handler: async (ctx): Promise<{
    checked: number;
    reminders: number;
    expired: number;
  }> => {
    const now = Date.now();
    // `api` is imported lazily inside the handler to avoid a compile-time
    // cycle between this module and the billing module it calls.
    const { api } = await import("./_generated/api");
    const subscriptions: Doc<"subscriptions">[] = await ctx.runQuery(
      api.billing.allActiveSubscriptions,
      {},
    );

    let reminders = 0;
    let expired = 0;

    for (const sub of subscriptions) {
      if (sub.status !== "active") continue;

      const remainingDays = Math.ceil((sub.expiresAt - now) / DAY_MS);
      const pastGrace = now > sub.expiresAt + GRACE_PERIOD_DAYS * DAY_MS;

      if (pastGrace) {
        // Beyond the grace period: flip to expired so the feed hides the shop.
        await ctx.runMutation(api.billing.expireSubscription, {
          subscriptionId: sub._id as Id<"subscriptions">,
        });
        expired++;
        continue;
      }

      const inGrace = now > sub.expiresAt;
      const isReminderDay = remainingDays === 7 || remainingDays === 3 || remainingDays === 1;
      if (!isReminderDay && !inGrace) continue;

      await ctx.runMutation(api.billing.notifyExpiry, {
        subscriptionId: sub._id as Id<"subscriptions">,
        remainingDays,
      });
      reminders++;
    }

    return { checked: subscriptions.length, reminders, expired };
  },
});