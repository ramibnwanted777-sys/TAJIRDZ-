/**
 * Admin panel: KPIs, moderation queues, and exportable tables.
 *
 * Every mutation writes an audit entry so an admin's actions are traceable.
 * Reads are admin-gated in the query itself rather than only in the router.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

import { cleanText } from "../lib/catalog";
import { normalizeEmail } from "./lib/security";
import {
  audit,
  enforceRateLimit,
  notify,
  requireAdmin,
  refreshProductReviewStats,
  refreshShopRatingSummary,
} from "./lib/access";

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export const kpis = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();

    const users = await ctx.db.query("users").collect();
    const subscriptions = await ctx.db.query("subscriptions").collect();
    const payments = await ctx.db.query("payments").collect();
    const products = await ctx.db.query("products").collect();
    const shops = await ctx.db.query("shops").collect();
    const reviews = await ctx.db.query("reviews").collect();
    const reports = await ctx.db.query("reports").collect();

    const signupsByDay = new Map<string, number>();
    for (const u of users) {
      const day = new Date(u._creationTime).toISOString().slice(0, 10);
      signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1);
    }
    const signups = [...signupsByDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
      .map(([day, count]) => ({ day, count }));

    const activeSubs = subscriptions.filter(
      (s) => s.status === "active" && s.expiresAt > now,
    );

    const revenueByPlan: Record<string, number> = { trial: 0, free: 0, basic: 0, pro: 0 };
    const approved = payments.filter((p) => p.status === "approved");
    for (const p of approved) {
      revenueByPlan[p.plan] = (revenueByPlan[p.plan] ?? 0) + p.amountDa;
    }

    const trials = subscriptions.filter((s) => s.isTrial).length;
    const paid = activeSubs.filter((s) => !s.isTrial).length;

    const categoryCounts = new Map<string, number>();
    for (const p of products) {
      categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
    }

    const wholesalerVolume = new Map<Id<"shops">, number>();
    for (const p of products) {
      wholesalerVolume.set(p.shopId, (wholesalerVolume.get(p.shopId) ?? 0) + 1);
    }
    const topWholesalers = [...wholesalerVolume.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([shopId, count]) => {
        const shop = shops.find((s) => s._id === shopId);
        return { shopId, name: shop?.name ?? "—", products: count };
      });

    return {
      totals: {
        users: users.length,
        wholesalers: users.filter((u) => u.role === "wholesaler").length,
        retailers: users.filter((u) => u.role === "retailer").length,
        shops: shops.length,
        products: products.length,
        reviews: reviews.length,
        openReports: reports.filter((r) => r.status === "open").length,
        pendingPayments: payments.filter((p) => p.status === "pending").length,
        pendingVerifications: shops.filter((s) => s.verification === "pending").length,
      },
      signups,
      activeSubscriptions: activeSubs.length,
      revenueTotal: approved.reduce((a, p) => a + p.amountDa, 0),
      revenueByPlan,
      conversionTrialToPaid: trials + paid === 0 ? 0 : Math.round((paid / (trials + paid)) * 100),
      topCategories: [...categoryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([category, count]) => ({ category, count })),
      topWholesalers,
      suspiciousReviews: reviews.filter((r) => r.flaggedSuspicious).length,
    };
  },
});

// ---------------------------------------------------------------------------
// Tables (shared filter shape)
// ---------------------------------------------------------------------------

export const listUsers = query({
  args: {
    q: v.optional(v.string()),
    role: v.optional(v.string()),
    suspended: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows = await ctx.db.query("users").collect();
    if (args.role) rows = rows.filter((u) => u.role === args.role);
    if (args.suspended !== undefined) {
      rows = rows.filter((u) => Boolean(u.suspended) === args.suspended);
    }
    if (args.q) {
      const needle = args.q.toLowerCase();
      rows = rows.filter(
        (u) => (u.name ?? "").toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle),
      );
    }
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const limit = args.limit ?? 200;
    const page = rows.slice(0, limit);

    // Attach each user's shop and subscription for the table view.
    const shops = await ctx.db.query("shops").collect();
    const shopByOwner = new Map(shops.map((s) => [s.ownerId, s]));
    const subs = await ctx.db.query("subscriptions").collect();
    const now = Date.now();
    const subByOwner = new Map<string, (typeof subs)[number] | undefined>();
    for (const s of subs) {
      const cur = subByOwner.get(s.ownerId);
      if (!cur || s.expiresAt > cur.expiresAt) subByOwner.set(s.ownerId, s);
    }

    return page.map((u) => {
      const shop = shopByOwner.get(u._id);
      const sub = subByOwner.get(u._id);
      return {
        id: u._id,
        name: u.name ?? "—",
        email: u.email ?? "—",
        role: u.role ?? "retailer",
        wilaya: u.wilaya ?? null,
        // Admin is allowed to see every number.
        whatsapp: shop?.whatsappE164 ?? u.whatsappE164 ?? null,
        suspended: u.suspended ?? false,
        // Sign-up no longer sends a code, so most accounts are unproven. The
        // panel says so instead of implying every address was checked.
        emailVerified: Boolean(u.emailVerificationTime),
        verified: shop?.verification === "approved",
        shopName: shop?.name ?? null,
        plan: sub && sub.status === "active" && sub.expiresAt > now ? sub.plan : null,
        createdAt: u._creationTime,
      };
    });
  },
});

export const listPayments = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows = await ctx.db.query("payments").collect();
    if (args.status && args.status !== "all") {
      rows = rows.filter((p) => p.status === args.status);
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, u]));
    return rows.map((p) => ({
      id: p._id,
      ownerName: users.get(p.ownerId)?.name ?? "—",
      ownerEmail: users.get(p.ownerId)?.email ?? "—",
      audience: p.audience,
      plan: p.plan,
      amountDa: p.amountDa,
      method: p.method,
      reference: p.reference,
      status: p.status,
      createdAt: p.createdAt,
      reviewedAt: p.reviewedAt ?? null,
    }));
  },
});

export const listVerifications = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const shops = await ctx.db.query("shops").collect();
    const rows = shops
      .filter((s) => s.verification === "pending" || s.verification === "approved")
      .sort((a, b) => (a.verifiedAt ?? 0) - (b.verifiedAt ?? 0));
    return rows.map((s) => ({
      id: s._id,
      shopName: s.name,
      wilaya: s.wilaya,
      rcNumber: s.rcNumber ?? null,
      verification: s.verification,
      verifiedAt: s.verifiedAt ?? null,
      // Private document: only the admin sees the storage id.
      documentStorageId: s.rcNumber ? `pending:${s._id}` : null,
      createdAt: s.createdAt,
    }));
  },
});

export const listReports = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows = await ctx.db.query("reports").collect();
    if (args.status && args.status !== "all") {
      rows = rows.filter((r) => r.status === args.status);
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows.map((r) => ({
      id: r._id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details ?? null,
      status: r.status,
      createdAt: r.createdAt,
    }));
  },
});

export const listPromos = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const promos = await ctx.db.query("promoCodes").collect();
    const redemptions = await ctx.db.query("promoRedemptions").collect();
    return promos.map((p) => {
      const used = redemptions.filter((r) => r.codeId === p._id).length;
      return {
        id: p._id,
        code: p.code,
        kind: p.kind,
        freeDays: p.freeDays ?? null,
        percent: p.percent ?? null,
        maxUses: p.maxUses,
        used,
        remaining: Math.max(0, p.maxUses - used),
        audience: p.audience,
        isActive: p.isActive,
        expiresAt: p.expiresAt ?? null,
      };
    });
  },
});

export const listReviews = query({
  args: { onlySuspicious: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows = await ctx.db.query("reviews").collect();
    if (args.onlySuspicious) rows = rows.filter((r) => r.flaggedSuspicious);
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const products = new Map((await ctx.db.query("products").collect()).map((p) => [p._id, p]));
    return rows.map((r) => ({
      id: r._id,
      productName: products.get(r.productId)?.name ?? "—",
      productRating: r.productRating,
      sellerRating: r.sellerRating,
      comment: r.comment ?? null,
      status: r.status,
      flagged: r.flaggedSuspicious ?? false,
      suspicionReason: r.suspicionReason ?? null,
      verifiedContact: r.verifiedContact,
      createdAt: r.createdAt,
    }));
  },
});

export const listProducts = query({
  args: { q: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows = await ctx.db.query("products").collect();
    if (args.q) {
      const needle = args.q.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(needle));
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const shops = new Map((await ctx.db.query("shops").collect()).map((s) => [s._id, s]));
    return rows.slice(0, 300).map((p) => ({
      id: p._id,
      name: p.name,
      shopName: shops.get(p.shopId)?.name ?? "—",
      category: p.category,
      priceDa: p.wholesalePriceDa,
      reviewCount: p.reviewCount,
      isPaused: p.isPaused,
      isWinning: p.isWinning,
      createdAt: p.createdAt,
    }));
  },
});

export const auditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_created")
      .order("desc")
      .take(args.limit ?? 100);
    return rows.map((r) => ({
      id: r._id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      details: r.details ?? null,
      createdAt: r.createdAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// Moderation actions
// ---------------------------------------------------------------------------

export const verifyShop = mutation({
  args: { shopId: v.id("shops"), approve: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const shop = await ctx.db.get(args.shopId);
    if (!shop) throw new Error("errNotFound");

    await ctx.db.patch(args.shopId, {
      verification: args.approve ? "approved" : "rejected",
      verifiedAt: args.approve ? Date.now() : undefined,
      verifiedBy: admin.userId,
    });

    await audit(ctx, {
      actorId: admin.userId,
      action: args.approve ? "verification.approve" : "verification.reject",
      targetType: "shop",
      targetId: args.shopId,
      details: shop.name,
    });

    await notify(ctx, {
      userId: shop.ownerId,
      type: "verification",
      title: args.approve ? "تم توثيق محلك" : "لم يتم توثيق محلك",
      body: args.approve
        ? "محلك موثّق دروك. غادي تشوف الشارة الخضراء."
        : "خاصك تصحح الوثائق المرسلة باش توثّق المحل.",
      link: "/dashboard",
    });

    return { ok: true };
  },
});

export const setUserSuspended = mutation({
  args: { userId: v.id("users"), suspended: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin.userId) throw new Error("errCannotSuspendSelf");

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("errNotFound");

    await ctx.db.patch(args.userId, { suspended: args.suspended });
    if (args.suspended) {
      // Suspending a wholesaler also deactivates the shop so the feed drops it.
      const shop = await ctx.db
        .query("shops")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
        .first();
      if (shop) await ctx.db.patch(shop._id, { isActive: false });
    } else {
      // Reactivating must undo the shop deactivation above, or a reinstated
      // wholesaler stays invisible in the feed for no stated reason.
      const shop = await ctx.db
        .query("shops")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
        .first();
      if (shop) await ctx.db.patch(shop._id, { isActive: true });
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: args.suspended ? "user.suspend" : "user.activate",
      targetType: "user",
      targetId: args.userId,
      details: args.reason ? cleanText(args.reason, 200) : undefined,
    });
    return { ok: true };
  },
});

export const moderateReview = mutation({
  args: { reviewId: v.id("reviews"), hide: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("errNotFound");

    await ctx.db.patch(args.reviewId, { status: args.hide ? "hidden" : "visible" });
    // Hiding a review changes the winning score, so recompute.
    await refreshProductReviewStats(ctx, review.productId);
    await refreshShopRatingSummary(ctx, review.shopId);

    await audit(ctx, {
      actorId: admin.userId,
      action: args.hide ? "review.hide" : "review.restore",
      targetType: "review",
      targetId: args.reviewId,
    });

    await notify(ctx, {
      userId: review.retailerId,
      type: "review",
      title: args.hide ? "تم إخفاء تقييمك" : "تم استرجاع تقييمك",
      body: args.hide ? "تم إخفاء التقييم بعد مراجعة الإدارة." : "تقييمك رجع ظاهر.",
    });
    return { ok: true };
  },
});

export const hideProduct = mutation({
  args: { productId: v.id("products"), hide: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("errNotFound");
    await ctx.db.patch(args.productId, { isPaused: args.hide });
    await audit(ctx, {
      actorId: admin.userId,
      action: args.hide ? "product.hide" : "product.restore",
      targetType: "product",
      targetId: args.productId,
      details: product.name,
    });
    return { ok: true };
  },
});

export const resolveReport = mutation({
  args: {
    reportId: v.id("reports"),
    resolution: v.union(v.literal("resolved"), v.literal("dismissed")),
    blockUser: v.optional(v.boolean()),
    /** Tell the reporter what happened — the queue promises a follow-up. */
    notifyReporter: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("errNotFound");

    await ctx.db.patch(args.reportId, {
      status: args.resolution,
      resolvedBy: admin.userId,
      resolvedAt: Date.now(),
    });

    if (args.blockUser) {
      // Resolve the reporter to a user row when the target is a user id.
      try {
        const userId = report.targetId as Id<"users">;
        const user = await ctx.db.get(userId);
        if (user) {
          await ctx.db.insert("blocklist", {
            userId,
            reason: cleanText(report.details ?? report.reason, 200),
            createdBy: admin.userId,
            createdAt: Date.now(),
          });
        }
      } catch {
        // Non-user targets simply are not blockable.
      }
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: `report.${args.resolution}`,
      targetType: report.targetType,
      targetId: report.targetId,
    });

    if (args.notifyReporter && report.reporterId) {
      await notify(ctx, {
        userId: report.reporterId,
        type: "report",
        title: args.resolution === "resolved" ? "تمت معالجة بلاغك" : "تمت مراجعة بلاغك",
        body:
          args.resolution === "resolved"
            ? "شكراً على بلاغك — اتخذنا الإجراء المناسب."
            : "راجعنا بلاغك وقرّرنا عدم اتخاذا إجراء عليه.",
        link: "/notifications",
      });
    }
    return { ok: true };
  },
});

/** Broadcast an announcement: in-app to everyone who has an account. */
export const broadcast = mutation({
  args: { title: v.string(), body: v.string(), audience: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await enforceRateLimit(ctx, "signUp", { userId: admin.userId });

    const title = cleanText(args.title, 120);
    const body = cleanText(args.body, 400);
    if (!title || !body) throw new Error("errRequired");

    const users = await ctx.db.query("users").collect();
    const targets = users.filter((u) => {
      if (!args.audience || args.audience === "all") return true;
      return u.role === args.audience;
    });

    let sent = 0;
    for (const u of targets) {
      await notify(ctx, {
        userId: u._id,
        type: "announcement",
        title,
        body,
        link: "/notifications",
        // Announcements intentionally bypass dedup: they are broadcasts.
        dedupeMs: 0,
      });
      sent++;
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: "broadcast",
      targetType: "user",
      targetId: "*",
      details: `${title} (${sent})`,
    });
    return { sent };
  },
});

export const togglePromoActive = mutation({
  args: { promoId: v.id("promoCodes") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const promo = await ctx.db.get(args.promoId);
    if (!promo) throw new Error("errNotFound");
    await ctx.db.patch(args.promoId, { isActive: !promo.isActive });
    await audit(ctx, {
      actorId: admin.userId,
      action: promo.isActive ? "promo.disable" : "promo.enable",
      targetType: "promo",
      targetId: args.promoId,
      details: promo.code,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Admin management & role assignment
// ---------------------------------------------------------------------------

export const listAdmins = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Find all users with role 'admin'
    const adminUsers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .collect();

    // Check extra configured admin emails from appConfig
    const configRow = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "extra_admin_emails"))
      .first();

    let extraEmails: string[] = [];
    if (configRow?.value) {
      try {
        extraEmails = JSON.parse(configRow.value);
      } catch {
        extraEmails = [];
      }
    }

    const allEmails = Array.from(
      new Set([
        "ramibnwantedd777@gmail.com",
        "ramibnwanted777@gmail.com",
        ...extraEmails,
        ...adminUsers.map((u) => u.email).filter(Boolean),
      ]),
    );

    return {
      admins: adminUsers.map((u) => ({
        id: u._id,
        email: u.email ?? "",
        name: u.name ?? "مسؤول",
        createdAt: u._creationTime,
        isSuperAdmin:
          u.email === "ramibnwantedd777@gmail.com" ||
          u.email === "ramibnwanted777@gmail.com",
      })),
      allAdminEmails: allEmails,
    };
  },
});

export const addAdmin = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const targetEmail = args.email.trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes("@")) {
      throw new Error("errInvalidEmail");
    }

    // 1. If user already exists in database, promote them to admin
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", targetEmail))
      .first();

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        role: "admin",
        name: args.name?.trim() || existingUser.name || "مسؤول المنصة",
      });
    }

    // 2. Persist in extra_admin_emails so future signups automatically get admin
    const configRow = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "extra_admin_emails"))
      .first();

    let extraEmails: string[] = [];
    if (configRow?.value) {
      try {
        extraEmails = JSON.parse(configRow.value);
      } catch {
        extraEmails = [];
      }
    }

    if (!extraEmails.includes(targetEmail)) {
      extraEmails.push(targetEmail);
      if (configRow) {
        await ctx.db.patch(configRow._id, {
          value: JSON.stringify(extraEmails),
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("appConfig", {
          key: "extra_admin_emails",
          value: JSON.stringify(extraEmails),
          updatedAt: Date.now(),
        });
      }
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: "admin.add",
      targetType: "user",
      targetId: existingUser?._id ?? targetEmail,
      details: `Added admin: ${targetEmail}`,
    });

    return { ok: true, email: targetEmail };
  },
});

export const removeAdmin = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const targetEmail = args.email.trim().toLowerCase();

    // Prevent removing super admin
    if (
      targetEmail === "ramibnwantedd777@gmail.com" ||
      targetEmail === "ramibnwanted777@gmail.com"
    ) {
      throw new Error("errCannotRemoveSuperAdmin");
    }

    // Downgrade existing user role if found
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", targetEmail))
      .first();

    if (user) {
      await ctx.db.patch(user._id, { role: "retailer" });
    }

    // Remove from appConfig
    const configRow = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "extra_admin_emails"))
      .first();

    if (configRow?.value) {
      try {
        const extraEmails: string[] = JSON.parse(configRow.value);
        const filtered = extraEmails.filter((e) => e !== targetEmail);
        await ctx.db.patch(configRow._id, {
          value: JSON.stringify(filtered),
          updatedAt: Date.now(),
        });
      } catch {
        // Ignore JSON error
      }
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: "admin.remove",
      targetType: "user",
      targetId: user?._id ?? targetEmail,
      details: `Removed admin: ${targetEmail}`,
    });

    return { ok: true };
  },
});

export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("wholesaler"), v.literal("retailer")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) throw new Error("errNotFound");

    await ctx.db.patch(args.userId, { role: args.role });

    await audit(ctx, {
      actorId: admin.userId,
      action: `user.role_change_to_${args.role}`,
      targetType: "user",
      targetId: args.userId,
      details: `Changed role to ${args.role} for user ${targetUser.email ?? targetUser._id}`,
    });

    return { ok: true };
  },
});

/**
 * Remove an account and everything that lets it sign in again.
 *
 * Deliberately conservative:
 *  - never another admin, never yourself;
 *  - never an owner of a shop, because deleting the person would orphan their
 *    products and reviews (suspend them instead — that already hides the shop);
 *  - the admin must retype the account's e-mail address, so a mis-click on a
 *    row cannot destroy a person's history.
 *
 * Auth rows are deleted first: leaving them behind would let the address sign
 * back in to a user document that no longer exists.
 */
export const deleteUser = mutation({
  args: { userId: v.id("users"), confirmEmail: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin.userId) throw new Error("errCannotDeleteSelf");

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("errNotFound");
    if (user.role === "admin") throw new Error("errCannotDeleteAdmin");
    if (normalizeEmail(args.confirmEmail) !== normalizeEmail(user.email ?? "")) {
      throw new Error("errConfirmMismatch");
    }

    const shop = await ctx.db
      .query("shops")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .first();
    if (shop) throw new Error("errUserHasShop");

    const accounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .collect();
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .filter((q) => q.eq(q.field("accountId"), account._id))
        .collect();
      for (const code of codes) await ctx.db.delete(code._id);
      await ctx.db.delete(account._id);
    }

    const sessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .collect();
    for (const session of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .filter((q) => q.eq(q.field("sessionId"), session._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }

    // Personal rows that only ever belonged to this account.
    for (const table of ["favorites", "notifications", "notificationPrefs", "pushSubscriptions"] as const) {
      const rows = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("userId"), args.userId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }

    const email = user.email ?? String(args.userId);
    await ctx.db.delete(args.userId);

    await audit(ctx, {
      actorId: admin.userId,
      action: "user.delete",
      targetType: "user",
      targetId: args.userId,
      details: `Deleted account ${email}`,
    });

    return { ok: true };
  },
});

export {};