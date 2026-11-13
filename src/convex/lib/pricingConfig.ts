/**
 * The live pricing config, read the same way from every convex function.
 *
 * `pricing.get` exposes it to the client; this is the server-side twin, so a
 * mutation that has to quote a price (a promo redemption, a renewal) reads the
 * *same* numbers the page showed instead of the shipped defaults.
 *
 * A missing or corrupt row falls back to `DEFAULT_PRICING` rather than
 * throwing: pricing is not worth taking a payment flow down for.
 */

import type { QueryCtx } from "../_generated/server";
import {
  DEFAULT_PRICING,
  pricingFromRaw,
  type PricingConfig,
} from "../../lib/pricing";

/** The pricing row is written under this key in `appConfig`. */
export const PRICING_KEY = "pricing";

/** Only `db` is needed, so a query and a mutation context both qualify. */
type Ctx = Pick<QueryCtx, "db">;

export async function readPricing(ctx: Ctx): Promise<PricingConfig> {
  const row = await ctx.db
    .query("appConfig")
    .withIndex("by_key", (q) => q.eq("key", PRICING_KEY))
    .first();
  if (!row) return DEFAULT_PRICING;

  const value = row.value as unknown;
  if (typeof value !== "string") return pricingFromRaw(value);
  try {
    return pricingFromRaw(JSON.parse(value));
  } catch {
    return DEFAULT_PRICING;
  }
}
