/**
 * Contact, chat and quote requests.
 *
 * The WhatsApp number is only ever returned by `revealWhatsapp`, which first
 * proves the caller is a retailer with a live subscription. Hiding the number
 * in the React tree would be cosmetic; hiding it here makes it unreachable.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

import {
  QUOTE_EXPIRY_DAYS,
  cleanText,
  containsLinkOrPhone,
} from "../lib/catalog";
import {
  bumpDailyStat,
  buildSearchBlob,
  callerMaySeePhones,
  currentPrincipal,
  enforceRateLimit,
  liveShopSubscription,
  notify,
  refreshShopResponseMetrics,
  requireUser,
  retailerIsSubscribed,
  todayKey,
} from "./lib/access";

const MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// WhatsApp reveal — the entitlement gate
// ---------------------------------------------------------------------------

/**
 * Returns the wholesaler's WhatsApp number only when the caller is entitled.
 * Every contact click is logged here, which also creates the evidence trail a
 * future review is checked against.
 */
export const revealWhatsapp = mutation({
  args: {
    shopId: v.id("shops"),
    productId: v.optional(v.id("products")),
    productName: v.optional(v.string()),
    productSlug: v.optional(v.string()),
    productUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "retailer") throw new Error("errNotAuthorized");

    await enforceRateLimit(ctx, "contact", { userId: principal.userId });

    const subscribed = await retailerIsSubscribed(ctx, principal.userId);
    if (!subscribed) throw new Error("errSubscriptionRequired");

    const shop = await ctx.db.get(args.shopId);
    if (!shop) throw new Error("errNotFound");

    // Log first: the click is what makes the review possible later on.
    await ctx.db.insert("contactLogs", {
      retailerId: principal.userId,
      shopId: shop._id,
      productId: args.productId,
      channel: "whatsapp",
      createdAt: Date.now(),
    });

    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (product) {
        await ctx.db.patch(product._id, { contactCount: product.contactCount + 1 });
        await bumpDailyStat(ctx, product._id, "contactClicks");
      }
    }

    return {
      whatsappE164: shop.whatsappE164,
      shopName: shop.name,
      productName: args.productName ?? null,
      productUrl: args.productUrl ?? null,
      productSlug: args.productSlug ?? null,
    };
  },
});

/** Non-mutating check used to render the gated CTA state. */
export const contactEntitlement = query({
  args: {},
  handler: async (ctx) => {
    const principal = await currentPrincipal(ctx);
    if (!principal) {
      return { signedIn: false, role: null, subscribed: false, maySeePhones: false };
    }
    const subscribed =
      principal.role === "retailer" ? await retailerIsSubscribed(ctx, principal.userId) : false;
    return {
      signedIn: true,
      role: principal.role,
      subscribed,
      maySeePhones: await callerMaySeePhones(ctx, principal),
    };
  },
});

// ---------------------------------------------------------------------------
// In-app chat
// ---------------------------------------------------------------------------

/** Open (or reuse) a thread and log the first contact for review evidence. */
export const startChat = mutation({
  args: {
    shopId: v.id("shops"),
    productId: v.optional(v.id("products")),
    firstMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "retailer") throw new Error("errNotAuthorized");
    await enforceRateLimit(ctx, "message", { userId: principal.userId });

    const subscribed = await retailerIsSubscribed(ctx, principal.userId);
    if (!subscribed) throw new Error("errSubscriptionRequired");

    const body = cleanText(args.firstMessage, 1000);
    if (!body) throw new Error("errRequired");

    const shop = await ctx.db.get(args.shopId);
    if (!shop) throw new Error("errNotFound");

    const thread: Doc<"chatThreads"> | null = await ctx.db
      .query("chatThreads")
      .withIndex("by_retailer_shop", (q) =>
        q.eq("retailerId", principal.userId).eq("shopId", shop._id),
      )
      .first();

    const now = Date.now();
    // `insert` returns an id, so track the id separately from the document.
    const existingThreadId = thread?._id ?? null;
    const threadId =
      existingThreadId ??
      (await ctx.db.insert("chatThreads", {
        retailerId: principal.userId,
        shopId: shop._id,
        productId: args.productId,
        lastMessageAt: now,
        lastMessagePreview: body.slice(0, 120),
        lastRetailerAt: now,
      }));

    await ctx.db.insert("messages", {
      threadId,
      senderId: principal.userId,
      body,
      createdAt: now,
    });
    await ctx.db.patch(threadId, {
      lastMessageAt: now,
      lastMessagePreview: body.slice(0, 120),
      lastRetailerAt: now,
      productId: args.productId ?? thread?.productId,
    });

    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (product) {
        await ctx.db.patch(product._id, { contactCount: product.contactCount + 1 });
        await bumpDailyStat(ctx, product._id, "contactClicks");
        // Chat contact counts for review eligibility just like WhatsApp.
        const already = await ctx.db
          .query("contactLogs")
          .withIndex("by_retailer_product", (q) =>
            q.eq("retailerId", principal.userId).eq("productId", product._id),
          )
          .first();
        if (!already) {
          await ctx.db.insert("contactLogs", {
            retailerId: principal.userId,
            shopId: shop._id,
            productId: product._id,
            channel: "chat",
            createdAt: now,
          });
        }
      }
    }

    await notify(ctx, {
      userId: shop.ownerId,
      type: "message",
      title: "رسالة جديدة",
      body: body.slice(0, 120),
      link: "/dashboard/messages",
      dedupeKey: `${threadId}`,
    });

    return { threadId };
  },
});

export const sendMessage = mutation({
  args: { threadId: v.id("chatThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "message", { userId: principal.userId });

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("errNotFound");
    const isParty = thread.retailerId === principal.userId;
    const shop = await ctx.db.get(thread.shopId);
    const isShopOwner = shop?.ownerId === principal.userId;
    if (!isParty && !isShopOwner && principal.role !== "admin") {
      throw new Error("errNotAuthorized");
    }

    const body = cleanText(args.body, 1000);
    if (!body) throw new Error("errRequired");

    const now = Date.now();
    await ctx.db.insert("messages", {
      threadId: thread._id,
      senderId: principal.userId,
      body,
      createdAt: now,
    });

    const patch: Partial<Doc<"chatThreads">> = {
      lastMessageAt: now,
      lastMessagePreview: body.slice(0, 120),
    };

    if (isShopOwner) {
      // First response timing feeds the shop's response-rate metric.
      patch.lastShopAt = now;
      if (thread.firstResponseMinutes === undefined) {
        const waitedMs = now - thread.lastRetailerAt;
        patch.firstResponseMinutes = Math.max(1, Math.round(waitedMs / MINUTE));
        await refreshShopResponseMetrics(ctx, thread.shopId);
      }
      await notify(ctx, {
        userId: thread.retailerId,
        type: "message",
        title: "رد من التاجر",
        body: body.slice(0, 120),
        link: "/messages",
        dedupeKey: `${thread._id}`,
      });
    } else {
      patch.lastRetailerAt = now;
      if (shop) {
        await notify(ctx, {
          userId: shop.ownerId,
          type: "message",
          title: "رسالة جديدة",
          body: body.slice(0, 120),
          link: "/dashboard/messages",
          dedupeKey: `${thread._id}`,
        });
      }
    }

    await ctx.db.patch(thread._id, patch);
    return { ok: true };
  },
});

/** Mark the other side's messages in a thread as read. */
export const markThreadRead = mutation({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return { ok: false };
    const shop = await ctx.db.get(thread.shopId);
    const allowed =
      thread.retailerId === principal.userId ||
      shop?.ownerId === principal.userId ||
      principal.role === "admin";
    if (!allowed) throw new Error("errNotAuthorized");

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_time", (q) => q.eq("threadId", thread._id))
      .collect();
    for (const m of messages) {
      if (m.senderId !== principal.userId && m.readAt === undefined) {
        await ctx.db.patch(m._id, { readAt: Date.now() });
      }
    }
    return { ok: true };
  },
});

/** Thread list for the signed-in party; Convex pushes new messages live. */
export const myThreads = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const isWholesaler = principal.role === "wholesaler";
    const shopId = principal.shop?._id;

    const threads = (
      isWholesaler && shopId
        ? await ctx.db
            .query("chatThreads")
            .withIndex("by_shop", (q) => q.eq("shopId", shopId))
            .collect()
        : await ctx.db
            .query("chatThreads")
            .withIndex("by_retailer", (q) => q.eq("retailerId", principal.userId))
            .collect()
    ).sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    const out = [];
    for (const t of threads) {
      const shop = await ctx.db.get(t.shopId);
      const retailer = await ctx.db.get(t.retailerId);
      out.push({
        id: t._id,
        shopId: t.shopId,
        shopName: shop?.name ?? "تاجر",
        // Wholesalers see the buyer's name; retailers see the shop's.
        counterpartName: isWholesaler ? (retailer?.name ?? "بائع") : (shop?.name ?? "تاجر"),
        lastMessagePreview: t.lastMessagePreview ?? "",
        lastMessageAt: t.lastMessageAt,
        productId: t.productId ?? null,
        firstResponseMinutes: t.firstResponseMinutes ?? null,
      });
    }
    return out;
  },
});

/**
 * Messages in a thread, for the signed-in party. This stays a *query* so the
 * chat updates live via Convex reactivity; read receipts are written by the
 * separate `markThreadRead` mutation instead.
 */
export const threadMessages = query({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];
    const shop = await ctx.db.get(thread.shopId);
    const allowed =
      thread.retailerId === principal.userId ||
      shop?.ownerId === principal.userId ||
      principal.role === "admin";
    if (!allowed) throw new Error("errNotAuthorized");

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_time", (q) => q.eq("threadId", thread._id))
      .collect();

    return messages.map((m) => ({
      id: m._id,
      body: m.body,
      createdAt: m.createdAt,
      mine: m.senderId === principal.userId,
    }));
  },
});

// ---------------------------------------------------------------------------
// Quote requests (RFQ)
// ---------------------------------------------------------------------------

export const createQuoteRequest = mutation({
  args: {
    productName: v.string(),
    category: v.string(),
    quantity: v.number(),
    targetPriceDa: v.optional(v.number()),
    wilaya: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (principal.role !== "retailer") throw new Error("errNotAuthorized");
    await enforceRateLimit(ctx, "quote", { userId: principal.userId });

    const productName = cleanText(args.productName, 120);
    const note = args.note ? cleanText(args.note, 600) : undefined;
    // Phone/link smuggling in a public RFQ is the classic scam vector.
    if (note && containsLinkOrPhone(note)) throw new Error("errNoLinksInPublicText");
    if (!productName) throw new Error("errRequired");
    if (args.quantity <= 0) throw new Error("errRequired");

    const now = Date.now();
    const requestId = await ctx.db.insert("quoteRequests", {
      retailerId: principal.userId,
      productName,
      category: args.category,
      quantity: Math.round(args.quantity),
      targetPriceDa: args.targetPriceDa ? Math.round(args.targetPriceDa) : undefined,
      wilaya: args.wilaya,
      note,
      status: "open",
      searchBlob: buildSearchBlob([productName, note, args.category]),
      createdAt: now,
      expiresAt: now + QUOTE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    });

    // Notify matching wholesalers: same category + wilaya (or national).
    const shops = await ctx.db.query("shops").collect();
    let notified = 0;
    for (const shop of shops) {
      if (!shop.isActive) continue;
      if (shop.wilaya !== args.wilaya) continue;
      if (!shop.categories.includes(args.category)) continue;
      if (!(await liveShopSubscription(ctx, shop._id, now))) continue;
      await notify(ctx, {
        userId: shop.ownerId,
        type: "quote_reply",
        title: "طلب عرض جديد",
        body: `${productName} — ${Math.round(args.quantity)} قطعة (${args.wilaya})`,
        link: "/dashboard/quotes",
        dedupeKey: `rfq:${requestId}`,
      });
      notified++;
    }

    return { requestId, notified };
  },
});

export const myQuoteRequests = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const mine = await ctx.db
      .query("quoteRequests")
      .withIndex("by_retailer", (q) => q.eq("retailerId", principal.userId))
      .collect();

    const out = [];
    for (const r of mine.sort((a, b) => b.createdAt - a.createdAt)) {
      const offers = await ctx.db
        .query("quoteOffers")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      const withShop = [];
      for (const o of offers) {
        const shop = await ctx.db.get(o.shopId);
        withShop.push({
          id: o._id,
          priceDa: o.priceDa,
          quantityAvailable: o.quantityAvailable,
          note: o.note,
          shopName: shop?.name ?? "تاجر",
          shopVerified: shop?.verification === "approved",
          shopId: o.shopId,
          createdAt: o.createdAt,
        });
      }
      out.push({
        id: r._id,
        productName: r.productName,
        category: r.category,
        quantity: r.quantity,
        targetPriceDa: r.targetPriceDa ?? null,
        wilaya: r.wilaya,
        note: r.note ?? null,
        status: Date.now() > r.expiresAt && r.status === "open" ? "expired" : r.status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        offers: withShop.sort((a, b) => a.priceDa - b.priceDa),
      });
    }
    return out;
  },
});

/** Open RFQs that match a wholesaler's categories and wilaya. */
export const matchingQuoteRequests = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const shop = principal.shop;
    if (!shop) return [];
    const now = Date.now();

    const all = await ctx.db
      .query("quoteRequests")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    const out = [];
    for (const r of all) {
      if (r.expiresAt < now) continue;
      if (r.retailerId === principal.userId) continue;
      // Match on category and wilaya; a shop may also answer nationally.
      const categoryMatch = shop.categories.includes(r.category);
      const wilayaMatch = shop.wilaya === r.wilaya;
      if (!categoryMatch || !wilayaMatch) continue;

      const offers = await ctx.db
        .query("quoteOffers")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      const mine = offers.find((o) => o.shopId === shop._id);

      out.push({
        id: r._id,
        productName: r.productName,
        category: r.category,
        quantity: r.quantity,
        targetPriceDa: r.targetPriceDa ?? null,
        wilaya: r.wilaya,
        note: r.note ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        offerCount: offers.length,
        myOffer: mine
          ? { id: mine._id, priceDa: mine.priceDa, quantityAvailable: mine.quantityAvailable }
          : null,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const submitQuoteOffer = mutation({
  args: {
    requestId: v.id("quoteRequests"),
    priceDa: v.number(),
    quantityAvailable: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireRoleWholesaler(ctx);
    const shop = principal.shop!;
    await enforceRateLimit(ctx, "quoteOffer", { userId: principal.userId });

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("errNotFound");
    if (request.expiresAt < Date.now()) throw new Error("errRequestExpired");
    if (request.status !== "open") throw new Error("errRequestClosed");
    if (args.priceDa <= 0 || args.quantityAvailable <= 0) throw new Error("errRequired");

    const note = args.note ? cleanText(args.note, 400) : undefined;
    if (note && containsLinkOrPhone(note)) throw new Error("errNoLinksInPublicText");

    const existing = await ctx.db
      .query("quoteOffers")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    const mine = existing.find((o) => o.shopId === shop._id);

    if (mine) {
      await ctx.db.patch(mine._id, {
        priceDa: Math.round(args.priceDa),
        quantityAvailable: Math.round(args.quantityAvailable),
        note,
      });
    } else {
      await ctx.db.insert("quoteOffers", {
        requestId: request._id,
        shopId: shop._id,
        ownerId: principal.userId,
        priceDa: Math.round(args.priceDa),
        quantityAvailable: Math.round(args.quantityAvailable),
        note,
        createdAt: Date.now(),
      });
    }

    await notify(ctx, {
      userId: request.retailerId,
      type: "quote_reply",
      title: "عرض سعر جديد",
      body: `${shop.name}: ${Math.round(args.priceDa)} دج`,
      link: "/quotes",
      dedupeKey: `offer:${request._id}:${shop._id}`,
    });

    return { ok: true };
  },
});

export const closeQuoteRequest = mutation({
  args: { requestId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("errNotFound");
    if (request.retailerId !== principal.userId && principal.role !== "admin") {
      throw new Error("errNotAuthorized");
    }
    await ctx.db.patch(request._id, { status: "closed" });
    return { ok: true };
  },
});

/** Small helper so the wholesaler branch reads the same as the retailer one. */
async function requireRoleWholesaler(ctx: Parameters<typeof requireUser>[0]) {
  const principal = await requireUser(ctx);
  if (principal.role !== "wholesaler" || !principal.shop) throw new Error("errNotAuthorized");
  return principal;
}

export { todayKey };