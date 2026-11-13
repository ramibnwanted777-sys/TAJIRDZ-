/**
 * Reviews that cannot be faked.
 *
 * The rules are enforced here, not in the UI:
 *  - only a retailer who has a *logged contact* about that exact product,
 *  - only after the 48-hour delay,
 *  - only once per product,
 *  - never a self-review,
 *  - a wholesaler may reply publicly exactly once and can never delete a review.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

import { cleanText, containsLinkOrPhone } from "../lib/catalog";
import {
  checkReviewEligibility,
  detectSuspiciousReviews,
  enforceRateLimit,
  notify,
  refreshProductReviewStats,
  refreshShopRatingSummary,
  requireRole,
  requireUser,
} from "./lib/access";

export const submitReview = mutation({
  args: {
    productId: v.id("products"),
    productRating: v.number(),
    sellerRating: v.number(),
    comment: v.optional(v.string()),
    photoStorageId: v.optional(v.string()),
    claimedPurchase: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "review", { userId: principal.userId });

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("errNotFound");

    // Re-check on write, never trust a client-side "canReview" flag.
    const eligibility = await checkReviewEligibility(ctx, args.productId, principal);
    if (!eligibility.ok) throw new Error(`errReview:${eligibility.reason}`);

    if (args.productRating < 1 || args.productRating > 5) throw new Error("errRatingRange");
    if (args.sellerRating < 1 || args.sellerRating > 5) throw new Error("errRatingRange");

    const comment = args.comment ? cleanText(args.comment, 800) : undefined;
    if (comment && containsLinkOrPhone(comment)) throw new Error("errNoLinksInPublicText");

    const contact = await ctx.db
      .query("contactLogs")
      .withIndex("by_retailer_product", (q) =>
        q.eq("retailerId", principal.userId).eq("productId", product._id),
      )
      .first();

    const reviewId = await ctx.db.insert("reviews", {
      productId: product._id,
      shopId: product.shopId,
      retailerId: principal.userId,
      productRating: Math.round(args.productRating),
      sellerRating: Math.round(args.sellerRating),
      comment,
      photoStorageId: args.photoStorageId,
      claimedPurchase: args.claimedPurchase ?? false,
      // Proven, not self-declared: a matching contact log exists.
      verifiedContact: contact !== null,
      status: "visible",
      createdAt: Date.now(),
    });

    const review = await ctx.db.get(reviewId);
    if (review) {
      const suspicion = await detectSuspiciousReviews(ctx, review);
      if (suspicion.suspicious) {
        await ctx.db.patch(reviewId, {
          flaggedSuspicious: true,
          suspicionReason: suspicion.reason,
        });
      }
    }

    // Winning badge and shop rating both derive from this write.
    await refreshProductReviewStats(ctx, product._id);
    await refreshShopRatingSummary(ctx, product.shopId);

    await notify(ctx, {
      userId: product.ownerId,
      type: "review",
      title: "تقييم جديد",
      body: `${product.name} — ${Math.round(args.productRating)}/5`,
      link: "/dashboard/reviews",
      dedupeKey: `review:${reviewId}`,
    });

    return { reviewId };
  },
});

/** Wholesaler replies publicly — exactly one reply per review. */
export const replyToReview = mutation({
  args: { reviewId: v.id("reviews"), reply: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("errNotFound");

    const shop = await ctx.db.get(review.shopId);
    if (!shop || shop.ownerId !== principal.userId) throw new Error("errNotAuthorized");
    if (review.reply !== undefined) throw new Error("errAlreadyReplied");

    const reply = cleanText(args.reply, 500);
    if (!reply) throw new Error("errRequired");
    if (containsLinkOrPhone(reply)) throw new Error("errNoLinksInPublicText");

    await ctx.db.patch(review._id, { reply, repliedAt: Date.now() });
    await notify(ctx, {
      userId: review.retailerId,
      type: "review",
      title: "رد من التاجر على تقييمك",
      body: reply.slice(0, 120),
      link: `/product/${(await ctx.db.get(review.productId))?.slug ?? ""}`,
      dedupeKey: `reply:${review._id}`,
    });

    return { ok: true };
  },
});

/** Anyone may report an abusive review; admins moderate the queue. */
export const reportReview = mutation({
  args: {
    reviewId: v.id("reviews"),
    reason: v.union(
      v.literal("scam"),
      v.literal("abuse"),
      v.literal("fake_review"),
      v.literal("counterfeit"),
      v.literal("spam"),
      v.literal("other"),
    ),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "report", { userId: principal.userId });

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("errNotFound");

    await ctx.db.insert("reports", {
      reporterId: principal.userId,
      targetType: "review",
      targetId: review._id,
      reason: args.reason,
      details: args.details ? cleanText(args.details, 600) : undefined,
      status: "open",
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Retailer's own review inbox for a product. */
export const myReviewForProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const review = await ctx.db
      .query("reviews")
      .withIndex("by_product_retailer", (q) =>
        q.eq("productId", args.productId).eq("retailerId", principal.userId),
      )
      .first();
    if (!review) return null;
    return {
      id: review._id,
      productRating: review.productRating,
      sellerRating: review.sellerRating,
      comment: review.comment ?? null,
      reply: review.reply ?? null,
      createdAt: review.createdAt,
      status: review.status,
    };
  },
});

/**
 * Eligibility + the exact reason when it is denied, so the UI can explain the
 * 48-hour rule instead of showing a dead button.
 */
export const reviewEligibility = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const eligibility = await checkReviewEligibility(ctx, args.productId, principal);
    const contact = await ctx.db
      .query("contactLogs")
      .withIndex("by_retailer_product", (q) =>
        q.eq("retailerId", principal.userId).eq("productId", args.productId),
      )
      .first();

    let hoursUntilEligible = 0;
    if (contact) {
      const elapsedMs = Date.now() - contact.createdAt;
      hoursUntilEligible = Math.max(0, Math.ceil((48 * 3600_000 - elapsedMs) / 3600_000));
    }

    return {
      ...eligibility,
      hoursUntilEligible,
      contactedAt: contact?.createdAt ?? null,
    };
  },
});

/** Wholesaler review inbox with unanswered/unreplied state. */
export const shopReviews = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) return [];

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
      .collect();

    const out = [];
    for (const r of reviews.sort((a, b) => b.createdAt - a.createdAt)) {
      const product = await ctx.db.get(r.productId);
      const retailer = await ctx.db.get(r.retailerId);
      out.push({
        id: r._id,
        productId: r.productId,
        productName: product?.name ?? "منتج",
        productSlug: product?.slug ?? "",
        productRating: r.productRating,
        sellerRating: r.sellerRating,
        comment: r.comment ?? null,
        verifiedContact: r.verifiedContact,
        claimedPurchase: r.claimedPurchase ?? false,
        reply: r.reply ?? null,
        canReply: r.reply === undefined,
        status: r.status,
        createdAt: r.createdAt,
        reviewerName: retailer?.name ?? "بائع",
      });
    }
    return out;
  },
});

export { refreshProductReviewStats };
export type { Id };