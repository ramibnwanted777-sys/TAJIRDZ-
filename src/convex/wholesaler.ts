/**
 * Wholesaler onboarding and product management.
 *
 * Onboarding creates the `shops` row that every product hangs off, plus the
 * user's private WhatsApp number. Product mutations re-check plan limits and
 * ownership on the server: a wholesaler can only ever mutate their own rows.
 */

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

import {
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  MIN_QTY_OPTIONS,
  cleanText,
  normalizeAlgerianPhone,
  slugify,
} from "../lib/catalog";
import {
  audit,
  enforceRateLimit,
  liveShopSubscription,
  notify,
  planProductLimit,
  requireRole,
  requireUser,
} from "./lib/access";

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const completeWholesalerOnboarding = mutation({
  args: {
    shopName: v.string(),
    ownerName: v.string(),
    wilaya: v.number(),
    commune: v.optional(v.string()),
    whatsapp: v.string(),
    shopImageStorageId: v.optional(v.string()),
    address: v.optional(v.string()),
    rcNumber: v.optional(v.string()),
    categories: v.array(v.string()),
    deliveryOptions: v.array(v.string()),
    avgPrepDays: v.number(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "signUp", { userId: principal.userId });

    const phone = normalizeAlgerianPhone(args.whatsapp);
    if (!phone) throw new Error("errInvalidPhone");

    if (principal.shop) {
      throw new Error("alreadyOnboarded");
    }

    const shopName = cleanText(args.shopName, 80);
    if (!shopName) throw new Error("errRequired");

    const shopId = await ctx.db.insert("shops", {
      ownerId: principal.userId,
      name: shopName,
      slug: `${slugify(shopName)}-${Math.random().toString(36).slice(2, 7)}`,
      wilaya: args.wilaya,
      commune: args.commune ? cleanText(args.commune, 60) : undefined,
      address: args.address ? cleanText(args.address, 200) : undefined,
      whatsappE164: phone,
      shopImageStorageId: args.shopImageStorageId,
      rcNumber: args.rcNumber ? cleanText(args.rcNumber, 40) : undefined,
      categories: args.categories.slice(0, 8),
      deliveryOptions: args.deliveryOptions.slice(0, 5),
      avgPrepDays: Math.max(0, Math.round(args.avgPrepDays)),
      verification: args.rcNumber ? "pending" : "none",
      isActive: true,
      responseRate: 0,
      createdAt: Date.now(),
    });

    await ctx.db.patch(principal.userId, {
      role: "wholesaler",
      name: cleanText(args.ownerName, 80),
      wilaya: args.wilaya,
      commune: args.commune,
      whatsappE164: phone,
      onboardedAt: Date.now(),
    });

    return { shopId };
  },
});

export const completeRetailerOnboarding = mutation({
  args: {
    name: v.string(),
    wilaya: v.number(),
    whatsapp: v.string(),
    storeType: v.string(),
    storeLink: v.optional(v.string()),
    niches: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "signUp", { userId: principal.userId });

    const phone = normalizeAlgerianPhone(args.whatsapp);
    if (!phone) throw new Error("errInvalidPhone");

    const name = cleanText(args.name, 80);
    if (!name) throw new Error("errRequired");

    await ctx.db.patch(principal.userId, {
      role: "retailer",
      name,
      wilaya: args.wilaya,
      whatsappE164: phone,
      storeType: cleanText(args.storeType, 30),
      storeLink: args.storeLink ? cleanText(args.storeLink, 200) : undefined,
      niches: args.niches.slice(0, 8),
      onboardedAt: Date.now(),
    });

    return { ok: true };
  },
});

/** Save the language preference used by the UI switcher. */
export const setLanguage = mutation({
  args: { lang: v.union(v.literal("ar"), v.literal("fr")) },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await ctx.db.patch(principal.userId, { language: args.lang });
    return args.lang;
  },
});

// ---------------------------------------------------------------------------
// Shop profile editing
// ---------------------------------------------------------------------------

export const updateShop = mutation({
  args: {
    name: v.optional(v.string()),
    commune: v.optional(v.string()),
    address: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    rcNumber: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    deliveryOptions: v.optional(v.array(v.string())),
    avgPrepDays: v.optional(v.number()),
    shopImageStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler", "admin");
    const shop = principal.shop;
    if (!shop) throw new Error("errNotAuthorized");

    const shopPatch: Partial<Doc<"shops">> = {};
    if (args.name !== undefined) shopPatch.name = cleanText(args.name, 80);
    if (args.commune !== undefined) shopPatch.commune = cleanText(args.commune, 60);
    if (args.address !== undefined) shopPatch.address = cleanText(args.address, 200);
    if (args.rcNumber !== undefined) {
      shopPatch.rcNumber = cleanText(args.rcNumber, 40);
      // Editing the RC restarts verification if it had not been approved.
      if (shop.verification !== "approved") shopPatch.verification = "pending";
    }
    if (args.categories !== undefined) shopPatch.categories = args.categories.slice(0, 8);
    if (args.deliveryOptions !== undefined) {
      shopPatch.deliveryOptions = args.deliveryOptions.slice(0, 5);
    }
    if (args.avgPrepDays !== undefined) {
      shopPatch.avgPrepDays = Math.max(0, Math.round(args.avgPrepDays));
    }
    if (args.shopImageStorageId !== undefined) shopPatch.shopImageStorageId = args.shopImageStorageId;
    if (args.whatsapp !== undefined) {
      const phone = normalizeAlgerianPhone(args.whatsapp);
      if (!phone) throw new Error("errInvalidPhone");
      shopPatch.whatsappE164 = phone;
      await ctx.db.patch(principal.userId, { whatsappE164: phone });
    }

    await ctx.db.patch(shop._id, shopPatch);
    return { ok: true };
  },
});

/**
 * Submit verification documents. Stored in a private bucket; only the owner
 * and admins can read them via signed URLs.
 */
export const submitVerification = mutation({
  args: { rcStorageId: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) throw new Error("errNotAuthorized");
    await enforceRateLimit(ctx, "upload", { userId: principal.userId });

    await ctx.db.patch(shop._id, {
      verification: "pending",
      rcDocumentStorageId: args.rcStorageId,
    });
    await audit(ctx, {
      actorId: principal.userId,
      action: "shop.verification_submitted",
      targetType: "shop",
      targetId: shop._id,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const tierValidator = v.array(
  v.object({ minQty: v.number(), priceDa: v.number() }),
);

async function assertProductSlot(ctx: MutationCtx, shop: Doc<"shops">) {
  const limit = await planProductLimit(ctx, shop);
  if (limit === Number.POSITIVE_INFINITY) return;
  const existing = await ctx.db
    .query("products")
    .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
    .collect();
  if (existing.length >= limit) throw new Error("errPlanProductLimit");
}

function validateTiers(
  tiers: { minQty: number; priceDa: number }[],
  basePrice: number,
) {
  const clean = tiers
    .filter((t) => t.minQty > 0 && t.priceDa > 0)
    .sort((a, b) => a.minQty - b.minQty)
    .slice(0, 6)
    .map((t) => ({ minQty: Math.round(t.minQty), priceDa: Math.round(t.priceDa) }));
  // A tier must actually be cheaper than the unit price or it buys nothing.
  for (const t of clean) {
    if (t.priceDa >= basePrice) throw new Error("errTierNotCheaper");
  }
  return clean;
}

export const createProduct = mutation({
  args: {
    name: v.string(),
    nameFr: v.optional(v.string()),
    category: v.string(),
    description: v.optional(v.string()),
    wholesalePriceDa: v.number(),
    minQty: v.number(),
    priceTiers: tierValidator,
    stockStatus: v.union(v.literal("in_stock"), v.literal("low"), v.literal("out")),
    prepDays: v.number(),
    tags: v.array(v.string()),
    imageStorageIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) throw new Error("errNotAuthorized");
    await enforceRateLimit(ctx, "upload", { userId: principal.userId });
    await assertProductSlot(ctx, shop);

    const name = cleanText(args.name, 120);
    if (!name) throw new Error("errRequired");
    if (args.wholesalePriceDa <= 0) throw new Error("errRequired");
    if (args.imageStorageIds.length > MAX_PRODUCT_IMAGES) throw new Error("errTooManyImages");

    const basePrice = Math.round(args.wholesalePriceDa);
    const tiers = validateTiers(args.priceTiers, basePrice);
    const now = Date.now();

    const productId = await ctx.db.insert("products", {
      shopId: shop._id,
      ownerId: principal.userId,
      name,
      nameFr: args.nameFr ? cleanText(args.nameFr, 120) : undefined,
      slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`,
      category: args.category,
      description: args.description ? cleanText(args.description, 1200) : undefined,
      wholesalePriceDa: basePrice,
      minQty: Math.max(1, Math.round(args.minQty)),
      priceTiers: tiers,
      stockStatus: args.stockStatus,
      prepDays: Math.max(0, Math.round(args.prepDays)),
      tags: args.tags.map((t) => cleanText(t, 24)).filter(Boolean).slice(0, 8),
      imageStorageIds: args.imageStorageIds.slice(0, MAX_PRODUCT_IMAGES),
      isPaused: false,
      reviewCount: 0,
      avgProductRating: 0,
      avgSellerRating: 0,
      wilsonScore: 0,
      isWinning: false,
      viewCount: 0,
      favoriteCount: 0,
      contactCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { productId };
  },
});

export const updateProduct = mutation({
  args: {
    productId: v.id("products"),
    name: v.optional(v.string()),
    nameFr: v.optional(v.string()),
    category: v.optional(v.string()),
    description: v.optional(v.string()),
    wholesalePriceDa: v.optional(v.number()),
    minQty: v.optional(v.number()),
    priceTiers: v.optional(tierValidator),
    stockStatus: v.optional(
      v.union(v.literal("in_stock"), v.literal("low"), v.literal("out")),
    ),
    prepDays: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    imageStorageIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) throw new Error("errNotAuthorized");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("errNotFound");
    if (product.shopId !== shop._id) throw new Error("errNotAuthorized");

    const patch: Partial<Doc<"products">> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = cleanText(args.name, 120);
      if (!name) throw new Error("errRequired");
      patch.name = name;
    }
    if (args.nameFr !== undefined) {
      patch.nameFr = args.nameFr ? cleanText(args.nameFr, 120) : undefined;
    }
    if (args.category !== undefined) patch.category = args.category;
    if (args.description !== undefined) {
      patch.description = args.description ? cleanText(args.description, 1200) : undefined;
    }
    if (args.stockStatus !== undefined) patch.stockStatus = args.stockStatus;
    if (args.prepDays !== undefined) patch.prepDays = Math.max(0, Math.round(args.prepDays));
    if (args.minQty !== undefined) patch.minQty = Math.max(1, Math.round(args.minQty));
    if (args.tags !== undefined) {
      patch.tags = args.tags.map((t) => cleanText(t, 24)).filter(Boolean).slice(0, 8);
    }
    if (args.imageStorageIds !== undefined) {
      if (args.imageStorageIds.length > MAX_PRODUCT_IMAGES) throw new Error("errTooManyImages");
      patch.imageStorageIds = args.imageStorageIds.slice(0, MAX_PRODUCT_IMAGES);
    }

    const newPrice =
      args.wholesalePriceDa !== undefined ? Math.round(args.wholesalePriceDa) : product.wholesalePriceDa;
    if (newPrice <= 0) throw new Error("errRequired");
    patch.wholesalePriceDa = newPrice;

    if (args.priceTiers !== undefined) {
      patch.priceTiers = validateTiers(args.priceTiers, newPrice);
    }

    await ctx.db.patch(product._id, patch);

    // A price cut or a restock is exactly what favourites are watching for.
    await notifyFavouritedRetailers(ctx, product, newPrice, patch.stockStatus);

    return { ok: true };
  },
});

/** Fire price-drop / restock alerts, deduplicated per product+type. */
async function notifyFavouritedRetailers(
  ctx: MutationCtx,
  product: Doc<"products">,
  newPrice: number,
  newStock: Doc<"products">["stockStatus"] | undefined,
) {
  const favourites = await ctx.db
    .query("favorites")
    .withIndex("by_product", (q) => q.eq("productId", product._id))
    .collect();
  if (!favourites.length) return;

  if (newPrice < product.wholesalePriceDa) {
    for (const fav of favourites) {
      await notify(ctx, {
        userId: fav.userId,
        type: "price_drop",
        title: "انخفاض في السعر",
        body: `${product.name} نزل من ${product.wholesalePriceDa} دج إلى ${newPrice} دج`,
        link: `/product/${product.slug}`,
        dedupeKey: `${product._id}:${newPrice}`,
      });
    }
  }

  const restocked =
    product.stockStatus === "out" && (newStock === "in_stock" || newStock === "low");
  if (restocked && newStock) {
    for (const fav of favourites) {
      await notify(ctx, {
        userId: fav.userId,
        type: "restock",
        title: "المنتج رجع للمخزون",
        body: `${product.name} رجع متوفر`,
        link: `/product/${product.slug}`,
        dedupeKey: `${product._id}:restock:${newStock}`,
        dedupeMs: 24 * 60 * 60 * 1000,
      });
    }
  }
}

export const deleteProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler", "admin");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("errNotFound");
    const isAdmin = principal.role === "admin";
    if (!isAdmin && product.ownerId !== principal.userId) throw new Error("errNotAuthorized");

    await ctx.db.delete(args.productId);
    return { ok: true };
  },
});

export const duplicateProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) throw new Error("errNotAuthorized");
    await assertProductSlot(ctx, shop);

    const product = await ctx.db.get(args.productId);
    if (!product || product.shopId !== shop._id) throw new Error("errNotAuthorized");

    const now = Date.now();
    const copyName = cleanText(`${product.name} (نسخة)`, 120);
    const newId = await ctx.db.insert("products", {
      ...product,
      name: copyName,
      slug: `${slugify(copyName)}-${Math.random().toString(36).slice(2, 7)}`,
      // A copy must earn its own badge; it does not inherit reviews.
      reviewCount: 0,
      avgProductRating: 0,
      avgSellerRating: 0,
      wilsonScore: 0,
      isWinning: false,
      viewCount: 0,
      favoriteCount: 0,
      contactCount: 0,
      isPaused: false,
      boostedUntil: undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { productId: newId };
  },
});

export const toggleProductPause = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("errNotFound");
    if (product.ownerId !== principal.userId) throw new Error("errNotAuthorized");
    await ctx.db.patch(product._id, {
      isPaused: !product.isPaused,
      updatedAt: Date.now(),
    });
    return { isPaused: !product.isPaused };
  },
});

/** Subscribe to a product's price/stock for the retailer favourites list. */
export const toggleFavorite = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("errNotFound");

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_product", (q) =>
        q.eq("userId", principal.userId).eq("productId", product._id),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(product._id, {
        favoriteCount: Math.max(0, product.favoriteCount - 1),
      });
      return { isFavorite: false };
    }

    await ctx.db.insert("favorites", {
      userId: principal.userId,
      productId: product._id,
      createdAt: Date.now(),
      priceAtFavoriteDa: product.wholesalePriceDa,
    });
    await ctx.db.patch(product._id, { favoriteCount: product.favoriteCount + 1 });
    return { isFavorite: true };
  },
});

/** Record a product view. Cheapest place for the trending signal. */
export const recordView = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product) return { ok: false };
    await ctx.db.patch(product._id, { viewCount: product.viewCount + 1 });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Wholesaler dashboard reads
// ---------------------------------------------------------------------------

export const myProducts = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) return { products: [], shopId: null, sub: null };

    const products = await ctx.db
      .query("products")
      .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
      .collect();

    const sub = await liveShopSubscription(ctx, shop._id);

    return {
      products: products
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((p) => ({
          ...p,
          // Only Pro plans include sponsored placement.
          canBoost: sub?.plan === "pro" || sub?.plan === "basic",
        })),
      shopId: shop._id,
      sub: sub
        ? { plan: sub.plan, expiresAt: sub.expiresAt, isTrial: sub.isTrial ?? false }
        : null,
      shop: {
        name: shop.name,
        verification: shop.verification,
        responseRate: shop.responseRate,
        medianResponseMinutes: shop.medianResponseMinutes,
      },
    };
  },
});

export const productStats = query({
  args: { days: v.union(v.literal("7"), v.literal("30")) },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "wholesaler");
    const shop = principal.shop;
    if (!shop) return { series: [], totals: { views: 0, favorites: 0, contacts: 0 }, perProduct: [] };

    const products = await ctx.db
      .query("products")
      .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
      .collect();
    const ids = new Set(products.map((p) => p._id));

    const since = Date.now() - Number(args.days) * 24 * 60 * 60 * 1000;
    const stats = await ctx.db
      .query("productDailyStats")
      .withIndex("by_day")
      .collect();

    const series = new Map<string, { day: string; views: number; favorites: number; contacts: number }>();
    const perProduct = new Map<
      string,
      { productId: string; name: string; views: number; contacts: number; favorites: number; conversion: number }
    >();

    for (const p of products) {
      perProduct.set(p._id, {
        productId: p._id,
        name: p.name,
        views: p.viewCount,
        contacts: p.contactCount,
        favorites: p.favoriteCount,
        conversion: p.viewCount > 0 ? p.contactCount / p.viewCount : 0,
      });
    }

    for (const s of stats) {
      if (!ids.has(s.productId)) continue;
      if (Date.parse(s.day) < since) continue;
      const bucket = series.get(s.day) ?? {
        day: s.day,
        views: 0,
        favorites: 0,
        contacts: 0,
      };
      bucket.views += s.views;
      bucket.favorites += s.favorites;
      bucket.contacts += s.contactClicks;
      series.set(s.day, bucket);
      const pp = perProduct.get(s.productId);
      if (pp) {
        pp.views += s.views;
        pp.contacts += s.contactClicks;
        pp.favorites += s.favorites;
      }
    }

    const sorted = [...series.values()].sort((a, b) => a.day.localeCompare(b.day));
    const totals = sorted.reduce(
      (acc, d) => ({
        views: acc.views + d.views,
        favorites: acc.favorites + d.favorites,
        contacts: acc.contacts + d.contacts,
      }),
      { views: 0, favorites: 0, contacts: 0 },
    );

    return {
      series: sorted,
      totals,
      perProduct: [...perProduct.values()]
        .map((p) => ({
          ...p,
          conversion: p.views > 0 ? p.contacts / p.views : 0,
        }))
        .sort((a, b) => b.views - a.views),
    };
  },
});

export const MIN_QTYS = MIN_QTY_OPTIONS;
export { MAX_IMAGE_BYTES, MAX_PRODUCT_IMAGES };