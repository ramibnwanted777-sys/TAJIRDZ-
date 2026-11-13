/**
 * VIP products (حماية المنتج الرابح).
 *
 * The privacy model is deliberately structural rather than conditional:
 *
 *  - The `products` row **is** the teaser. A VIP row's name, description,
 *    price and image list are generic from the moment they are written, so a
 *    public query cannot leak a real name, real price or real photo it does
 *    not hold. Every public path here (feed, search, product page, sitemap,
 *    favorites, compare, notifications) only ever reads that row.
 *  - The sensitive half lives in `vipShowcase`, read by exactly one query in
 *    this file, which admits two callers: the owning wholesaler and a retailer
 *    holding an approved, unexpired request.
 *  - The wholesaler's WhatsApp number is attached to a VIP teaser for one
 *    audience only: an approved buyer. `publicShopFields` is called with
 *    `entitled = false` first, so the number is absent from the payload before
 *    the approval check even runs.
 *  - Notifications are generic. "A request is waiting", never "for your
 *    product X at price Y" — a push notification leaves the device.
 *
 * Deals, money and negotiation happen off-platform: this module only
 * introduces the two parties and, after the wholesaler's approval, reveals
 * each side to the other.
 */

import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import {
  AuthError,
  audit,
  currentPrincipal,
  enforceRateLimit,
  liveShopSubscription,
  notify,
  publicShopFields,
  requireRole,
  requireUser,
  retailerIsSubscribed,
} from "./lib/access";
import {
  categoryLabel,
  cleanText,
  containsLinkOrPhone,
  slugify,
} from "../lib/catalog";
import { readPricing } from "./lib/pricingConfig";
import {
  VIP_AUTO_HIDE_REPORTS,
  VIP_EXPIRY_NOTICE_DAYS,
  VIP_MAX_MESSAGE,
  VIP_MAX_SHOWCASE_IMAGES,
  VIP_MAX_TEASER_DESCRIPTION,
  VIP_MAX_TEASER_TITLE,
  VIP_REQUEST_TTL_DAYS,
  VIP_REVIEW_DELAY_DAYS,
  autoRejectCause,
  checkVipEligibility,
  effectiveVipStatus,
  grantsAccess,
  type VipRequestStatus,
} from "../lib/vip";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Error keys the client maps to a sentence (all in the dictionary). */
const ERR = {
  notFound: "errNotFound",
  required: "errRequired",
  notAuthorized: "errNotAuthorized",
  tooManyImages: "errVipTooManyImages",
  leakedText: "errVipLeakedText",
  slotsFull: "errVipSlotsFull",
  decisionLate: "errVipDecisionLate",
  alreadyDecided: "errVipAlreadyDecided",
  reviewEarly: "errVipReviewEarly",
  reviewOnce: "errVipReviewOnce",
  ackRequired: "errVipAckRequired",
} as const;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getVipProduct(ctx: QueryCtx, productId: Id<"products">) {
  const product = await ctx.db.get(productId);
  if (!product || product.visibility !== "vip") return null;
  return product;
}

/** The teaser, as every public reader may see it. Never carries real data. */
function teaserOf(product: Doc<"products">) {
  return {
    id: product._id,
    slug: product.slug,
    name: product.name,
    description: product.description ?? "",
    category: product.category,
    categoryLabelAr: categoryLabel(product.category, "ar"),
    categoryLabelFr: categoryLabel(product.category, "fr"),
    minQty: product.minQty,
    isPaused: product.isPaused,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    viewCount: product.viewCount,
    visibility: product.visibility ?? "public",
    vip: product.vip ?? {
      allowedWilayas: [],
      maxApprovedBuyers: 0,
      requestsOpen: false,
      status: "closed" as const,
    },
  };
}

async function assertVipSlots(ctx: MutationCtx, shop: Doc<"shops">) {
  const sub = await liveShopSubscription(ctx, shop._id);
  const plan = sub?.plan ?? "free";
  const pricing = await readPricing(ctx);
  // A trial wholesaler gets the basic allowance; free plans get none, which is
  // what makes the VIP switch a reason to upgrade rather than a free funnel.
  const limit =
    plan === "pro"
      ? pricing.vip.proSlots
      : plan === "basic" || plan === "trial"
        ? pricing.vip.basicSlots
        : 0;
  if (limit <= 0) throw new Error("errVipPlanRequired");

  const rows = await ctx.db
    .query("products")
    .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
    .collect();
  const used = rows.filter((row) => row.visibility === "vip").length;
  if (used >= limit) throw new Error(ERR.slotsFull);
}

/** Block lists are per wholesaler: one seller's grudge is not a site ban. */
async function isBlocked(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  userId: Id<"users">,
): Promise<boolean> {
  const row = await ctx.db
    .query("vipBlocks")
    .withIndex("by_owner_user", (q) => q.eq("ownerId", ownerId).eq("userId", userId))
    .first();
  return row !== null;
}

async function approvedCount(ctx: QueryCtx, productId: Id<"products">): Promise<number> {
  const rows = await ctx.db
    .query("vipRequests")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  const now = Date.now();
  return rows.filter((row) => grantsAccess(row, now)).length;
}

/**
 * My live request on a product: `null`, or the row as it stands right now
 * (a pending row past its expiry reads as expired without the job having run).
 */
async function myRequest(
  ctx: QueryCtx,
  productId: Id<"products">,
  userId: Id<"users">,
) {
  const row = await ctx.db
    .query("vipRequests")
    .withIndex("by_product_retailer", (q) =>
      q.eq("productId", productId).eq("retailerId", userId),
    )
    .first();
  if (!row) return null;
  return { row, status: effectiveVipStatus(row, Date.now()) };
}

/** Generic copy: no product name, no price, no wilaya in a push body. */
async function notifyVip(
  ctx: MutationCtx,
  userId: Id<"users">,
  title: string,
  body: string,
  link: string,
  dedupeKey?: string,
) {
  await notify(ctx, {
    userId,
    type: "vip",
    title,
    body,
    link,
    // `notify` de-duplicates on `type + link`, so the key and the link are set
    // to the same string whenever we genuinely want one notice per subject.
    dedupeKey: dedupeKey ?? link,
    dedupeMs: dedupeKey ? 0 : 6 * 60 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Wholesaler: create / edit the teaser
// ---------------------------------------------------------------------------

const showcaseValidator = v.object({
  imageStorageIds: v.array(v.string()),
  priceHint: v.optional(v.string()),
  notes: v.optional(v.string()),
});

async function validateTeaser(args: {
  title: string;
  description: string;
}) {
  const title = cleanText(args.title, VIP_MAX_TEASER_TITLE);
  const description = cleanText(args.description, VIP_MAX_TEASER_DESCRIPTION);
  if (title.length < 6) throw new Error(ERR.required);
  if (description.length < 30) throw new Error(ERR.required);
  // A teaser that carries a link or a phone number *is* the leak: the whole
  // point is that nothing contactable or identifying is public.
  if (containsLinkOrPhone(title) || containsLinkOrPhone(description)) {
    throw new Error(ERR.leakedText);
  }
  return { title, description };
}

function validateShowcase(showcase?: {
  imageStorageIds: string[];
  priceHint?: string;
  notes?: string;
}) {
  if (!showcase) return undefined;
  const images = showcase.imageStorageIds.slice(0, VIP_MAX_SHOWCASE_IMAGES);
  if (images.length > VIP_MAX_SHOWCASE_IMAGES) throw new Error(ERR.tooManyImages);
  return {
    imageStorageIds: images,
    priceHint: showcase.priceHint ? cleanText(showcase.priceHint, 80) : undefined,
    notes: showcase.notes ? cleanText(showcase.notes, 1200) : undefined,
  };
}

async function writeShowcase(
  ctx: MutationCtx,
  productId: Id<"products">,
  ownerId: Id<"users">,
  showcase?: ReturnType<typeof validateShowcase>,
) {
  if (!showcase) return;
  const existing = await ctx.db
    .query("vipShowcase")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { ...showcase, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("vipShowcase", {
      productId,
      ownerId,
      ...showcase,
      updatedAt: Date.now(),
    });
  }
}

export const createTeaser = mutation({
  args: {
    category: v.string(),
    teaserTitle: v.string(),
    teaserDescription: v.string(),
    allowedWilayas: v.array(v.number()),
    minQuantity: v.number(),
    maxApprovedBuyers: v.number(),
    requestsOpen: v.boolean(),
    showcase: v.optional(showcaseValidator),
  },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) throw new Error(ERR.notAuthorized);
    await enforceRateLimit(ctx, "upload", { userId: principal.userId });
    await assertVipSlots(ctx, shop);

    const { title, description } = await validateTeaser({
      title: args.teaserTitle,
      description: args.teaserDescription,
    });
    const showcase = validateShowcase(args.showcase);

    const now = Date.now();
    const productId = await ctx.db.insert("products", {
      shopId: shop._id,
      ownerId: principal.userId,
      // The row *is* the teaser: no real name, no price, no images.
      name: title,
      slug: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
      category: args.category,
      description,
      wholesalePriceDa: 0,
      minQty: Math.max(1, Math.round(args.minQuantity)),
      priceTiers: [],
      stockStatus: "in_stock",
      prepDays: 1,
      tags: [],
      imageStorageIds: [],
      isPaused: false,
      reviewCount: 0,
      avgProductRating: 0,
      avgSellerRating: 0,
      wilsonScore: 0,
      isWinning: false,
      viewCount: 0,
      favoriteCount: 0,
      contactCount: 0,
      visibility: "vip",
      vip: {
        allowedWilayas: [...new Set(args.allowedWilayas.map(Number))].filter(
          (code) => Number.isFinite(code) && code > 0,
        ),
        maxApprovedBuyers: Math.max(0, Math.round(args.maxApprovedBuyers)),
        requestsOpen: Boolean(args.requestsOpen),
        status: "active",
      },
      createdAt: now,
      updatedAt: now,
    });

    await writeShowcase(ctx, productId, principal.userId, showcase);
    await audit(ctx, {
      actorId: principal.userId,
      action: "vip.created",
      targetType: "product",
      targetId: productId,
    });
    return { productId };
  },
});

export const updateTeaser = mutation({
  args: {
    productId: v.id("products"),
    category: v.optional(v.string()),
    teaserTitle: v.optional(v.string()),
    teaserDescription: v.optional(v.string()),
    allowedWilayas: v.optional(v.array(v.number())),
    minQuantity: v.optional(v.number()),
    maxApprovedBuyers: v.optional(v.number()),
    requestsOpen: v.optional(v.boolean()),
    showcase: v.optional(showcaseValidator),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);
    if (product.ownerId !== principal.userId) throw new AuthError(ERR.notAuthorized);

    const patch: Partial<Doc<"products">> = { updatedAt: Date.now() };

    if (args.teaserTitle !== undefined || args.teaserDescription !== undefined) {
      const { title, description } = await validateTeaser({
        title: args.teaserTitle ?? product.name,
        description: args.teaserDescription ?? product.description ?? "",
      });
      patch.name = title;
      patch.description = description;
      // Renaming a teaser changes its public URL; the slug follows so a stale
      // link can never start resolving at a *different* product.
      patch.slug = `${slugify(title)}-${product._id.slice(-5)}`;
    }
    if (args.category !== undefined) patch.category = args.category;
    if (args.minQuantity !== undefined) patch.minQty = Math.max(1, Math.round(args.minQuantity));

    if (
      args.allowedWilayas !== undefined ||
      args.maxApprovedBuyers !== undefined ||
      args.requestsOpen !== undefined
    ) {
      const vip = product.vip ?? {
        allowedWilayas: [],
        maxApprovedBuyers: 0,
        requestsOpen: false,
        status: "active" as const,
      };
      patch.vip = {
        allowedWilayas:
          args.allowedWilayas === undefined
            ? vip.allowedWilayas
            : [...new Set(args.allowedWilayas.map(Number))],
        maxApprovedBuyers:
          args.maxApprovedBuyers === undefined
            ? vip.maxApprovedBuyers
            : Math.max(0, Math.round(args.maxApprovedBuyers)),
        requestsOpen: args.requestsOpen ?? vip.requestsOpen,
        status: vip.status,
      };
    }

    await ctx.db.patch(args.productId, patch);
    if (args.showcase !== undefined) {
      await writeShowcase(ctx, args.productId, principal.userId, validateShowcase(args.showcase));
    }
    await audit(ctx, {
      actorId: principal.userId,
      action: "vip.updated",
      targetType: "product",
      targetId: args.productId,
    });
    return { ok: true };
  },
});

/** "Pause new requests" — the wholesaler's emergency switch. */
export const setRequestsOpen = mutation({
  args: { productId: v.id("products"), open: v.boolean() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);
    if (product.ownerId !== principal.userId) throw new AuthError(ERR.notAuthorized);
    const vip = product.vip;
    if (!vip) throw new Error(ERR.notFound);
    await ctx.db.patch(args.productId, {
      vip: { ...vip, requestsOpen: args.open },
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** `closed` ends the offer without hiding it; `active` reopens it. */
export const setVipStatus = mutation({
  args: {
    productId: v.id("products"),
    status: v.union(v.literal("active"), v.literal("closed")),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);
    if (product.ownerId !== principal.userId) throw new AuthError(ERR.notAuthorized);
    const vip = product.vip;
    if (!vip) throw new Error(ERR.notFound);
    await ctx.db.patch(args.productId, {
      vip: { ...vip, status: args.status },
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorId: principal.userId,
      action: `vip.${args.status}`,
      targetType: "product",
      targetId: args.productId,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Retailer: eligibility + request
// ---------------------------------------------------------------------------

/** The viewer's standing, for the button and the message under it. */
export const eligibility = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await currentPrincipal(ctx);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) return { reason: "vipErrNotOpen" as string };

    const reason = await evaluateEligibility(ctx, product, principal);
    return { reason, requestsOpen: (product.vip?.requestsOpen ?? false) && !product.isPaused };
  },
});

async function evaluateEligibility(
  ctx: QueryCtx | MutationCtx,
  product: Doc<"products">,
  principal: Awaited<ReturnType<typeof currentPrincipal>>,
): Promise<string | null> {
  const vip = product.vip;
  const userId = principal?.userId;
  const pending = principal
    ? await ctx.db
        .query("vipRequests")
        .withIndex("by_product_retailer", (q) =>
          q.eq("productId", product._id).eq("retailerId", principal.userId),
        )
        .first()
    : null;
  const pendingStatus = pending ? effectiveVipStatus(pending, Date.now()) : null;
  const pendingCount = userId
    ? (
        await ctx.db
          .query("vipRequests")
          .withIndex("by_retailer", (q) => q.eq("retailerId", userId).eq("status", "pending"))
          .collect()
      ).filter((row) => effectiveVipStatus(row, Date.now()) === "pending").length
    : 0;

  return checkVipEligibility({
    isSignedIn: principal !== null,
    emailVerified: Boolean(principal?.doc.emailVerificationTime),
    hasActiveRetailerPlan: userId ? await retailerIsSubscribed(ctx, userId) : false,
    profileComplete: Boolean(principal?.doc.storeType && principal?.doc.wilaya),
    blockedByThisWholesaler: userId
      ? await isBlocked(ctx, product.ownerId, userId)
      : false,
    hasPendingRequest: pendingStatus === "pending",
    pendingRequestCount: pendingCount,
    requestsOpen: vip?.requestsOpen ?? false,
    productActive: !product.isPaused && (vip?.status ?? "closed") === "active",
    isOwner: Boolean(userId && product.ownerId === userId),
  });
}

export const requestAccess = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
    wilaya: v.number(),
    message: v.string(),
    acknowledged: v.boolean(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const now = Date.now();

    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);
    if (!args.acknowledged) throw new Error(ERR.ackRequired);

    const reason = await evaluateEligibility(ctx, product, principal);
    if (reason) throw new Error(reason);

    // Five attempts an hour: the form is the only place a retailer can spend a
    // rate limit, and the auto-reject path would otherwise be a free oracle.
    try {
      await enforceRateLimit(ctx, "vipRequest", { userId: principal.userId });
    } catch (error) {
      const retry =
        error && typeof error === "object" && "retryMinutes" in error
          ? Number((error as { retryMinutes: number }).retryMinutes)
          : 15;
      throw new Error(`errVipLocked:${retry}`);
    }

    const message = cleanText(args.message, VIP_MAX_MESSAGE);
    const wilaya = Math.round(args.wilaya);
    const quantity = Math.max(1, Math.round(args.quantity));

    // The product's own published criteria decide before a human sees it.
    const cause = autoRejectCause({
      wilaya,
      allowedWilayas: product.vip?.allowedWilayas ?? [],
      quantity,
      minQuantity: product.minQty,
    });

    const rowId = await ctx.db.insert("vipRequests", {
      productId: product._id,
      ownerId: product.ownerId,
      retailerId: principal.userId,
      quantity,
      wilaya,
      message,
      status: cause ? "rejected" : "pending",
      decisionReason: cause ?? undefined,
      decidedAt: cause ? now : undefined,
      expiresAt: now + VIP_REQUEST_TTL_DAYS * DAY_MS,
      acknowledgedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    if (cause) {
      await notifyVip(
        ctx,
        principal.userId,
        "تم الرد على طلبك تلقائياً",
        cause === "vipRejectWilaya"
          ? "الولاية اللي اخترتها ماشي ضمن الولايات المسموح بها في هاد العرض."
          : "الكمية اللي طلبتها أقل من الحد الأدنى المعلن في هاد العرض.",
        "/my-vip",
        `auto:${rowId}`,
      );
    } else {
      // Generic on purpose: the notification must say "a request is waiting",
      // never which product, which wilaya or which quantity.
      await notifyVip(
        ctx,
        product.ownerId,
        "طلب وصول جديد",
        "وصل طلب وصول جديد لمنتوج VIP. راجع صندوق الطلبات قبل ما ينتهي المهلة.",
        "/dashboard/vip",
        `req:${rowId}`,
      );
    }

    await audit(ctx, {
      actorId: principal.userId,
      action: cause ? "vip.request.auto_rejected" : "vip.request",
      targetType: "product",
      targetId: product._id,
      details: cause ?? undefined,
    });

    return { requestId: rowId, autoRejected: cause !== null };
  },
});

// ---------------------------------------------------------------------------
// Public teaser page
// ---------------------------------------------------------------------------

/**
 * What everyone may see about a VIP product, plus the viewer's own standing.
 *
 * The phone number is added only for an approved buyer, and only after
 * `publicShopFields(..., false)` has already stripped it.
 */
export const teaser = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!product || product.visibility !== "vip") return null;

    const principal = await currentPrincipal(ctx);
    const shopDoc = await ctx.db.get(product.shopId);
    if (!shopDoc) return null;
    if (!shopDoc.isActive) return null;

    // `entitled = false` first: the number is absent from the payload before
    // the approval branch runs, so a mistake there can only hide it, never leak.
    const shop = publicShopFields(shopDoc, false);
    const my = principal ? await myRequest(ctx, product._id, principal.userId) : null;
    const approved = my !== null && grantsAccess(my.row, Date.now());
    const isOwner = principal?.userId === product.ownerId;
    const isAdmin = principal?.role === "admin";

    const showcase = await ctx.db
      .query("vipShowcase")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .first();

    const reviews = await ctx.db
      .query("vipReviews")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .order("desc")
      .collect();

    const counts = await requestCounts(ctx, product._id);
    const avgRating = averageRating(reviews);

    return {
      product: teaserOf(product),
      shop,
      my: my
        ? {
            status: my.status,
            requestId: my.row._id,
            expiresAt: my.row.expiresAt,
            // Server-computed: the client must not call Date.now() during
            // render, and this number only changes when the query re-runs.
            expiresInDays: Math.max(
              0,
              Math.ceil((my.row.expiresAt - Date.now()) / DAY_MS),
            ),
            decisionReason: my.row.decisionReason ?? null,
          }
        : null,
      eligibilityReason: principal ? await evaluateEligibility(ctx, product, principal) : "vipErrSignedIn",
      hasAcknowledged: principal
        ? (await ctx.db
            .query("vipAcks")
            .withIndex("by_user_kind", (q) =>
              q.eq("userId", principal.userId).eq("kind", "request"),
            )
            .first()) !== null
        : false,
      /** Present only for an approved buyer — never in the payload otherwise. */
      whatsappE164: approved ? shopDoc.whatsappE164 : undefined,
      canSeeShowcase: approved || isOwner || isAdmin,
      isOwner,
      showcase: showcase
        ? {
            imageStorageIds: showcase.imageStorageIds,
            priceHint: showcase.priceHint,
            notes: showcase.notes,
            updatedAt: showcase.updatedAt,
          }
        : null,
      stats: {
        views: product.viewCount,
        approved: counts.approved,
        requests: counts.total,
        reviews: reviews.filter((r) => r.status === "visible").length,
        avgRating,
      },
      canReview: canReviewNow(reviews, my, principal?.userId ?? null),
      notifiedAt: product.updatedAt,
    };
  },
});

/**
 * Live counts for one product: total requests, approved buyers, open slots.
 * Shared by the teaser and the inbox so the two screens never disagree.
 */
async function requestCounts(ctx: QueryCtx, productId: Id<"products">) {
  const rows = await ctx.db
    .query("vipRequests")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  const now = Date.now();
  return {
    total: rows.length,
    approved: rows.filter((row) => grantsAccess(row, now)).length,
    pending: rows.filter((row) => effectiveVipStatus(row, now) === "pending").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
  };
}

function averageRating(reviews: Doc<"vipReviews">[]): number | null {
  const visible = reviews.filter((r) => r.status === "visible");
  if (visible.length === 0) return null;
  const sum = visible.reduce((total, row) => total + row.rating, 0);
  return Math.round((sum / visible.length) * 10) / 10;
}

function canReviewNow(
  reviews: Doc<"vipReviews">[],
  my: Awaited<ReturnType<typeof myRequest>>,
  userId: Id<"users"> | null,
): boolean {
  if (!userId || !my) return false;
  if (!grantsAccess(my.row, Date.now())) return false;
  if (my.row.decidedAt === undefined) return false;
  if (Date.now() - my.row.decidedAt < VIP_REVIEW_DELAY_DAYS * DAY_MS) return false;
  return !reviews.some((row) => row.userId === userId);
}

// ---------------------------------------------------------------------------
// Private showcase
// ---------------------------------------------------------------------------

/**
 * The only reader of `vipShowcase`.
 *
 * Three callers: the owner, an approved buyer, an admin. Anyone else gets the
 * same `errNotAuthorized` the server throws for a private message thread.
 */
export const showcase = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);

    const isOwner = product.ownerId === principal.userId;
    const isAdmin = principal.role === "admin";
    const my = await myRequest(ctx, product._id, principal.userId);
    const approved = my !== null && grantsAccess(my.row, Date.now());

    if (!isOwner && !isAdmin && !approved) throw new AuthError(ERR.notAuthorized);

    const row = await ctx.db
      .query("vipShowcase")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    const shopDoc = await ctx.db.get(product.shopId);

    return {
      imageStorageIds: row?.imageStorageIds ?? [],
      priceHint: row?.priceHint ?? null,
      notes: row?.notes ?? null,
      updatedAt: row?.updatedAt ?? null,
      /** The reveal: only this branch ever attaches the number. */
      whatsappE164: approved && shopDoc ? shopDoc.whatsappE164 : undefined,
      wholesalerName: shopDoc?.name ?? "",
      approvedAt: my?.row.decidedAt ?? null,
      myUserId: principal.userId,
    };
  },
});

/** Counting a showcase view must not become a hit counter for scrapers. */
export const logView = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const product = await getVipProduct(ctx, args.productId);
    if (!product) return { ok: false };
    await ctx.db.patch(args.productId, { viewCount: product.viewCount + 1 });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Wholesaler inbox
// ---------------------------------------------------------------------------

/** One row of the wholesaler's request inbox. */
type InboxRow = {
  request: Doc<"vipRequests"> & { status: VipRequestStatus };
  product: ReturnType<typeof teaserOf> | null;
  retailer: {
    id: Id<"users">;
    name: string;
    wilaya: number | null;
    storeType: string | null;
    storeLink: string | null;
    memberSince: number;
    planActive: boolean;
    reviewsWritten: number;
    reportsAgainstThem: number;
  };
  blocked: boolean;
};

export const inbox = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "wholesaler" && principal.role !== "admin") {
      throw new AuthError(ERR.notAuthorized);
    }

    const shop = principal.shop;
    const rows = await ctx.db
      .query("products")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId))
      .order("desc")
      .collect();
    const products = rows.filter((row) => row.visibility === "vip");
    const productIds = new Set(products.map((row) => String(row._id)));

    const requests = await ctx.db.query("vipRequests").order("desc").take(300);
    const mine = requests.filter((row) => productIds.has(String(row.productId)));

    const out: InboxRow[] = [];
    for (const row of mine) {
      const retailer = await ctx.db.get(row.retailerId);
      if (!retailer) continue;
      const product = await ctx.db.get(row.productId);

      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_owner", (q) => q.eq("ownerId", row.retailerId))
        .order("desc")
        .first();
      const reports = await ctx.db
        .query("reports")
        .withIndex("by_target", (q) => q.eq("targetId", String(row.retailerId)))
        .collect();
      const writtenReviews = await ctx.db.query("vipReviews").collect();
      const theirReviews = writtenReviews.filter((r) => r.userId === row.retailerId);

      out.push({
        request: { ...row, status: effectiveVipStatus(row, Date.now()) },
        product: product ? teaserOf(product) : null,
        retailer: {
          id: row.retailerId,
          name: retailer.name ?? "تاجر",
          wilaya: retailer.wilaya ?? null,
          storeType: retailer.storeType ?? null,
          storeLink: retailer.storeLink ?? null,
          memberSince: retailer.onboardedAt ?? retailer._creationTime,
          planActive: sub?.status === "active" && (sub.expiresAt ?? 0) > Date.now(),
          reviewsWritten: theirReviews.length,
          reportsAgainstThem: reports.filter((r) => r.status === "open").length,
        },
        blocked: await isBlocked(ctx, principal.userId, row.retailerId),
      });
    }

    const productRows: Array<
      ReturnType<typeof teaserOf> & {
        pending: number;
        approved: number;
        requests: number;
      }
    > = [];
    for (const product of products) {
      const counts = await requestCounts(ctx, product._id);
      productRows.push({
        ...teaserOf(product),
        pending: counts.pending,
        approved: counts.approved,
        requests: counts.total,
      });
    }

    return {
      products: productRows,
      requests: out,
      stats: {
        products: productRows.length,
        pending: out.filter((row) => row.request.status === "pending").length,
        approved: out.filter((row) => row.request.status === "approved").length,
      },
      slotLimit: await vipSlotLimitFor(ctx, shop),
    };
  },
});

async function vipSlotLimitFor(
  ctx: QueryCtx | MutationCtx,
  shop: Doc<"shops"> | null,
): Promise<number> {
  if (!shop) return 0;
  const sub = await liveShopSubscription(ctx, shop._id);
  const plan = sub?.plan ?? "free";
  const pricing = await readPricing(ctx);
  if (plan === "pro") return pricing.vip.proSlots;
  if (plan === "basic" || plan === "trial") return pricing.vip.basicSlots;
  return 0;
}

export const decide = mutation({
  args: {
    requestId: v.id("vipRequests"),
    action: v.union(v.literal("approve"), v.literal("reject")),
    reason: v.optional(v.string()),
    /**
     * Approving repeats the off-platform warning: the wholesaler has to
     * confirm it on this call, exactly like `requestAccess` does on the
     * retailer side. The warning text itself is never stored.
     */
    acknowledged: v.boolean(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const row = await ctx.db.get(args.requestId);
    if (!row) throw new Error(ERR.notFound);
    if (row.ownerId !== principal.userId && principal.role !== "admin") {
      throw new AuthError(ERR.notAuthorized);
    }

    const status: VipRequestStatus = effectiveVipStatus(row, Date.now());
    if (status !== "pending") throw new Error(ERR.alreadyDecided);

    const product = await ctx.db.get(row.productId);
    if (!product) throw new Error(ERR.notFound);

    if (args.action === "approve") {
      if (!args.acknowledged) throw new Error(ERR.ackRequired);
      const cap = product.vip?.maxApprovedBuyers ?? 0;
      if (cap > 0 && (await approvedCount(ctx, product._id)) >= cap) {
        throw new Error(ERR.slotsFull);
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.requestId, {
      status: args.action === "approve" ? "approved" : "rejected",
      decisionReason:
        args.action === "reject"
          ? cleanText(args.reason ?? "", 200) || undefined
          : undefined,
      decidedAt: now,
      decidedBy: principal.userId,
      updatedAt: now,
    });

    if (args.action === "approve") {
      // One-time record that the wholesaler saw the approval warning; the
      // warning text itself is never persisted.
      const priorAck = await ctx.db
        .query("vipAcks")
        .withIndex("by_user_kind", (q) =>
          q.eq("userId", principal.userId).eq("kind", "approval"),
        )
        .first();
      if (!priorAck) {
        await ctx.db.insert("vipAcks", {
          userId: principal.userId,
          kind: "approval",
          acknowledgedAt: now,
        });
      }
      // The approval is what unlocks the reveal; nothing else does it.
      await notifyVip(
        ctx,
        row.retailerId,
        "تمت الموافقة على طلبك",
        "مبروك! تقدر دابا تشوف التفاصيل الخاصة وتفتح المحادثة مع الموزع.",
        "/my-vip",
        `decide:${args.requestId}`,
      );
    } else {
      await notifyVip(
        ctx,
        row.retailerId,
        "تم الرد على طلبك",
        "ما تمت الموافقة على طلبك. تقدر تقدّم لعروض أخرى.",
        "/my-vip",
        `decide:${args.requestId}`,
      );
    }

    await audit(ctx, {
      actorId: principal.userId,
      action: `vip.${args.action}`,
      targetType: "vipRequest",
      targetId: args.requestId,
      details: args.reason,
    });

    return { ok: true, status: args.action === "approve" ? "approved" : "rejected" };
  },
});

export const revoke = mutation({
  args: { requestId: v.id("vipRequests") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const row = await ctx.db.get(args.requestId);
    if (!row) throw new Error(ERR.notFound);
    if (row.ownerId !== principal.userId && principal.role !== "admin") {
      throw new AuthError(ERR.notAuthorized);
    }
    if (row.status !== "approved") throw new Error(ERR.alreadyDecided);

    await ctx.db.patch(args.requestId, {
      status: "revoked",
      decidedAt: Date.now(),
      decidedBy: principal.userId,
      updatedAt: Date.now(),
    });
    await notifyVip(
      ctx,
      row.retailerId,
      "تم سحب الوصول",
      "سحب الموزع صلاحيتك للوصول لهاد المنتوج. تقدر تقدّم لعروض أخرى.",
      "/my-vip",
      `revoke:${args.requestId}`,
    );
    await audit(ctx, {
      actorId: principal.userId,
      action: "vip.revoked",
      targetType: "vipRequest",
      targetId: args.requestId,
    });
    return { ok: true };
  },
});

export const blockRetailer = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()), block: v.boolean() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "wholesaler") throw new AuthError(ERR.notAuthorized);
    if (args.userId === principal.userId) throw new Error(ERR.required);

    const existing = await ctx.db
      .query("vipBlocks")
      .withIndex("by_owner_user", (q) =>
        q.eq("ownerId", principal.userId).eq("userId", args.userId),
      )
      .first();

    if (!args.block) {
      if (existing) await ctx.db.delete(existing._id);
      return { ok: true, blocked: false };
    }
    if (!existing) {
      await ctx.db.insert("vipBlocks", {
        ownerId: principal.userId,
        userId: args.userId,
        reason: args.reason ? cleanText(args.reason, 200) : undefined,
        createdAt: Date.now(),
      });
    }

    // Blocking closes the door that is already open, not just future ones.
    const open = await ctx.db
      .query("vipRequests")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId).eq("status", "pending"))
      .collect();
    for (const row of open) {
      if (row.retailerId === args.userId) {
        await ctx.db.patch(row._id, {
          status: "rejected",
          decisionReason: "blocked",
          decidedAt: Date.now(),
          decidedBy: principal.userId,
          updatedAt: Date.now(),
        });
      }
    }

    await audit(ctx, {
      actorId: principal.userId,
      action: "vip.block",
      targetType: "user",
      targetId: args.userId,
      details: args.reason,
    });
    return { ok: true, blocked: true };
  },
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const addReview = mutation({
  args: {
    productId: v.id("products"),
    rating: v.number(),
    comment: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (args.rating < 1 || args.rating > 5) throw new Error(ERR.required);

    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);

    const request = await ctx.db
      .query("vipRequests")
      .withIndex("by_product_retailer", (q) =>
        q.eq("productId", args.productId).eq("retailerId", principal.userId),
      )
      .first();
    if (!request || request.status !== "approved") throw new Error(ERR.notAuthorized);
    if (request.decidedAt === undefined) throw new Error(ERR.notAuthorized);
    if (Date.now() - request.decidedAt < VIP_REVIEW_DELAY_DAYS * DAY_MS) {
      throw new Error(ERR.reviewEarly);
    }

    const existing = await ctx.db
      .query("vipReviews")
      .withIndex("by_product_user", (q) =>
        q.eq("productId", args.productId).eq("userId", principal.userId),
      )
      .first();
    if (existing) throw new Error(ERR.reviewOnce);

    await ctx.db.insert("vipReviews", {
      productId: args.productId,
      ownerId: product.ownerId,
      userId: principal.userId,
      rating: Math.round(args.rating),
      comment: cleanText(args.comment, 600),
      status: "visible",
      createdAt: Date.now(),
    });

    await notifyVip(
      ctx,
      product.ownerId,
      "تقييم VIP جديد",
      "تقييم جديد لمنتوج VIP من مشترٍ مصادق عليه.",
      "/dashboard/vip",
      `review:${args.productId}`,
    );
    await audit(ctx, {
      actorId: principal.userId,
      action: "vip.review",
      targetType: "product",
      targetId: args.productId,
    });
    return { ok: true };
  },
});

export const replyReview = mutation({
  args: { reviewId: v.id("vipReviews"), reply: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const row = await ctx.db.get(args.reviewId);
    if (!row) throw new Error(ERR.notFound);
    if (row.ownerId !== principal.userId && principal.role !== "admin") {
      throw new AuthError(ERR.notAuthorized);
    }
    if (row.instructorReply !== undefined) throw new Error(ERR.reviewOnce);

    await ctx.db.patch(args.reviewId, {
      instructorReply: cleanText(args.reply, 400),
      replyAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Ratings written about me: owner, buyer and admin only — never public. */
export const productReviews = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);

    const my = await myRequest(ctx, product._id, principal.userId);
    const approved = my !== null && grantsAccess(my.row, Date.now());
    const allowed =
      product.ownerId === principal.userId ||
      principal.role === "admin" ||
      approved;
    if (!allowed) throw new AuthError(ERR.notAuthorized);

    const rows = await ctx.db
      .query("vipReviews")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .collect();

    const visible = rows.filter((row) => row.status === "visible");
    const out: {
      id: Id<"vipReviews">;
      rating: number;
      comment: string;
      reply: string | null;
      createdAt: number;
      authorName: string;
      myUserId: Id<"users">;
    }[] = [];
    for (const row of visible) {
      const author = await ctx.db.get(row.userId);
      out.push({
        id: row._id,
        rating: row.rating,
        comment: row.comment,
        reply: row.instructorReply ?? null,
        createdAt: row.createdAt,
        // A reviewer's identity is only useful to the party they rated.
        authorName: author?.name ?? "تاجر",
        myUserId: principal.userId,
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Retailer: my requests (/my-vip)
// ---------------------------------------------------------------------------

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const rows = await ctx.db
      .query("vipRequests")
      .withIndex("by_retailer", (q) => q.eq("retailerId", principal.userId))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);

    const out: {
      requestId: Id<"vipRequests">;
      status: VipRequestStatus;
      expiresAt: number;
      expiresInDays: number;
      decisionReason: string | null;
      decidedAt: number | null;
      quantity: number;
      wilaya: number;
      createdAt: number;
      product: ReturnType<typeof teaserOf>;
      shopName: string;
      shopSlug: string;
      shopVerified: boolean;
    }[] = [];
    for (const row of rows.slice(0, 50)) {
      const product = await ctx.db.get(row.productId);
      if (!product) continue;
      const shopDoc = await ctx.db.get(product.shopId);
      out.push({
        requestId: row._id,
        // The cron is idempotent, but the UI must not wait for it: show the
        // effective status so a stale "pending" never reads as alive.
        status: effectiveVipStatus(row, Date.now()),
        expiresAt: row.expiresAt,
        expiresInDays: Math.max(0, Math.ceil((row.expiresAt - Date.now()) / DAY_MS)),
        decisionReason: row.decisionReason ?? null,
        decidedAt: row.decidedAt ?? null,
        quantity: row.quantity,
        wilaya: row.wilaya,
        createdAt: row.createdAt,
        product: teaserOf(product),
        shopName: shopDoc?.name ?? "",
        shopSlug: shopDoc?.slug ?? "",
        shopVerified: shopDoc?.verification === "approved",
      });
    }
    return { requests: out };
  },
});

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

export const ack = mutation({
  args: { kind: v.union(v.literal("request"), v.literal("approval")) },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const existing = await ctx.db
      .query("vipAcks")
      .withIndex("by_user_kind", (q) =>
        q.eq("userId", principal.userId).eq("kind", args.kind),
      )
      .first();
    if (existing) return { ok: true, already: true };
    await ctx.db.insert("vipAcks", {
      userId: principal.userId,
      kind: args.kind,
      acknowledgedAt: Date.now(),
    });
    return { ok: true, already: false };
  },
});

export const hasAck = query({
  args: { kind: v.union(v.literal("request"), v.literal("approval")) },
  handler: async (ctx, args) => {
    const principal = await currentPrincipal(ctx);
    if (!principal) return { acked: false };
    const row = await ctx.db
      .query("vipAcks")
      .withIndex("by_user_kind", (q) =>
        q.eq("userId", principal.userId).eq("kind", args.kind),
      )
      .first();
    return { acked: row !== null };
  },
});

// ---------------------------------------------------------------------------
// Expiry (idempotent)
// ---------------------------------------------------------------------------

/**
 * Flip stale pending requests and warn the retailer a day early.
 *
 * Safe to run any number of times: the flip only happens while a row is still
 * `pending` and already past its expiry, and the warning is de-duplicated by
 * `notify`'s type+link rule.
 */
export const expireRequests = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("vipRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    let expired = 0;
    let warned = 0;
    for (const row of pending) {
      if (row.expiresAt <= now) {
        await ctx.db.patch(row._id, {
          status: "expired",
          updatedAt: now,
        });
        await notifyVip(
          ctx,
          row.retailerId,
          "انتهت مهلة الطلب",
          "ما تجوبش الموزع على طلبك في الوقت، وهاد الطلب سالا. تقدر تقدّم من جديد.",
          "/my-vip",
          `expired:${row._id}`,
        );
        expired++;
      } else if (row.expiresAt - now <= VIP_EXPIRY_NOTICE_DAYS * DAY_MS) {
        await notifyVip(
          ctx,
          row.retailerId,
          "قربت تنتهي مهلة طلبك",
          "باقي يوم على انتهاء مهلة الطلب. إذا ما تجوبش، كيتمغلق تلقائياً.",
          "/my-vip",
          `expiring:${row._id}`,
        );
        warned++;
      }
    }
    return { expired, warned };
  },
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "admin") throw new AuthError(ERR.notAuthorized);

    const products = await ctx.db.query("products").order("desc").take(500);
    const vipProducts = products.filter((row) => row.visibility === "vip");
    const vipIds = new Set(vipProducts.map((row) => String(row._id)));

    const requests = await ctx.db.query("vipRequests").order("desc").take(300);
    const vipRequests = requests.filter((row) => vipIds.has(String(row.productId)));

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .collect();
    const vipReports = reports.filter((row) => vipIds.has(row.targetId));

    const out: (Doc<"vipRequests"> & {
      status: VipRequestStatus;
      retailerName: string;
      retailerEmail: string | null;
    })[] = [];
    for (const row of vipRequests.slice(0, 60)) {
      const retailer = await ctx.db.get(row.retailerId);
      out.push({
        ...row,
        status: effectiveVipStatus(row, Date.now()),
        retailerName: retailer?.name ?? "تاجر",
        retailerEmail: retailer?.email ?? null,
      });
    }

    return {
      products: vipProducts.map((product) => ({
        id: product._id,
        slug: product.slug,
        name: product.name,
        category: product.category,
        isPaused: product.isPaused,
        status: product.vip?.status ?? "closed",
        requestsOpen: product.vip?.requestsOpen ?? false,
        createdAt: product.createdAt,
        hiddenByReports: vipReports.filter((r) => r.targetId === String(product._id)).length,
      })),
      requests: out,
      reports: vipReports.map((row) => ({
        id: row._id,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        details: row.details ?? null,
        createdAt: row.createdAt,
      })),
      stats: {
        products: vipProducts.length,
        pending: vipRequests.filter((row) => row.status === "pending").length,
        approved: vipRequests.filter((row) => row.status === "approved").length,
        reports: vipReports.length,
        hidden: vipProducts.filter((row) => row.isPaused).length,
      },
      autoHideThreshold: VIP_AUTO_HIDE_REPORTS,
    };
  },
});

/**
 * Teaser moderation: a teaser that names the real product, carries a phone
 * number or links out is exactly what VIP exists to prevent, so the admin can
 * take it down and tell the owner why.
 */
export const moderateTeaser = mutation({
  args: {
    productId: v.id("products"),
    action: v.union(v.literal("hide"), v.literal("restore")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "admin") throw new AuthError(ERR.notAuthorized);
    const product = await getVipProduct(ctx, args.productId);
    if (!product) throw new Error(ERR.notFound);

    const hide = args.action === "hide";
    await ctx.db.patch(args.productId, {
      isPaused: hide,
      updatedAt: Date.now(),
    });
    if (hide) {
      await notifyVip(
        ctx,
        product.ownerId,
        "تم إيقاف عرض VIP",
        "العرض متوقف مؤقتاً للمراجعة. راجع الإشعار من الإدارة.",
        "/dashboard/vip",
        `moderate:${args.productId}`,
      );
    }
    await audit(ctx, {
      actorId: principal.userId,
      action: hide ? "vip.hidden" : "vip.restored",
      targetType: "product",
      targetId: args.productId,
      details: args.note,
    });
    return { ok: true };
  },
});

/** Enforcement: cut every buyer off one product, or every product of an owner. */
export const revokeAll = mutation({
  args: {
    productId: v.optional(v.id("products")),
    ownerId: v.optional(v.id("users")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "admin") throw new AuthError(ERR.notAuthorized);

    const rows = await ctx.db
      .query("vipRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    let revoked = 0;
    for (const row of rows) {
      if (args.productId && row.productId !== args.productId) continue;
      if (args.ownerId && row.ownerId !== args.ownerId) continue;
      await ctx.db.patch(row._id, {
        status: "revoked",
        decidedAt: Date.now(),
        decidedBy: principal.userId,
        updatedAt: Date.now(),
      });
      await notifyVip(
        ctx,
        row.retailerId,
        "تم سحب الوصول",
        "سحبنا صلاحيتك للوصول لمنتوج VIP بعد قرار من الإدارة.",
        "/my-vip",
        `adminrevoke:${row._id}`,
      );
      revoked++;
    }

    await audit(ctx, {
      actorId: principal.userId,
      action: "vip.revoke_all",
      targetType: args.productId ? "product" : "user",
      targetId: String(args.productId ?? args.ownerId ?? "all"),
      details: args.note,
    });
    return { ok: true, revoked };
  },
});
