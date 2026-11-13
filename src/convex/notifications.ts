/**
 * Notification centre, favourites/compare lists, and the report queue.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

import { cleanText } from "../lib/catalog";
import {
  audit,
  bumpDailyStat,
  categoryLabelOf,
  enforceRateLimit,
  notify,
  requireUser,
  wilayaLabelOf,
} from "./lib/access";
import { shouldAutoHideVip } from "../lib/vip";

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------

/** No-op so signed-out callers can skip the unread-count subscription. */
export const skipCount = query({
  args: {},
  handler: async () => 0,
});

export const myNotifications = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .map((n) => ({
        id: n._id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      }));
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .collect();
    return rows.filter((n) => n.readAt === undefined).length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const n = await ctx.db.get(args.notificationId);
    if (!n || n.userId !== principal.userId) throw new Error("errNotAuthorized");
    await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    return { ok: true };
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .collect();
    for (const n of rows) {
      if (n.readAt === undefined) await ctx.db.patch(n._id, { readAt: Date.now() });
    }
    return { ok: true };
  },
});

export const myPrefs = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const prefs = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .first();
    return prefs ?? {
      types: [] as string[],
      inApp: true,
      push: false,
      email: false,
    };
  },
});

export const savePrefs = mutation({
  args: {
    types: v.array(v.string()),
    inApp: v.boolean(),
    push: v.boolean(),
    email: v.boolean(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const existing = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .first();
    const payload = {
      userId: principal.userId,
      types: args.types,
      inApp: args.inApp,
      push: args.push,
      email: args.email,
    };
    if (existing) await ctx.db.patch(existing._id, payload);
    else await ctx.db.insert("notificationPrefs", payload);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Favourites & compare
// ---------------------------------------------------------------------------

export const myFavorites = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .collect();
    favorites.sort((a, b) => b.createdAt - a.createdAt);

    const out = [];
    for (const f of favorites) {
      const product = await ctx.db.get(f.productId);
      if (!product) continue;
      const shop = await ctx.db.get(product.shopId);
      if (!shop) continue;
      const priceDropped = product.wholesalePriceDa < f.priceAtFavoriteDa;
      out.push({
        favoriteId: f._id,
        productId: product._id,
        slug: product.slug,
        name: product.name,
        imageStorageIds: product.imageStorageIds,
        currentPriceDa: product.wholesalePriceDa,
        priceAtFavoriteDa: f.priceAtFavoriteDa,
        priceDropped,
        minQty: product.minQty,
        stockStatus: product.stockStatus,
        isWinning: product.isWinning,
        shopName: shop.name,
        wilayaLabel: wilayaLabelOf(shop.wilaya),
        categoryLabel: categoryLabelOf(product.category),
        createdAt: f.createdAt,
      });
    }
    return out;
  },
});

/**
 * Side-by-side comparison payload: price, min qty, rating, wilaya, delivery.
 * Prices are normalised to the *effective* unit price at a comparable qty so
 * two products are not compared at different tier levels.
 */
export const compareProducts = query({
  args: { productIds: v.array(v.id("products")) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const out = [];
    for (const id of args.productIds.slice(0, 3)) {
      const product = await ctx.db.get(id);
      if (!product) continue;
      const shop = await ctx.db.get(product.shopId);
      if (!shop) continue;

      // Effective price = best tier price if tiers exist, else base price.
      const bestTier = product.priceTiers.reduce<number | null>(
        (best, t) => (best === null || t.priceDa < best ? t.priceDa : best),
        null,
      );
      out.push({
        productId: product._id,
        slug: product.slug,
        name: product.name,
        imageStorageIds: product.imageStorageIds,
        wholesalePriceDa: product.wholesalePriceDa,
        effectivePriceDa: bestTier ?? product.wholesalePriceDa,
        minQty: product.minQty,
        priceTiers: product.priceTiers,
        stockStatus: product.stockStatus,
        avgProductRating: product.avgProductRating,
        reviewCount: product.reviewCount,
        isWinning: product.isWinning,
        wilayaLabel: wilayaLabelOf(shop.wilaya),
        shopName: shop.name,
        shopVerified: shop.verification === "approved",
        shopRating: shop.ratingSummary?.overall ?? 0,
        deliveryOptions: shop.deliveryOptions,
        prepDays: shop.avgPrepDays,
      });
    }
    return out;
  },
});

/**
 * Record a deliberate favourite tap. Kept separate from the toggle so the
 * favourites trend counts interest, not idempotent re-clicks.
 */
export const trackFavorite = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) return { ok: false };
    await bumpDailyStat(ctx, product._id, "favorites");
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Reports & abuse
// ---------------------------------------------------------------------------

export const reportContent = mutation({
  args: {
    targetType: v.union(
      v.literal("product"),
      v.literal("shop"),
      v.literal("review"),
      v.literal("message"),
      v.literal("user"),
    ),
    targetId: v.string(),
    reason: v.union(
      v.literal("scam"),
      v.literal("abuse"),
      v.literal("fake_review"),
      v.literal("counterfeit"),
      v.literal("spam"),
      v.literal("leaked_product"),
      v.literal("harassment"),
      v.literal("other"),
    ),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "report", { userId: principal.userId });

    await ctx.db.insert("reports", {
      reporterId: principal.userId,
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason,
      details: args.details ? cleanText(args.details, 600) : undefined,
      status: "open",
      createdAt: Date.now(),
    });

    // Three distinct reporters hide a VIP teaser before an admin reaches the
    // queue: the listing stops being public the moment the crowd agrees, and
    // stays hidden until a human restores it.
    let autoHidden = false;
    if (args.targetType === "product") {
      const productId = ctx.db.normalizeId("products", args.targetId);
      const product = productId ? await ctx.db.get(productId) : null;
      if (productId && product && product.visibility === "vip" && !product.isPaused) {
        const open = await ctx.db
          .query("reports")
          .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
          .collect();
        const reporters = open
          .filter((row) => row.status === "open")
          .map((row) => row.reporterId ?? null);
        if (shouldAutoHideVip(reporters)) {
          autoHidden = true;
          await ctx.db.patch(productId, { isPaused: true, updatedAt: Date.now() });
          await audit(ctx, {
            actorId: principal.userId,
            action: "vip.auto_hidden",
            targetType: "product",
            targetId: productId,
            details: `auto-hidden after report: ${args.reason}`,
          });
          await notify(ctx, {
            userId: product.ownerId,
            type: "vip",
            title: "تم إيقاف عرض VIP للمراجعة",
            body: "وصلتنا شكاوى متعددة على هاد العرض، توقف مؤقتاً حتى تراجعو الإدارة.",
            link: "/dashboard/vip",
            dedupeKey: "/dashboard/vip",
          });
        }
      }
    }
    return { ok: true, autoHidden };
  },
});

export const myReports = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const rows = await ctx.db
      .query("reports")
      .collect();
    return rows
      .filter((r) => r.reporterId === principal.userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((r) => ({
        id: r._id,
        targetType: r.targetType,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
      }));
  },
});

/** Support ticket from the contact page. */
export const submitSupportTicket = mutation({
  args: { subject: v.string(), body: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "support", { userId: principal.userId });
    const subject = cleanText(args.subject, 140);
    const body = cleanText(args.body, 2000);
    if (!subject || !body) throw new Error("errRequired");
    return ctx.db.insert("supportTickets", {
      userId: principal.userId,
      subject,
      body,
      email: cleanText(args.email, 120),
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export { notify };
export type { Id };