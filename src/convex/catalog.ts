/**
 * Public catalog reads: home feed, search, product page, shop page.
 *
 * Two invariants enforced here rather than in the UI:
 *  1. A wholesaler's WhatsApp number is only attached when the caller is an
 *     entitled retailer (checked via `callerMaySeePhones`).
 *  2. Products belonging to shops without a live subscription never reach the
 *     public feed/search — the data stays safe, just not published.
 */

import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

import { CATEGORIES, WILAYAS, categoryLabel, fuzzyMatches, isCategoryIconKey, wilayaName } from "../lib/catalog";
import {
  type PublicShop,
  type ReviewEligibility,
  buildSearchBlob,
  callerMaySeePhones,
  checkReviewEligibility,
  currentPrincipal,
  liveShopSubscription,
  publicShopFields,
  shopIsPublic,
  todayKey,
} from "./lib/access";

const PAGE_SIZE = 24;

/** Card shape shared by the feed, search results, and shop page. */
type ProductCard = {
  id: Id<"products">;
  name: string;
  slug: string;
  category: string;
  categoryLabelAr: string;
  categoryLabelFr: string;
  wholesalePriceDa: number;
  minQty: number;
  priceTiers: { minQty: number; priceDa: number }[];
  stockStatus: Doc<"products">["stockStatus"];
  imageStorageIds: string[];
  isWinning: boolean;
  wilsonScore: number;
  avgProductRating: number;
  reviewCount: number;
  isBoosted: boolean;
  wilaya: number;
  wilayaAr: string;
  wilayaFr: string;
  shopId: Id<"shops">;
  shopSlug: string;
  shopName: string;
  shopVerified: boolean;
  shopRating: number;
  shopResponseRate: number;
  createdAt: number;
  trendingScore: number;
  /** VIP teaser: no real price on the card, the link goes to /vip/:slug. */
  isVip: boolean;
  /** Present only when the caller may see wholesaler phone numbers. */
  whatsappE164?: string;
};

type SortKey = "newest" | "top_rated" | "price_asc" | "price_desc" | "trending";

function sortValue(card: ProductCard, sort: SortKey): number {
  switch (sort) {
    case "price_asc":
      return card.wholesalePriceDa;
    case "price_desc":
      return -card.wholesalePriceDa;
    case "top_rated":
      // Wilson score first, then raw average, so sample size is respected.
      return -(card.wilsonScore * 100 + card.avgProductRating);
    case "trending":
      return -card.trendingScore;
    case "newest":
    default:
      return -card.createdAt;
  }
}

/** Boosted + winning products float above the rest of the sort. */
function rankCard(card: ProductCard, sort: SortKey): number {
  const boost = card.isBoosted ? 1e15 : 0;
  const winning = card.isWinning ? 1e12 : 0;
  return boost + winning + sortValue(card, sort);
}

/**
 * Load products and assemble cards. `includeHidden` is only ever true for
 * owner/admin reads, never for public queries.
 */
async function buildCards(
  ctx: QueryCtx,
  args: { limit: number; cursor?: number; sort: SortKey; viewerIsEntitled: boolean },
  opts: { includeHidden?: boolean } = {},
): Promise<{
  cards: ProductCard[];
  /** Every card built before pagination, for accurate headline counts. */
  allCards: ProductCard[];
  nextCursor: number | null;
  total: number;
}> {
  const now = Date.now();
  const shopCache = new Map<Id<"shops">, PublicShop | null>();
  const trendingSince = now - 7 * 24 * 60 * 60 * 1000;

  async function loadShop(shopId: Id<"shops">): Promise<PublicShop | null> {
    if (shopCache.has(shopId)) return shopCache.get(shopId) ?? null;
    const shop = await ctx.db.get(shopId);
    let result: PublicShop | null = null;
    if (shop) {
      // Subscription gate. Owners and admins bypass via includeHidden.
      const live = opts.includeHidden
        ? true
        : shop.isActive && (await liveShopSubscription(ctx, shopId, now)) !== null;
      if (live) result = publicShopFields(shop, args.viewerIsEntitled);
    }
    shopCache.set(shopId, result);
    return result;
  }

  const cursor = args.cursor ?? 0;
  // Over-fetch so post-filtering still yields a full page.
  const raw = await ctx.db
    .query("products")
    .withIndex("by_created")
    .order("desc")
    .take(Math.min(cursor + args.limit * 4 + 60, 400));

  const cards: ProductCard[] = [];
  for (const product of raw) {
    if (product.isPaused && !opts.includeHidden) continue;
    const shop = await loadShop(product.shopId);
    if (!shop) continue;

    const stats = await ctx.db
      .query("productDailyStats")
      .withIndex("by_product_day", (q) =>
        q.eq("productId", product._id).gte("day", todayKey(trendingSince)),
      )
      .collect();
    let trendingScore = 0;
    for (const s of stats) {
      if (Date.parse(s.day) < trendingSince) continue;
      trendingScore += s.views + s.contactClicks * 3;
    }

    cards.push({
      id: product._id,
      name: product.name,
      slug: product.slug,
      category: product.category,
      categoryLabelAr: categoryLabel(product.category, "ar"),
      categoryLabelFr: categoryLabel(product.category, "fr"),
      wholesalePriceDa: product.wholesalePriceDa,
      minQty: product.minQty,
      priceTiers: product.priceTiers,
      stockStatus: product.stockStatus,
      imageStorageIds: product.imageStorageIds,
      isWinning: product.isWinning,
      wilsonScore: product.wilsonScore,
      avgProductRating: product.avgProductRating,
      reviewCount: product.reviewCount,
      isBoosted: product.boostedUntil !== undefined && product.boostedUntil > now,
      wilaya: shop.wilaya,
      wilayaAr: wilayaName(shop.wilaya, "ar"),
      wilayaFr: wilayaName(shop.wilaya, "fr"),
      shopId: shop._id,
      shopSlug: shop.slug,
      shopName: shop.name,
      shopVerified: shop.verification === "approved",
      shopRating: shop.ratingSummary?.overall ?? 0,
      shopResponseRate: shop.responseRate,
      createdAt: product.createdAt,
      trendingScore,
      isVip: product.visibility === "vip",
      // A teaser never carries the wholesaler's number here: only the VIP
      // page reveals it, and only after the request is approved.
      ...(args.viewerIsEntitled && product.visibility !== "vip"
        ? { whatsappE164: shop.whatsappE164 }
        : {}),
    });
  }

  cards.sort((a, b) => rankCard(b, args.sort) - rankCard(a, args.sort));

  const page = cards.slice(cursor, cursor + args.limit);
  const next = cursor + args.limit < cards.length ? cursor + args.limit : null;
  return { cards: page, allCards: cards, nextCursor: next, total: cards.length };
}

// ---------------------------------------------------------------------------
// Home feed
// ---------------------------------------------------------------------------

/** Shape every branch of `categories` returns, so callers see one type. */
type CategoryRow = {
  key: string;
  ar: string;
  fr: string;
  icon: import("../lib/catalog").CategoryIconKey;
  order: number;
  active: boolean;
  parent?: string;
};

/**
 * Product types for the whole app, read from `productCategories`.
 *
 * Two deliberate behaviours:
 *  - before the admin table has been migrated, the compiled-in default list is
 *    returned so a fresh deployment renders categories instead of nothing;
 *  - a stored icon that is no longer on the allow-list degrades to the neutral
 *    package glyph rather than throwing in a public query.
 */
async function readCategories(ctx: QueryCtx): Promise<CategoryRow[]> {
  const rows = await ctx.db.query("productCategories").collect();
  if (rows.length === 0) {
    return CATEGORIES.map((c, index) => ({
      key: c.key,
      ar: c.ar,
      fr: c.fr,
      icon: c.icon,
      order: index,
      active: true,
    }));
  }
  rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return rows.map((row) => ({
    key: row.key,
    ar: row.ar,
    fr: row.fr,
    icon: isCategoryIconKey(row.icon) ? row.icon : "Package",
    order: row.order,
    active: row.active,
    ...(row.parent ? { parent: row.parent } : {}),
  }));
}

export const feed = query({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx) => {
    const principal = await currentPrincipal(ctx);
    const entitled = await callerMaySeePhones(ctx, principal);
    const { cards, allCards, total } = await buildCards(
      ctx,
      { limit: 60, cursor: undefined, sort: "trending", viewerIsEntitled: entitled },
      {},
    );

    const now = Date.now();
    const trending = cards.filter((c) => c.trendingScore > 0).slice(0, 12);
    const winning = cards.filter((c) => c.isWinning).slice(0, 12);
    const fresh = [...cards]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12);
    const rest = cards.filter(
      (c) => !trending.some((t) => t.id === c.id),
    );

    return {
      trending,
      winning,
      newArrivals: fresh,
      all: rest.slice(0, PAGE_SIZE),
      hasMore: rest.length > PAGE_SIZE,
      categories: await readCategories(ctx),
      isEntitled: entitled,
      counts: {
        // `total` is every published product; `cards` is only this page.
        products: total,
        // Counted over every built card, not the 60-row page, so a filter by
        // wilaya cannot make the headline jump when the page turns over.
        wilayas: new Set(allCards.map((c) => c.wilaya)).size,
        verifiedShops: new Set(
          allCards.filter((c) => c.shopVerified).map((c) => c.shopId),
        ).size,
        // Real visible reviews, not a slice of the winning rail: the home page
        // used to print the length of that array and call it "reviews".
        reviews: await ctx.db
          .query("reviews")
          .collect()
          .then((rows) => rows.filter((r) => r.status === "visible").length),
      },
      now,
    };
  },
});

// ---------------------------------------------------------------------------
// Search + filters  (filters are expressed in the URL by the client)
// ---------------------------------------------------------------------------

export const search = query({
  args: {
    q: v.optional(v.string()),
    category: v.optional(v.string()),
    wilaya: v.optional(v.number()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    maxMinQty: v.optional(v.number()),
    minRating: v.optional(v.number()),
    winningOnly: v.optional(v.boolean()),
    verifiedOnly: v.optional(v.boolean()),
    inStockOnly: v.optional(v.boolean()),
    vipOnly: v.optional(v.boolean()),
    sort: v.optional(v.string()),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const principal = await currentPrincipal(ctx);
    const entitled = await callerMaySeePhones(ctx, principal);
    const sort = (args.sort as SortKey) ?? "newest";
    const limit = Math.min(args.limit ?? PAGE_SIZE, 60);

    const all = await ctx.db
      .query("products")
      .withIndex("by_created")
      .order("desc")
      .take(500);

    const shopCache = new Map<Id<"shops">, PublicShop | null>();
    const now = Date.now();

    const results: ProductCard[] = [];
    for (const product of all) {
      if (product.isPaused) continue;

      let shop = shopCache.get(product.shopId);
      if (shop === undefined) {
        const doc = await ctx.db.get(product.shopId);
        const live = doc && doc.isActive && (await liveShopSubscription(ctx, doc._id, now));
        shop = doc && live ? publicShopFields(doc, entitled) : null;
        shopCache.set(product.shopId, shop);
      }
      if (!shop) continue;

      if (args.category && product.category !== args.category) continue;
      if (args.wilaya !== undefined && shop.wilaya !== args.wilaya) continue;
      if (args.minPrice !== undefined && product.wholesalePriceDa < args.minPrice) continue;
      if (args.maxPrice !== undefined && product.wholesalePriceDa > args.maxPrice) continue;
      if (args.maxMinQty !== undefined && product.minQty > args.maxMinQty) continue;
      if (args.minRating !== undefined && product.avgProductRating < args.minRating) continue;
      if (args.winningOnly && !product.isWinning) continue;
      if (args.verifiedOnly && shop.verification !== "approved") continue;
      if (args.inStockOnly && product.stockStatus === "out") continue;
      if (args.vipOnly && product.visibility !== "vip") continue;

      if (args.q) {
        // Arabic-folded + typo-tolerant matching across name, tags and shop.
        const blob = buildSearchBlob([product.name, product.tags.join(" "), shop.name]);
        if (!fuzzyMatches(blob, args.q)) continue;
      }

      results.push({
        id: product._id,
        name: product.name,
        slug: product.slug,
        category: product.category,
        categoryLabelAr: categoryLabel(product.category, "ar"),
        categoryLabelFr: categoryLabel(product.category, "fr"),
        wholesalePriceDa: product.wholesalePriceDa,
        minQty: product.minQty,
        priceTiers: product.priceTiers,
        stockStatus: product.stockStatus,
        imageStorageIds: product.imageStorageIds,
        isWinning: product.isWinning,
        wilsonScore: product.wilsonScore,
        avgProductRating: product.avgProductRating,
        reviewCount: product.reviewCount,
        isBoosted: product.boostedUntil !== undefined && product.boostedUntil > now,
        wilaya: shop.wilaya,
        wilayaAr: wilayaName(shop.wilaya, "ar"),
        wilayaFr: wilayaName(shop.wilaya, "fr"),
        shopId: shop._id,
        shopSlug: shop.slug,
        shopName: shop.name,
        shopVerified: shop.verification === "approved",
        shopRating: shop.ratingSummary?.overall ?? 0,
        shopResponseRate: shop.responseRate,
        createdAt: product.createdAt,
        trendingScore: 0,
        isVip: product.visibility === "vip",
        ...(entitled && product.visibility !== "vip"
          ? { whatsappE164: shop.whatsappE164 }
          : {}),
      });
    }

    results.sort((a, b) => rankCard(b, sort) - rankCard(a, sort));
    const cursor = args.cursor ?? 0;
    return {
      results: results.slice(cursor, cursor + limit),
      total: results.length,
      nextCursor: cursor + limit < results.length ? cursor + limit : null,
    };
  },
});

/** The whole list, including inactive types: labels on old products need them. */
export const categories = query({
  args: {},
  handler: async (ctx) => readCategories(ctx),
});

export const wilayas = query({
  args: {},
  handler: async () => WILAYAS,
});

/**
 * Slugs for the sitemap generator.
 *
 * Deliberately uses the same rule as `productBySlug` / `shopBySlug` —
 * `isActive` plus a live subscription — so the sitemap never lists a URL that
 * the app would then refuse to render, and never omits one it does render.
 */
export const sitemapEntries = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 2000, 5000);

    const candidates = await ctx.db.query("shops").withIndex("by_active").collect();

    const products: {
      slug: string;
      updatedAt: number;
      isWinning: boolean;
    }[] = [];
    const shops: { slug: string; createdAt: number }[] = [];

    for (const shop of candidates) {
      if (!shop.isActive) continue;
      if (!(await shopIsPublic(ctx, shop._id))) continue;

      shops.push({ slug: shop.slug, createdAt: shop.createdAt });

      const rows = await ctx.db
        .query("products")
        .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
        .collect();
      for (const product of rows) {
        if (product.isPaused) continue;
        // VIP teasers are unlinked and noindex: never list them.
        if (product.visibility === "vip") continue;
        if (products.length >= limit) break;
        products.push({
          slug: product.slug,
          updatedAt: product.updatedAt,
          isWinning: product.isWinning,
        });
      }
      if (products.length >= limit) break;
    }

    return { products, shops };
  },
});

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

export const productBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const resolved = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!resolved) return null;

    const principal = await currentPrincipal(ctx);
    // A VIP teaser never carries the shop's phone number in this payload:
    // /product/:slug for a teaser redirects to the VIP page, where approval
    // gates the reveal.
    const entitled =
      (await callerMaySeePhones(ctx, principal)) && resolved.visibility !== "vip";

    const shopDoc = await ctx.db.get(resolved.shopId);
    if (!shopDoc) return null;

    // Hidden-shop products 404 publicly but stay reachable by their owner.
    const isOwner = principal?.userId === resolved.ownerId;
    const isAdmin = principal?.role === "admin";
    if (!isOwner && !isAdmin) {
      if (!shopDoc.isActive || !(await shopIsPublic(ctx, shopDoc._id))) return null;
    }

    const shop = publicShopFields(shopDoc, entitled);

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_product", (q) => q.eq("productId", resolved._id))
      .collect();
    const visible = reviews
      .filter((r) => r.status === "visible")
      .sort((a, b) => b.createdAt - a.createdAt);

    const authorNames = new Map<string, string>();
    for (const r of visible) {
      if (!authorNames.has(r.retailerId)) {
        const u = await ctx.db.get(r.retailerId);
        authorNames.set(r.retailerId, u?.name ?? "تاجر");
      }
    }

    // Rating breakdown, 1..5 for product and seller.
    const breakdown = [1, 2, 3, 4, 5].map((star) => ({
      star,
      product: visible.filter((r) => r.productRating === star).length,
      seller: visible.filter((r) => r.sellerRating === star).length,
    }));

    const related = await ctx.db
      .query("products")
      .withIndex("by_category", (q) => q.eq("category", resolved.category))
      .collect();

    const relatedCards: ProductCard[] = [];
    for (const p of related) {
      if (p._id === resolved._id || p.isPaused) continue;
      const s = await ctx.db.get(p.shopId);
      if (!s || !s.isActive || !(await liveShopSubscription(ctx, s._id))) continue;
      relatedCards.push({
        id: p._id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        categoryLabelAr: categoryLabel(p.category, "ar"),
        categoryLabelFr: categoryLabel(p.category, "fr"),
        wholesalePriceDa: p.wholesalePriceDa,
        minQty: p.minQty,
        priceTiers: p.priceTiers,
        stockStatus: p.stockStatus,
        imageStorageIds: p.imageStorageIds,
        isWinning: p.isWinning,
        wilsonScore: p.wilsonScore,
        avgProductRating: p.avgProductRating,
        reviewCount: p.reviewCount,
        isBoosted: p.boostedUntil !== undefined && p.boostedUntil > now(),
        wilaya: s.wilaya,
        wilayaAr: wilayaName(s.wilaya, "ar"),
        wilayaFr: wilayaName(s.wilaya, "fr"),
        shopId: s._id,
        shopSlug: s.slug,
        shopName: s.name,
        shopVerified: s.verification === "approved",
        shopRating: s.ratingSummary?.overall ?? 0,
        shopResponseRate: s.responseRate,
        createdAt: p.createdAt,
        trendingScore: 0,
        isVip: p.visibility === "vip",
      });
      if (relatedCards.length >= 8) break;
    }

    const isFavorite = principal
      ? (await ctx.db
          .query("favorites")
          .withIndex("by_user_product", (q) =>
            q.eq("userId", principal.userId).eq("productId", resolved._id),
          )
          .first()) !== null
      : false;

    const eligible: ReviewEligibility = principal
      ? await checkReviewEligibility(ctx, resolved._id, principal)
      : { ok: false, reason: "signed_out" };

    return {
      product: {
        ...resolved,
        categoryLabelAr: categoryLabel(resolved.category, "ar"),
        categoryLabelFr: categoryLabel(resolved.category, "fr"),
      },
      shop: {
        ...shop,
        wilayaAr: wilayaName(shop.wilaya, "ar"),
        wilayaFr: wilayaName(shop.wilaya, "fr"),
      },
      reviews: visible.map((r) => ({
        id: r._id,
        productRating: r.productRating,
        sellerRating: r.sellerRating,
        comment: r.comment,
        claimedPurchase: r.claimedPurchase ?? false,
        verifiedContact: r.verifiedContact,
        reply: r.reply,
        repliedAt: r.repliedAt,
        createdAt: r.createdAt,
        authorName: authorNames.get(r.retailerId) ?? "تاجر",
      })),
      breakdown,
      related: relatedCards,
      isFavorite,
      // Boost state is decided server-side: calling Date.now() during render on
      // the client would make the component impure and re-evaluate per render.
      isBoosted: resolved.boostedUntil !== undefined && resolved.boostedUntil > Date.now(),
      canReview: eligible.ok,
      canReviewReason: eligible.ok ? null : eligible.reason,
      // The CTA is hidden server-side until entitlement is proven.
      canSeeWhatsapp: Boolean(shop.whatsappE164) && entitled,
    };
  },
});



// ---------------------------------------------------------------------------
// Shop page
// ---------------------------------------------------------------------------

export const shopBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const shopDoc = await ctx.db
      .query("shops")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!shopDoc) return null;

    const principal = await currentPrincipal(ctx);
    const entitled = await callerMaySeePhones(ctx, principal);
    const isOwner = principal?.userId === shopDoc.ownerId;
    const isAdmin = principal?.role === "admin";
    if (!isOwner && !isAdmin && !shopDoc.isActive) return null;

    const products = await ctx.db
      .query("products")
      .withIndex("by_shop", (q) => q.eq("shopId", shopDoc._id))
      .collect();

    const live = await liveShopSubscription(ctx, shopDoc._id);
    const visibleProducts = products.filter((p) => !p.isPaused || isOwner);
    if (!live && !isOwner && !isAdmin) {
      // Unsubscribed shop: show the profile shell but no products.
      return {
        shop: {
          ...publicShopFields(shopDoc, entitled),
          wilayaAr: wilayaName(shopDoc.wilaya, "ar"),
          wilayaFr: wilayaName(shopDoc.wilaya, "fr"),
        },
        products: [],
        stats: { count: 0, winning: 0, categories: [] as string[] },
        subscriptionLive: false,
        canSeeWhatsapp: entitled && Boolean(shopDoc.whatsappE164),
      };
    }

    const cards: ProductCard[] = [];
    for (const p of visibleProducts) {
      cards.push({
        id: p._id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        categoryLabelAr: categoryLabel(p.category, "ar"),
        categoryLabelFr: categoryLabel(p.category, "fr"),
        wholesalePriceDa: p.wholesalePriceDa,
        minQty: p.minQty,
        priceTiers: p.priceTiers,
        stockStatus: p.stockStatus,
        imageStorageIds: p.imageStorageIds,
        isWinning: p.isWinning,
        wilsonScore: p.wilsonScore,
        avgProductRating: p.avgProductRating,
        reviewCount: p.reviewCount,
        isBoosted: p.boostedUntil !== undefined && p.boostedUntil > now(),
        wilaya: shopDoc.wilaya,
        wilayaAr: wilayaName(shopDoc.wilaya, "ar"),
        wilayaFr: wilayaName(shopDoc.wilaya, "fr"),
        shopId: shopDoc._id,
        shopSlug: shopDoc.slug,
        shopName: shopDoc.name,
        shopVerified: shopDoc.verification === "approved",
        shopRating: shopDoc.ratingSummary?.overall ?? 0,
        shopResponseRate: shopDoc.responseRate,
        createdAt: p.createdAt,
        trendingScore: 0,
        isVip: p.visibility === "vip",
        ...(entitled && p.visibility !== "vip"
          ? { whatsappE164: shopDoc.whatsappE164 }
          : {}),
      });
    }
    cards.sort((a, b) => b.createdAt - a.createdAt);

    const reviewRows = await ctx.db
      .query("reviews")
      .withIndex("by_shop", (q) => q.eq("shopId", shopDoc._id))
      .collect();
    const visibleReviews = reviewRows.filter((r) => r.status === "visible");

    return {
      shop: {
        ...publicShopFields(shopDoc, entitled),
        wilayaAr: wilayaName(shopDoc.wilaya, "ar"),
        wilayaFr: wilayaName(shopDoc.wilaya, "fr"),
        ratingSummary: shopDoc.ratingSummary ?? {
          overall: 0,
          count: 0,
          productAvg: 0,
          sellerAvg: 0,
        },
      },
      products: cards,
      stats: {
        count: cards.length,
        winning: cards.filter((c) => c.isWinning).length,
        categories: [...new Set(cards.map((c) => c.category))],
        reviews: visibleReviews.length,
      },
      subscriptionLive: Boolean(live),
      canSeeWhatsapp: entitled && Boolean(shopDoc.whatsappE164),
    };
  },
});

function now(): number {
  return Date.now();
}