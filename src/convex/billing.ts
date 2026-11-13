/**
 * Subscriptions, promo codes, and payments.
 *
 * Race safety for TAJIR-FREE: Convex mutations are serializable (optimistic
 * concurrency control), so the read-count-then-insert sequence inside
 * `redeemPromoCode` cannot interleave with a concurrent redemption. A second
 * caller either retries the whole mutation and then sees maxUses reached, or it
 * conflicts and Convex re-runs it. The cap therefore cannot be exceeded.
 */

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

import { GRACE_PERIOD_DAYS, PROMO_FIRST_N_USERS, cleanText } from "../lib/catalog";
import { readPricing } from "./lib/pricingConfig";
import {
  DAY_MS,
  audit,
  enforceRateLimit,
  liveShopSubscription,
  notify,
  requireAdmin,
  requireUser,
  subscriptionIsLive,
} from "./lib/access";

export const PROMO_FIRST_MONTH = "TAJIR-FREE";

// ---------------------------------------------------------------------------
// Provider interface (webhook-ready, idempotent)
// ---------------------------------------------------------------------------

export type PaymentProvider = {
  slug: string;
  label: string;
  /** Reference the buyer quotes on their bank/CCP/BaridiMob receipt. */
  instructionsAr: string;
  instructionsFr: string;
  /** Verify a provider callback. Not implemented for the manual MVP flow. */
  verifyWebhook?: (payload: unknown) => Promise<{ ok: boolean; reference?: string }>;
};

/**
 * Manual transfer is the only live provider in the MVP. Chargily / SlickPay /
 * Edahabia implement the same shape and slot in here without touching callers.
 */
export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    slug: "manual_transfer",
    label: "Bank / CCP / BaridiMob",
    instructionsAr:
      "حوّل المبلغ إلى الحساب البنكي المعروض، ثم ارفع صورة الوصل. يتفعّل الاشتراك بعد التأكيد.",
    instructionsFr:
      "Effectuez le virement vers le compte affiché, puis téléversez le reçu. L'abonnement démarre après validation.",
  },
];

export const paymentProviders = query({
  args: {},
  handler: async () =>
    PAYMENT_PROVIDERS.map((p) => ({
      slug: p.slug,
      label: p.label,
      instructionsAr: p.instructionsAr,
      instructionsFr: p.instructionsFr,
    })),
});

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

async function nextInvoiceSequence(
  ctx: MutationCtx,
  audience: "wholesaler" | "retailer",
): Promise<number> {
  const last = await ctx.db
    .query("invoices")
    .withIndex("by_audience_sequence", (q) => q.eq("audience", audience))
    .order("desc")
    .first();
  return (last?.sequence ?? 0) + 1;
}

async function issueInvoice(
  ctx: MutationCtx,
  args: {
    ownerId: Id<"users">;
    audience: "wholesaler" | "retailer";
    amountDa: number;
    description: string;
    paymentId?: Id<"payments">;
  },
): Promise<Id<"invoices">> {
  const sequence = await nextInvoiceSequence(ctx, args.audience);
  const prefix = args.audience === "wholesaler" ? "TD-W" : "TD-R";
  return ctx.db.insert("invoices", {
    number: `${prefix}-${String(sequence).padStart(6, "0")}`,
    sequence,
    audience: args.audience,
    ownerId: args.ownerId,
    paymentId: args.paymentId,
    amountDa: args.amountDa,
    issuedAt: Date.now(),
    description: cleanText(args.description, 160),
  });
}

/**
 * Redeem a promo code. Atomic: the cap is enforced by the serializable
 * mutation, so concurrent redemptions can never push usage past maxUses.
 */
export const redeemPromoCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "promo", { userId: principal.userId });

    const code = args.code.trim().toUpperCase();
    if (!code) throw new Error("promoInvalid");

    const promo = await ctx.db
      .query("promoCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();

    if (!promo || !promo.isActive) throw new Error("promoInvalid");
    if (promo.expiresAt !== undefined && promo.expiresAt < Date.now()) {
      throw new Error("promoExpired");
    }

    // One code per user, ever.
    const alreadyRedeemed = await ctx.db
      .query("promoRedemptions")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .collect();
    if (alreadyRedeemed.some((r) => r.codeId === promo._id)) {
      throw new Error("promoAlreadyUsed");
    }

    const promoAudience = principal.role === "wholesaler" ? "wholesaler" : "retailer";
    if (promo.audience !== "both" && promo.audience !== promoAudience) {
      throw new Error("promoWrongAudience");
    }

    // --- the race-critical read ---
    const redemptions = await ctx.db
      .query("promoRedemptions")
      .withIndex("by_code", (q) => q.eq("codeId", promo._id))
      .collect();
    if (redemptions.length >= promo.maxUses) throw new Error("promoUsed");

    const shopId = principal.shop?._id;
    const current = promoAudience === "wholesaler" && shopId
      ? await ctx.db
          .query("subscriptions")
          .withIndex("by_shop", (q) => q.eq("shopId", shopId))
          .order("desc")
          .first()
      : await ctx.db
          .query("subscriptions")
          .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId))
          .order("desc")
          .first();

    const now = Date.now();
    const basePlan = promoAudience === "wholesaler" ? "basic" : "free";
    const extraDays =
      promo.kind === "free_days" ? (promo.freeDays ?? 30) : 0;
    const discountPercent = promo.kind === "percent" ? (promo.percent ?? 0) : 0;

    const startAt = current && subscriptionIsLive(current, now) ? current.expiresAt : now;
    const expiresAt = startAt + extraDays * DAY_MS;

    // The discounted amount is derived from the live config, so the figure on
    // the receipt matches the figure the page advertised.
    const pricing = await readPricing(ctx);
    const listPrice =
      promoAudience === "retailer"
        ? pricing.retailer.plus.monthly
        : pricing.wholesaler.basic.monthly;
    const amountDa = Math.round(listPrice * (1 - discountPercent / 100));

    const subscriptionId = await ctx.db.insert("subscriptions", {
      ownerId: principal.userId,
      shopId,
      audience: promoAudience,
      plan: basePlan,
      status: "active",
      startedAt: now,
      expiresAt,
      promoCodeUsed: promo.code,
    });

    await ctx.db.insert("promoRedemptions", {
      codeId: promo._id,
      code: promo.code,
      userId: principal.userId,
      createdAt: now,
      subscriptionId,
    });

    await notify(ctx, {
      userId: principal.userId,
      type: "subscription_expiring",
      title: "تم تفعيل الكود",
      body: `${promo.code} — اشتراكك مفعّل حتى ${new Date(expiresAt).toLocaleDateString("ar-DZ")}`,
      link: "/billing",
    });

    return {
      subscriptionId,
      plan: basePlan,
      expiresAt,
      remaining: promo.maxUses - redemptions.length - 1,
      amountDa,
    };
  },
});

// ---------------------------------------------------------------------------
// Subscription state
// ---------------------------------------------------------------------------

export const mySubscription = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const now = Date.now();

    if (principal.role === "wholesaler") {
      const shop = principal.shop;
      if (!shop) return null;
      const sub = await liveShopSubscription(ctx, shop._id, now);
      const history = await ctx.db
        .query("subscriptions")
        .withIndex("by_shop", (q) => q.eq("shopId", shop._id))
        .collect();
      return {
        audience: "wholesaler" as const,
        plan: sub?.plan ?? null,
        isActive: sub !== null,
        expiresAt: sub?.expiresAt ?? null,
        isTrial: sub?.isTrial ?? false,
        graceEndsAt: sub ? sub.expiresAt + GRACE_PERIOD_DAYS * DAY_MS : null,
        productCount: (
          await ctx.db.query("products").withIndex("by_shop", (q) => q.eq("shopId", shop._id)).collect()
        ).length,
        inGrace:
          sub !== null && now > sub.expiresAt && now <= sub.expiresAt + GRACE_PERIOD_DAYS * DAY_MS,
        history: history
          .sort((a, b) => b.startedAt - a.startedAt)
          .map((h) => ({
            plan: h.plan,
            status: h.status,
            startedAt: h.startedAt,
            expiresAt: h.expiresAt,
            promoCodeUsed: h.promoCodeUsed ?? null,
          })),
      };
    }

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId))
      .order("desc")
      .first();
    const live = sub && subscriptionIsLive(sub, now) ? sub : null;
    return {
      audience: "retailer" as const,
      plan: live?.plan ?? null,
      isActive: live !== null,
      expiresAt: live?.expiresAt ?? null,
      isTrial: live?.isTrial ?? false,
      graceEndsAt: live ? live.expiresAt + GRACE_PERIOD_DAYS * DAY_MS : null,
      productCount: 0,
      history: [],
      inGrace:
        live !== null && now > live.expiresAt && now <= live.expiresAt + GRACE_PERIOD_DAYS * DAY_MS,
    };
  },
});

/** Redeemed codes and remaining uses, for the admin promo screen. */
export const promoUsage = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const promo = await ctx.db
      .query("promoCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim().toUpperCase()))
      .first();
    if (!promo) return null;
    const redemptions = await ctx.db
      .query("promoRedemptions")
      .withIndex("by_code", (q) => q.eq("codeId", promo._id))
      .collect();
    const users = [];
    for (const r of redemptions) {
      const u = await ctx.db.get(r.userId);
      users.push({ name: u?.name ?? "—", email: u?.email ?? "—", createdAt: r.createdAt });
    }
    return {
      code: promo.code,
      maxUses: promo.maxUses,
      used: redemptions.length,
      remaining: Math.max(0, promo.maxUses - redemptions.length),
      isActive: promo.isActive,
      users: users.sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

// ---------------------------------------------------------------------------
// Payments (manual transfer for the MVP)
// ---------------------------------------------------------------------------

export const submitPayment = mutation({
  args: {
    audience: v.union(v.literal("wholesaler"), v.literal("retailer")),
    plan: v.union(v.literal("trial"), v.literal("free"), v.literal("basic"), v.literal("pro")),
    amountDa: v.number(),
    method: v.union(v.literal("bank"), v.literal("ccp"), v.literal("baridi")),
    reference: v.string(),
    receiptStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "upload", { userId: principal.userId });

    const reference = cleanText(args.reference, 60);
    if (!reference) throw new Error("errRequired");

    const duplicate = await ctx.db
      .query("payments")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId))
      .collect();
    // Idempotency: the same reference cannot create a second pending payment.
    if (duplicate.some((p) => p.reference === reference && p.status === "pending")) {
      throw new Error("errDuplicatePayment");
    }

    return ctx.db.insert("payments", {
      ownerId: principal.userId,
      shopId: principal.shop?._id,
      audience: args.audience,
      plan: args.plan,
      amountDa: Math.round(args.amountDa),
      method: args.method,
      reference,
      receiptStorageId: args.receiptStorageId,
      status: "pending",
      // Derived from the reference, so a provider replay is a no-op.
      idempotencyKey: `${principal.userId}:${reference}`,
      createdAt: Date.now(),
    });
  },
});

export const myPayments = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId))
      .collect();
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.userId))
      .collect();

    const invoiceByPayment = new Map(invoices.map((i) => [i.paymentId, i]));

    return {
      payments: payments
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((p) => ({
          id: p._id,
          plan: p.plan,
          audience: p.audience,
          amountDa: p.amountDa,
          method: p.method,
          reference: p.reference,
          status: p.status,
          createdAt: p.createdAt,
          reviewedAt: p.reviewedAt ?? null,
          rejectReason: p.rejectReason ?? null,
          invoiceNumber: p._id ? (invoiceByPayment.get(p._id)?.number ?? null) : null,
        })),
      invoices: invoices
        .sort((a, b) => b.sequence - a.sequence)
        .map((i) => ({
          number: i.number,
          amountDa: i.amountDa,
          issuedAt: i.issuedAt,
          description: i.description,
        })),
    };
  },
});

/**
 * Admin approval is what actually starts a subscription, so expiry reminders
 * and the grace period all key off this moment.
 */
export const reviewPayment = mutation({
  args: {
    paymentId: v.id("payments"),
    approve: v.boolean(),
    rejectReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error("errNotFound");
    if (payment.status !== "pending") throw new Error("errAlreadyReviewed");

    if (!args.approve) {
      await ctx.db.patch(payment._id, {
        status: "rejected",
        reviewedBy: admin.userId,
        reviewedAt: Date.now(),
        rejectReason: args.rejectReason ? cleanText(args.rejectReason, 300) : undefined,
      });
      await audit(ctx, {
        actorId: admin.userId,
        action: "payment.reject",
        targetType: "payment",
        targetId: payment._id,
        details: payment.reference,
      });
      await notify(ctx, {
        userId: payment.ownerId,
        type: "payment_rejected",
        title: "رُفضت دفعة",
        body: args.rejectReason
          ? `رُفضت دفعة ${payment.reference}: ${cleanText(args.rejectReason, 120)}`
          : `رُفضت دفعة ${payment.reference}`,
        link: "/billing",
      });
      return { ok: true };
    }

    const now = Date.now();
    await ctx.db.patch(payment._id, {
      status: "approved",
      reviewedBy: admin.userId,
      reviewedAt: now,
    });

    const shopId = payment.shopId;
    const existing = shopId
      ? await ctx.db
          .query("subscriptions")
          .withIndex("by_shop", (q) => q.eq("shopId", shopId))
          .order("desc")
          .first()
      : await ctx.db
          .query("subscriptions")
          .withIndex("by_owner", (q) => q.eq("ownerId", payment.ownerId))
          .order("desc")
          .first();

    const startAt = existing && subscriptionIsLive(existing, now) ? existing.expiresAt : now;
    const expiresAt = startAt + 30 * DAY_MS;

    await ctx.db.insert("subscriptions", {
      ownerId: payment.ownerId,
      shopId,
      audience: payment.audience,
      plan: payment.plan,
      status: "active",
      startedAt: now,
      expiresAt,
    });

    await issueInvoice(ctx, {
      ownerId: payment.ownerId,
      audience: payment.audience,
      amountDa: payment.amountDa,
      paymentId: payment._id,
      description: `اشتراك ${payment.plan} — ${payment.reference}`,
    });

    await audit(ctx, {
      actorId: admin.userId,
      action: "payment.approve",
      targetType: "payment",
      targetId: payment._id,
      details: `${payment.plan} ${payment.amountDa} DA`,
    });

    await notify(ctx, {
      userId: payment.ownerId,
      type: "payment_approved",
      title: "تأكيد الدفع",
      body: `تم تفعيل اشتراك ${payment.plan}`,
      link: "/billing",
    });

    return { ok: true, expiresAt };
  },
});

/** Support queries backing the reminder sweep in `expiry.ts`. */
export const allActiveSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    // Reminder sweeps are operational, not user-facing; admins only.
    await requireAdmin(ctx);
    return ctx.db.query("subscriptions").collect();
  },
});

export const expireSubscription = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub || sub.status !== "active") return { ok: false };
    await ctx.db.patch(args.subscriptionId, { status: "expired" });
    await audit(ctx, {
      action: "subscription.expire",
      targetType: "subscription",
      targetId: args.subscriptionId,
    });
    return { ok: true };
  },
});

export const notifyExpiry = mutation({
  args: { subscriptionId: v.id("subscriptions"), remainingDays: v.number() },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) return { ok: false };
    const body =
      args.remainingDays > 0
        ? `اشتراكك ينتهي بعد ${args.remainingDays} يوم. جددو باش منتجاتك تبقا ظاهرة.`
        : "انتهى اشتراكك. عندك 3 أيام سماح قبل ما منتجاتك تختفي.";
    await notify(ctx, {
      userId: sub.ownerId,
      type: "subscription_expiring",
      title: "تذكير بالاشتراك",
      body,
      link: "/billing",
      dedupeKey: `${sub._id}:${args.remainingDays}`,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Admin promo management
// ---------------------------------------------------------------------------

export const createPromoCode = mutation({
  args: {
    code: v.string(),
    kind: v.union(v.literal("free_days"), v.literal("percent")),
    freeDays: v.optional(v.number()),
    percent: v.optional(v.number()),
    maxUses: v.number(),
    expiresAt: v.optional(v.number()),
    audience: v.union(v.literal("wholesaler"), v.literal("retailer"), v.literal("both")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const code = args.code.trim().toUpperCase();
    if (!code) throw new Error("errRequired");

    const existing = await ctx.db
      .query("promoCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (existing) throw new Error("errDuplicatePromo");

    const id = await ctx.db.insert("promoCodes", {
      code,
      kind: args.kind,
      freeDays: args.freeDays,
      percent: args.percent,
      maxUses: Math.max(1, Math.round(args.maxUses)),
      expiresAt: args.expiresAt,
      audience: args.audience,
      isActive: true,
      createdBy: admin.userId,
      createdAt: Date.now(),
    });

    await audit(ctx, {
      actorId: admin.userId,
      action: "promo.create",
      targetType: "promo",
      targetId: id,
      details: `${code} max=${args.maxUses}`,
    });
    return { id, code };
  },
});

export const seedFirstMonthPromo = mutation({
  args: {},
  handler: async (ctx) => {
    // Idempotent: only creates TAJIR-FREE when absent.
    const existing = await ctx.db
      .query("promoCodes")
      .withIndex("by_code", (q) => q.eq("code", PROMO_FIRST_MONTH))
      .first();
    if (existing) return { code: PROMO_FIRST_MONTH, created: false };
    await ctx.db.insert("promoCodes", {
      code: PROMO_FIRST_MONTH,
      kind: "free_days",
      freeDays: 30,
      maxUses: PROMO_FIRST_N_USERS,
      audience: "both",
      isActive: true,
      createdAt: Date.now(),
    });
    return { code: PROMO_FIRST_MONTH, created: true };
  },
});

export type { Doc };