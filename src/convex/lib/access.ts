/**
 * Shared server-side guards and domain logic.
 *
 * Everything that decides "may this caller see or do X" lives here so the rule
 * is implemented once. The WhatsApp rule in particular must never live only in
 * the UI: `publicShopFields` is the single serializer used by every public read,
 * so an entitled field cannot leak by being added to one query and forgotten
 * in another.
 */

import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

import { isAdminEmail } from "./security";

import {
  BOOST_DURATION_DAYS,
  GRACE_PERIOD_DAYS,
  PLAN_LIMITS,
  REVIEW_DELAY_HOURS,
  computeWinning,
  normalizeArabic,
  cleanText,
  categoryLabel,
  wilayaName,
} from "../../lib/catalog";

// ---------------------------------------------------------------------------
// Current principal
// ---------------------------------------------------------------------------

export type Principal = {
  userId: Id<"users">;
  doc: Doc<"users">;
  role: "admin" | "wholesaler" | "retailer";
  shop: Doc<"shops"> | null;
};

export class AuthError extends Error {}

/**
 * Resolve the caller. Returns null instead of throwing when signed out so
 * public queries can stay open; mutations use `requireUser`.
 */
export async function currentPrincipal(
  ctx: QueryCtx | MutationCtx,
): Promise<Principal | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const doc = await ctx.db.get(userId);
  if (doc === null) return null;

  const role = doc.role ?? "retailer";
  const shop =
    role === "wholesaler"
      ? await ctx.db
          .query("shops")
          .withIndex("by_owner", (q) => q.eq("ownerId", userId))
          .first()
      : null;

  return { userId, doc, role, shop };
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Principal> {
  const principal = await currentPrincipal(ctx);
  if (!principal) throw new AuthError("errNotSignedIn");
  await syncAdminRole(ctx, principal);
  if (principal.doc.suspended) throw new AuthError("errNotAuthorized");
  return principal;
}

/**
 * The whole admin-promotion rule, as one pure predicate.
 *
 * Kept separate from the write so it can be tested directly: the security
 * property that matters is that an address on the allowlist is NOT enough,
 * the address also has to have been proven with a code.
 */
export function shouldPromoteToAdmin(
  principal: Pick<Principal, "role"> & {
    doc: Pick<Doc<"users">, "email" | "emailVerificationTime">;
  },
  /** Injectable so the rule can be tested without the deployment env var. */
  isAllowed: (email: string | undefined) => boolean = isAdminEmail,
): boolean {
  // Only ever grants admin, never revokes: an admin demoted in-app stays admin
  // until removed from ADMIN_EMAILS and redeployed.
  if (principal.role === "admin") return false;
  if (!isAllowed(principal.doc.email)) return false;

  // The address must be PROVEN before it is trusted. Without this, anyone
  // could register the admin address and be promoted without ever controlling
  // the inbox. `emailVerificationTime` is set by Convex Auth only once the code
  // has been confirmed.
  return principal.doc.emailVerificationTime !== undefined;
}

/**
 * Admin bootstrap from the `ADMIN_EMAILS` allowlist.
 *
 * Runs on the first authenticated call for an allowlisted address, which is
 * what makes sign-in itself the bootstrap point: it works for the password
 * provider and the email-OTP provider alike, so no seeded placeholder account
 * (and no address that could never receive a code) is needed.
 *
 * The decision is made from the server-side env var only — a `role` supplied by
 * the client is never read. Re-checking on every call means revoking access is
 * a single env change plus a redeploy, without a manual un-promotion step.
 */
async function syncAdminRole(
  ctx: QueryCtx | MutationCtx,
  principal: Principal,
): Promise<void> {
  // A QueryCtx cannot write, so promotion only happens from a mutation. Public
  // reads call `currentPrincipal` directly and never promote.
  if (!("db" in ctx)) return;
  const writeCtx = ctx as MutationCtx;

  if (!shouldPromoteToAdmin(principal)) {
    // Not yet: either not on the allowlist, or the address is still unproven.
    // Re-checked on every later call, so the promotion lands automatically on
    // the first verified request.
    return;
  }

  await writeCtx.db.patch(principal.userId, { role: "admin" });
  principal.doc.role = "admin";
  principal.role = "admin";
  await audit(writeCtx, {
    actorId: principal.userId,
    action: "user.admin_bootstrapped",
    targetType: "user",
    targetId: principal.userId,
    details: "Promoted via ADMIN_EMAILS allowlist after email verification.",
  });
}

export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  ...roles: Principal["role"][]
): Promise<Principal> {
  const principal = await requireUser(ctx);
  if (!roles.includes(principal.role)) throw new AuthError("errNotAuthorized");
  return principal;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Principal> {
  const principal = await requireUser(ctx);
  if (principal.role !== "admin") throw new AuthError("errNotAuthorized");
  return principal;
}

// ---------------------------------------------------------------------------
// Subscriptions & entitlements
// ---------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A subscription is usable while `expiresAt + grace` is still in the future.
 * The 3-day grace is what lets a wholesaler whose renewal is pending keep
 * trading instead of vanishing from the feed overnight.
 */
export function subscriptionIsLive(sub: Doc<"subscriptions">, now = Date.now()): boolean {
  return sub.status === "active" && now <= sub.expiresAt + GRACE_PERIOD_DAYS * DAY_MS;
}

/** The wholesaler's live subscription, or null when their products stay hidden. */
export async function liveShopSubscription(
  ctx: QueryCtx | MutationCtx,
  shopId: Id<"shops">,
  now = Date.now(),
): Promise<Doc<"subscriptions"> | null> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_shop", (q) => q.eq("shopId", shopId))
    .order("desc")
    .first();
  if (!sub) return null;
  return subscriptionIsLive(sub, now) ? sub : null;
}

/** Retailer-side entitlement that gates contacting wholesalers. */
export async function retailerIsSubscribed(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  now = Date.now(),
): Promise<boolean> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .order("desc")
    .first();
  if (!sub || sub.audience !== "retailer") return false;
  return subscriptionIsLive(sub, now);
}

export async function planProductLimit(ctx: QueryCtx | MutationCtx, shop: Doc<"shops">) {
  const sub = await liveShopSubscription(ctx, shop._id);
  const plan = sub?.plan ?? "free";
  return PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.products ?? PLAN_LIMITS.free.products;
}

/**
 * True when the wholesaler's products may appear publicly. Without a live
 * subscription a shop's products are hidden from the feed and search, but
 * the data itself is untouched.
 */
export async function shopIsPublic(
  ctx: QueryCtx | MutationCtx,
  shopId: Id<"shops">,
  now = Date.now(),
): Promise<boolean> {
  const shop = await ctx.db.get(shopId);
  if (!shop || !shop.isActive) return false;
  return (await liveShopSubscription(ctx, shopId, now)) !== null;
}

// ---------------------------------------------------------------------------
// WhatsApp number gating  (the core trust rule)
// ---------------------------------------------------------------------------

export type PublicShop = Omit<Doc<"shops">, "whatsappE164"> & {
  /** Only ever populated for an entitled caller. */
  whatsappE164?: string;
  canRevealPhone: boolean;
};

/**
 * Single serializer for wholesaler data on public reads.
 *
 * `revealPhone` must only be passed after `retailerIsSubscribed` returned true
 * for the calling user — that check is deliberately *not* inlined here so the
 * decision stays visible at every call site.
 */
export function publicShopFields(shop: Doc<"shops">, revealPhone: boolean): PublicShop {
  const { whatsappE164, ...safe } = shop;
  return {
    ...safe,
    ...(revealPhone ? { whatsappE164 } : {}),
    canRevealPhone: revealPhone,
  };
}

/** Convenience: is this signed-in caller entitled to wholesaler phone numbers? */
export async function callerMaySeePhones(
  ctx: QueryCtx | MutationCtx,
  principal: Principal | null,
): Promise<boolean> {
  if (!principal) return false;
  if (principal.role === "admin") return true;
  // A wholesaler may always see their own number.
  if (principal.role === "wholesaler") return true;
  return retailerIsSubscribed(ctx, principal.userId);
}

// ---------------------------------------------------------------------------
// Review eligibility — the anti-fake rule
// ---------------------------------------------------------------------------

export type ReviewEligibility =
  | { ok: true }
  | { ok: false; reason: "signed_out" | "not_retailer" | "self_review" | "already_reviewed" | "no_contact" | "too_early" };

/**
 * A review requires all of:
 *  1. a signed-in retailer,
 *  2. not the wholesaler themselves,
 *  3. a logged contact about that exact product,
 *  4. at least 48h after first contact (so it cannot be a same-session favour),
 *  5. only once per product.
 */
export async function checkReviewEligibility(
  ctx: QueryCtx | MutationCtx,
  productId: Id<"products">,
  principal: Principal | null,
  now = Date.now(),
): Promise<ReviewEligibility> {
  if (!principal) return { ok: false, reason: "signed_out" };
  if (principal.role === "retailer") {
    // fallthrough
  } else {
    return { ok: false, reason: "not_retailer" };
  }

  const product = await ctx.db.get(productId);
  if (!product) return { ok: false, reason: "no_contact" };
  if (product.ownerId === principal.userId) return { ok: false, reason: "self_review" };

  const existing = await ctx.db
    .query("reviews")
    .withIndex("by_product_retailer", (q) =>
      q.eq("productId", productId).eq("retailerId", principal.userId),
    )
    .first();
  if (existing) return { ok: false, reason: "already_reviewed" };

  const contact = await ctx.db
    .query("contactLogs")
    .withIndex("by_retailer_product", (q) =>
      q.eq("retailerId", principal.userId).eq("productId", productId),
    )
    .first();
  if (!contact) return { ok: false, reason: "no_contact" };

  if (now - contact.createdAt < REVIEW_DELAY_HOURS * 60 * 60 * 1000) {
    return { ok: false, reason: "too_early" };
  }

  return { ok: true };
}

/**
 * Flag reviews that look coordinated: a burst of perfect 5-star reviews from
 * brand-new accounts, or several reviews from the same principal in a short
 * window. Admin sees these in the review inbox instead of the public feed.
 */
export async function detectSuspiciousReviews(
  ctx: QueryCtx | MutationCtx,
  review: Doc<"reviews">,
): Promise<{ suspicious: boolean; reason?: string }> {
  const retailer = await ctx.db.get(review.retailerId);
  if (!retailer) return { suspicious: false };

  const accountAgeDays = (Date.now() - (retailer.onboardedAt ?? retailer._creationTime)) / DAY_MS;
  const recentByRetailer = await ctx.db
    .query("reviews")
    .withIndex("by_retailer", (q) => q.eq("retailerId", review.retailerId))
    .collect();

  const inLastWeek = recentByRetailer.filter(
    (r) => Date.now() - r.createdAt <= 7 * DAY_MS,
  );

  if (inLastWeek.length >= 4 && inLastWeek.every((r) => r.productRating === 5)) {
    return { suspicious: true, reason: "burst_of_perfect_ratings" };
  }
  if (accountAgeDays < 7 && inLastWeek.length >= 3) {
    return { suspicious: true, reason: "new_account_many_reviews" };
  }
  if (review.productRating === 5 && review.sellerRating === 5 && !review.comment && accountAgeDays < 3) {
    return { suspicious: true, reason: "empty_perfect_review_new_account" };
  }
  return { suspicious: false };
}

// ---------------------------------------------------------------------------
// Denormalised aggregates
// ---------------------------------------------------------------------------

/**
 * Recompute a product's review aggregates from scratch. Called inside the
 * same mutation that writes a review, so the Wilson score and winning flag can
 * never drift from the underlying reviews.
 */
export async function refreshProductReviewStats(
  ctx: MutationCtx,
  productId: Id<"products">,
): Promise<void> {
  const product = await ctx.db.get(productId);
  if (!product) return;
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  const visible = reviews.filter((r) => r.status === "visible");
  const winning = computeWinning(visible.map((r) => r.productRating));
  const sellerAvg = visible.length
    ? visible.reduce((a, r) => a + r.sellerRating, 0) / visible.length
    : 0;
  await ctx.db.patch(productId, {
    reviewCount: visible.length,
    avgProductRating: winning.avg,
    avgSellerRating: sellerAvg,
    wilsonScore: winning.score,
    isWinning: winning.isWinning,
    updatedAt: Date.now(),
  });
}

/**
 * Recompute a shop's denormalised rating summary from all visible reviews on
 * its products. The card line "4.8/5 · 32 تقييم" reads this field, so it is
 * refreshed inside every mutation that writes a review.
 */
export async function refreshShopRatingSummary(
  ctx: MutationCtx,
  shopId: Id<"shops">,
): Promise<void> {
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_shop", (q) => q.eq("shopId", shopId))
    .collect();
  const visible = reviews.filter((r) => r.status === "visible");
  if (visible.length === 0) {
    await ctx.db.patch(shopId, {
      ratingSummary: { overall: 0, productAvg: 0, sellerAvg: 0, count: 0 },
    });
    return;
  }
  const productAvg = visible.reduce((a, r) => a + r.productRating, 0) / visible.length;
  const sellerAvg = visible.reduce((a, r) => a + r.sellerRating, 0) / visible.length;
  // One star, not two: the headline rating is the product-experience mean.
  await ctx.db.patch(shopId, {
    ratingSummary: {
      overall: Math.round(productAvg * 100) / 100,
      productAvg: Math.round(productAvg * 100) / 100,
      sellerAvg: Math.round(sellerAvg * 100) / 100,
      count: visible.length,
    },
  });
}

/**
 * Recompute a shop's response rate / median first-response time from chat
 * threads. Cheap because it runs only when a thread changes.
 */
export async function refreshShopResponseMetrics(
  ctx: MutationCtx,
  shopId: Id<"shops">,
): Promise<void> {
  const threads = await ctx.db
    .query("chatThreads")
    .withIndex("by_shop", (q) => q.eq("shopId", shopId))
    .collect();
  const responded = threads.filter((t) => t.firstResponseMinutes !== undefined);
  const withPreview = threads.filter((t) => t.lastMessagePreview !== undefined);

  const rate = threads.length ? withPreview.length / threads.length : 0;
  const sorted = responded
    .map((t) => t.firstResponseMinutes ?? 0)
    .sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? undefined
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  await ctx.db.patch(shopId, { responseRate: rate, medianResponseMinutes: median });
}

// ---------------------------------------------------------------------------
// Daily counters (views / favorites / contact clicks)
// ---------------------------------------------------------------------------

export function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Upsert a per-day counter. Convex mutations run serializably, so the
 * read-modify-write here cannot interleave with another increment.
 */
export async function bumpDailyStat(
  ctx: MutationCtx,
  productId: Id<"products">,
  field: "views" | "favorites" | "contactClicks",
  day = todayKey(),
): Promise<void> {
  const existing = await ctx.db
    .query("productDailyStats")
    .withIndex("by_product_day", (q) => q.eq("productId", productId).eq("day", day))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { [field]: (existing[field] ?? 0) + 1 });
  } else {
    await ctx.db.insert("productDailyStats", {
      productId,
      day,
      views: field === "views" ? 1 : 0,
      favorites: field === "favorites" ? 1 : 0,
      contactClicks: field === "contactClicks" ? 1 : 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export type RateLimitRule = { limit: number; windowMs: number };

/** Per-bucket limits. Tuned to be strict on auth and loose on browsing. */
export const RATE_LIMITS: Record<string, RateLimitRule> = {
  signIn: { limit: 8, windowMs: 10 * 60 * 1000 },
  signUp: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { limit: 4, windowMs: 60 * 60 * 1000 },
  promo: { limit: 10, windowMs: 60 * 60 * 1000 },
  message: { limit: 30, windowMs: 60 * 60 * 1000 },
  review: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
  quote: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
  quoteOffer: { limit: 20, windowMs: 24 * 60 * 60 * 1000 },
  upload: { limit: 40, windowMs: 24 * 60 * 60 * 1000 },
  report: { limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  /** Enrollment-code guesses: five per quarter of an hour per user. */
  codeRedeem: { limit: 5, windowMs: 15 * 60 * 1000 },
  contact: { limit: 60, windowMs: 24 * 60 * 60 * 1000 },
  support: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
};

export class RateLimitError extends Error {
  /** Minutes the caller must wait; surfaced to the UI as a localized message. */
  retryMinutes: number;

  constructor(retryMinutes: number) {
    super("errRateLimited");
    this.retryMinutes = retryMinutes;
    this.name = "RateLimitError";
  }
}

/**
 * Fixed-window counter keyed by action + principal. Signed-out callers fall
 * back to their IP (passed in by the caller), so an anonymous script cannot
 * bypass a limit by logging out.
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  action: string,
  keyParts: { userId?: string; ip?: string },
): Promise<void> {
  const rule = RATE_LIMITS[action];
  if (!rule) return;
  const principal = keyParts.userId ?? `ip:${keyParts.ip ?? "unknown"}`;
  const key = `${action}:${principal}`;
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  if (!existing || now - existing.windowStart >= rule.windowMs) {
    if (existing) await ctx.db.patch(existing._id, { count: 1, windowStart: now });
    else await ctx.db.insert("rateLimits", { key, count: 1, windowStart: now });
    return;
  }

  if (existing.count >= rule.limit) {
    const retryMinutes = Math.max(1, Math.ceil((existing.windowStart + rule.windowMs - now) / 60000));
    throw new RateLimitError(retryMinutes);
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}

// ---------------------------------------------------------------------------
// Notifications (deduplicated)
// ---------------------------------------------------------------------------

/**
 * Create a notification unless an identical unread one already exists in the
 * last `dedupeMs`. Keeps a burst of quote offers from spamming the bell.
 */
export async function notify(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    type: Doc<"notifications">["type"];
    title: string;
    body: string;
    link?: string;
    dedupeKey?: string;
    dedupeMs?: number;
  },
): Promise<void> {
  const dedupeMs = args.dedupeMs ?? 6 * 60 * 60 * 1000;
  if (args.dedupeKey) {
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const key = `${args.type}:${args.dedupeKey}`;
    const clash = recent.find(
      (n) =>
        `${n.type}:${n.link ?? ""}` === key &&
        n.readAt === undefined &&
        Date.now() - n.createdAt < dedupeMs,
    );
    if (clash) return;
  }

  const prefs = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .first();// Respect per-type opt-out; an empty list means "everything enabled".
    if (prefs && prefs.types.length > 0 && !prefs.types.includes(args.type)) return;

  await ctx.db.insert("notifications", {
    userId: args.userId,
    type: args.type,
    title: cleanText(args.title, 140),
    body: cleanText(args.body, 300),
    link: args.link,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Admin audit
// ---------------------------------------------------------------------------

export async function audit(
  ctx: MutationCtx,
  args: {
    actorId?: Id<"users">;
    action: string;
    targetType: string;
    targetId: string;
    details?: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorId: args.actorId,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    details: args.details,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Search blob
// ---------------------------------------------------------------------------

/** Folded text used for typo-tolerant matching; never rendered. */
export function buildSearchBlob(parts: (string | undefined | null)[]): string {
  return normalizeArabic(parts.filter(Boolean).join(" "));
}

export function daysAgo(days: number, now = Date.now()): number {
  return now - days * DAY_MS;
}

export { BOOST_DURATION_DAYS, computeWinning, v };

// ---------------------------------------------------------------------------
// Display labels (kept here so server responses never carry raw codes)
// ---------------------------------------------------------------------------

/** Arabic wilaya name for a code; falls back to the raw code if unknown. */
export function wilayaLabelOf(code: number): string {
  return wilayaName(code, "ar");
}

/** Arabic category name for a key. */
export function categoryLabelOf(key: string): string {
  return categoryLabel(key, "ar");
}