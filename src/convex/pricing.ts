/**
 * Runtime pricing override.
 *
 * The defaults live in `src/lib/pricing.ts`; this module lets an admin replace
 * them at run time through the `appConfig` table (key `pricing`) without a
 * deploy. Readers never see a partial blob: `pricingFromRaw` rebuilds the
 * config field by field, so an interrupted edit cannot blank the page.
 *
 * Reading is deliberately public — every visitor needs to see a price before
 * signing in. Writing is admin-only.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

import { pricingFromRaw, PRICING_VERSION } from "../lib/pricing";
import type { PricingConfig } from "../lib/pricing";
import { requireAdmin, audit } from "./lib/access";
import { cleanText } from "../lib/catalog";
// One config row in `appConfig`, keyed so a future key cannot collide. Shared
// with the server-side reader so both look at the same row.
import { PRICING_KEY } from "./lib/pricingConfig";

/** Re-validated server-side: an admin could otherwise store a negative price. */
const pricingValidator = v.object({
  version: v.number(),
  wholesaler: v.object({
    basic: v.object({
      monthly: v.number(),
      yearly: v.number(),
      features: v.array(v.string()),
    }),
    pro: v.object({
      monthly: v.number(),
      yearly: v.number(),
      features: v.array(v.string()),
    }),
  }),
  retailer: v.object({
    freeContactsPerMonth: v.number(),
    plus: v.object({
      monthly: v.number(),
      quarterly: v.number(),
      yearly: v.number(),
      features: v.array(v.string()),
    }),
  }),
  boost: v.object({
    perWeek: v.number(),
    durationDays: v.number(),
  }),
  vip: v.object({
    basicSlots: v.number(),
    proSlots: v.number(),
  }),
  promo: v.object({
    code: v.string(),
    maxUsers: v.number(),
    freeMonths: v.number(),
  }),
});

/**
 * Clamp a price into a sane range so a typo in the admin form cannot publish
 * a free plan or a hundred-thousand-dinar one by accident.
 */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

/** Round-trip through the shared normaliser after clamping. */
function sanitise(input: unknown): PricingConfig {
  const raw = (input ?? {}) as PricingConfig;
  const build = pricingFromRaw({
    ...raw,
    wholesaler: {
      basic: { ...raw.wholesaler?.basic, monthly: clamp(raw.wholesaler?.basic?.monthly ?? 0, 1_000_000), yearly: clamp(raw.wholesaler?.basic?.yearly ?? 0, 1_000_000) },
      pro: { ...raw.wholesaler?.pro, monthly: clamp(raw.wholesaler?.pro?.monthly ?? 0, 1_000_000), yearly: clamp(raw.wholesaler?.pro?.yearly ?? 0, 1_000_000) },
    },
    retailer: {
      freeContactsPerMonth: clamp(raw.retailer?.freeContactsPerMonth ?? 0, 1000),
      plus: {
        monthly: clamp(raw.retailer?.plus?.monthly ?? 0, 1_000_000),
        quarterly: clamp(raw.retailer?.plus?.quarterly ?? 0, 1_000_000),
        yearly: clamp(raw.retailer?.plus?.yearly ?? 0, 1_000_000),
        features: raw.retailer?.plus?.features,
      },
    },
    boost: {
      perWeek: clamp(raw.boost?.perWeek ?? 0, 1_000_000),
      durationDays: clamp(raw.boost?.durationDays ?? 0, 365),
    },
    // Slots are a plan benefit, not a price: 0 would silently take VIP away
    // from every subscriber on an interrupted form, so the floor is 1.
    vip: {
      basicSlots: Math.max(1, clamp(raw.vip?.basicSlots ?? 1, 100)),
      proSlots: Math.max(1, clamp(raw.vip?.proSlots ?? 5, 100)),
    },
    promo: {
      code: raw.promo?.code,
      maxUsers: clamp(raw.promo?.maxUsers ?? 0, 100_000),
      freeMonths: clamp(raw.promo?.freeMonths ?? 0, 120),
    },
  });
  return { ...build, version: PRICING_VERSION };
}

/**
 * Public: the whole site shows prices, signed in or not.
 *
 * `readPricing` in ./lib/pricingConfig.ts is the server-side twin of this
 * query. Both go through `pricingFromRaw`, so a mutation that has to quote a
 * price can never disagree with the page the user just read.
 */
export const get = query({
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", PRICING_KEY))
      .first();

    const value = (row?.value ?? null) as unknown;
    if (!value) return { pricing: null, isDefault: true };

    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        // A half-written blob must not take the pricing page with it.
        return { pricing: null, isDefault: true };
      }
    }
    return { pricing: sanitise(parsed), isDefault: false };
  },
});

/** Admin only: write the whole config as JSON. */
export const set = mutation({
  args: { pricing: pricingValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const value = JSON.stringify(sanitise(args.pricing));

    const existing = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", PRICING_KEY))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("appConfig", {
        key: PRICING_KEY,
        value,
        updatedAt: Date.now(),
      });
    }

    const principal = await requireAdmin(ctx);
    await audit(ctx, {
      actorId: principal.userId,
      action: "pricing.updated",
      targetType: "config",
      targetId: PRICING_KEY,
      details: cleanText(value, 500),
    });
    return { ok: true };
  },
});

/** Admin only: drop the override and go back to the shipped defaults. */
export const reset = mutation({
  handler: async (ctx) => {
    const principal = await requireAdmin(ctx);
    const existing = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", PRICING_KEY))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await audit(ctx, {
      actorId: principal.userId,
      action: "pricing.reset",
      targetType: "config",
      targetId: PRICING_KEY,
    });
    return { ok: true };
  },
});