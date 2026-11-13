/**
 * VIP rules that must not regress.
 *
 * The convex-test half drives the real mutations and queries so the *payload*
 * guarantees are asserted, not just the helpers: a teaser must never carry the
 * wholesaler's number before approval, an approval must repeat the one-time
 * acknowledgement, three distinct reporters must hide the offer, only the
 * owner may revoke, and the idempotent expiry sweep must flip and notify.
 *
 * The pure half pins the predicates every one of those paths consults.
 */

import { describe, expect, it } from "vitest";
import { convexTest, type TestConvex } from "convex-test";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import schema from "@/convex/schema";
import {
  autoRejectCause,
  checkVipEligibility,
  effectiveVipStatus,
  grantsAccess,
  shouldAutoHideVip,
} from "@/lib/vip";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

const DAY = 24 * 60 * 60 * 1000;

type T = TestConvex<typeof schema>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedBase(t: T) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Wholesaler W",
      email: "owner@t.dz",
      emailVerificationTime: 1,
      role: "wholesaler",
    });
    const shopId = await ctx.db.insert("shops", {
      ownerId,
      name: "Shop",
      slug: `shop-${Math.random().toString(36).slice(2, 8)}`,
      wilaya: 16,
      whatsappE164: "213555000001",
      categories: [],
      deliveryOptions: [],
      avgPrepDays: 2,
      verification: "approved",
      isActive: true,
      responseRate: 1,
      createdAt: Date.now(),
    });
    const productId = await ctx.db.insert("products", {
      shopId,
      ownerId,
      name: "منتوج رابح في فئة إلكترونيات",
      slug: `teaser-${Math.random().toString(36).slice(2, 8)}`,
      category: "electronics",
      wholesalePriceDa: 0,
      minQty: 1,
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
        allowedWilayas: [],
        maxApprovedBuyers: 0,
        requestsOpen: true,
        status: "active",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const row = await ctx.db.get(productId);
    return { ownerId, shopId, productId, slug: row?.slug ?? "" };
  });
}

async function addRetailer(t: T, name: string): Promise<Id<"users">> {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      name,
      email: `${name.toLowerCase()}@t.dz`,
      emailVerificationTime: 1,
    }),
  );
}

async function addRequest(
  t: T,
  base: { productId: Id<"products">; ownerId: Id<"users">; retailerId: Id<"users"> },
  overrides: { status?: Doc<"vipRequests">["status"]; expiresAt?: number } = {},
): Promise<Id<"vipRequests">> {
  return t.run((ctx) =>
    ctx.db.insert("vipRequests", {
      productId: base.productId,
      ownerId: base.ownerId,
      retailerId: base.retailerId,
      quantity: 10,
      wilaya: 16,
      message: "بغيت الكمية هادي",
      status: overrides.status ?? "pending",
      expiresAt: overrides.expiresAt ?? Date.now() + 7 * DAY,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Teaser privacy
// ---------------------------------------------------------------------------

describe("teaser payload privacy", () => {
  it("never exposes the wholesaler's number to a signed-out visitor", async () => {
    const t = convexTest(schema, modules);
    const { slug } = await seedBase(t);

    const data = await t.query(api.vip.teaser, { slug });
    expect(data).not.toBeNull();
    expect(data!.whatsappE164).toBeUndefined();
    expect(data!.canSeeShowcase).toBe(false);
    expect(data!.showcase).toBeNull();
    expect(data!.eligibilityReason).toBe("vipErrSignedIn");
  });

  it("reveals the number only once the request is approved", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Approved");
    await addRequest(t, { ...base, retailerId }, { status: "approved" });

    const data = await t
      .withIdentity({ subject: retailerId })
      .query(api.vip.teaser, { slug: base.slug });
    expect(data!.whatsappE164).toBe("213555000001");
    expect(data!.canSeeShowcase).toBe(true);
  });

  it("keeps the number hidden from a pending requester", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Pending");
    await addRequest(t, { ...base, retailerId }, { status: "pending" });

    const data = await t
      .withIdentity({ subject: retailerId })
      .query(api.vip.teaser, { slug: base.slug });
    expect(data!.whatsappE164).toBeUndefined();
    expect(data!.canSeeShowcase).toBe(false);
    expect(data!.my?.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Acknowledgement
// ---------------------------------------------------------------------------

describe("off-platform acknowledgement", () => {
  it("refuses a request that was not acknowledged", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Requester");

    await expect(
      t.withIdentity({ subject: retailerId }).mutation(api.vip.requestAccess, {
        productId: base.productId,
        quantity: 10,
        wilaya: 16,
        message: "بغيت",
        acknowledged: false,
      }),
    ).rejects.toThrow("errVipAckRequired");
  });

  it("refuses an approval that was not acknowledged", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Requester");
    const requestId = await addRequest(t, { ...base, retailerId });

    await expect(
      t.withIdentity({ subject: base.ownerId }).mutation(api.vip.decide, {
        requestId,
        action: "approve",
        acknowledged: false,
      }),
    ).rejects.toThrow("errVipAckRequired");

    const row = await t.run((ctx) => ctx.db.get(requestId));
    expect(row!.status).toBe("pending");
  });

  it("approves with the ack, records it once and notifies the retailer", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Requester");
    const requestId = await addRequest(t, { ...base, retailerId });

    await t.withIdentity({ subject: base.ownerId }).mutation(api.vip.decide, {
      requestId,
      action: "approve",
      acknowledged: true,
    });

    const row = await t.run((ctx) => ctx.db.get(requestId));
    expect(row!.status).toBe("approved");

    const acks = await t.run((ctx) => ctx.db.query("vipAcks").collect());
    expect(acks).toHaveLength(1);
    expect(acks[0].userId).toBe(base.ownerId);
    expect(acks[0].kind).toBe("approval");

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(
      notes.some((n) => n.userId === retailerId && n.type === "vip"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Report auto-hide
// ---------------------------------------------------------------------------

describe("report auto-hide", () => {
  it("hides the teaser on the third distinct reporter and tells the owner", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);

    for (const name of ["A", "B"]) {
      const reporterId = await addRetailer(t, name);
      const result = await t
        .withIdentity({ subject: reporterId })
        .mutation(api.notifications.reportContent, {
          targetType: "product",
          targetId: base.productId,
          reason: "leaked_product",
        });
      expect(result.autoHidden).toBe(false);
    }

    const third = await addRetailer(t, "C");
    const result = await t
      .withIdentity({ subject: third })
      .mutation(api.notifications.reportContent, {
        targetType: "product",
        targetId: base.productId,
        reason: "leaked_product",
      });
    expect(result.autoHidden).toBe(true);

    const product = await t.run((ctx) => ctx.db.get(base.productId));
    expect(product!.isPaused).toBe(true);

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "vip.auto_hidden")).toBe(true);

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(
      notes.some((n) => n.userId === base.ownerId && n.type === "vip"),
    ).toBe(true);
  });

  it("counts distinct reporters, not report volume", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const reporterId = await addRetailer(t, "Loud");

    for (let i = 0; i < 3; i++) {
      const result = await t
        .withIdentity({ subject: reporterId })
        .mutation(api.notifications.reportContent, {
          targetType: "product",
          targetId: base.productId,
          reason: "scam",
        });
      expect(result.autoHidden).toBe(false);
    }

    const product = await t.run((ctx) => ctx.db.get(base.productId));
    expect(product!.isPaused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

describe("revocation", () => {
  it("lets only the owner or an admin revoke", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Approved");
    const strangerId = await addRetailer(t, "Stranger");
    const requestId = await addRequest(t, { ...base, retailerId }, { status: "approved" });

    await expect(
      t.withIdentity({ subject: strangerId }).mutation(api.vip.revoke, { requestId }),
    ).rejects.toThrow("errNotAuthorized");

    const stillApproved = await t.run((ctx) => ctx.db.get(requestId));
    expect(stillApproved!.status).toBe("approved");

    await t.withIdentity({ subject: base.ownerId }).mutation(api.vip.revoke, { requestId });
    const row = await t.run((ctx) => ctx.db.get(requestId));
    expect(row!.status).toBe("revoked");
  });

  it("cannot revoke a request that was never approved", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Pending");
    const requestId = await addRequest(t, { ...base, retailerId });

    await expect(
      t.withIdentity({ subject: base.ownerId }).mutation(api.vip.revoke, { requestId }),
    ).rejects.toThrow("errVipAlreadyDecided");
  });
});

// ---------------------------------------------------------------------------
// Expiry sweep
// ---------------------------------------------------------------------------

describe("expiry sweep (idempotent)", () => {
  it("flips overdue pending requests and notifies the retailer", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Slow");
    const requestId = await addRequest(
      t,
      { ...base, retailerId },
      { expiresAt: Date.now() - 60 * 60 * 1000 },
    );

    const result = await t.mutation(api.vip.expireRequests, {});
    expect(result.expired).toBe(1);

    const row = await t.run((ctx) => ctx.db.get(requestId));
    expect(row!.status).toBe("expired");

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.some((n) => n.userId === retailerId && n.type === "vip")).toBe(true);

    // Running it again must not double-flip or re-notify.
    const again = await t.mutation(api.vip.expireRequests, {});
    expect(again.expired).toBe(0);
  });

  it("warns a request about to expire without changing its status", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const retailerId = await addRetailer(t, "Soon");
    const requestId = await addRequest(
      t,
      { ...base, retailerId },
      { expiresAt: Date.now() + 12 * 60 * 60 * 1000 },
    );

    const result = await t.mutation(api.vip.expireRequests, {});
    expect(result.warned).toBe(1);
    expect(result.expired).toBe(0);

    const row = await t.run((ctx) => ctx.db.get(requestId));
    expect(row!.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Pure predicates
// ---------------------------------------------------------------------------

describe("checkVipEligibility", () => {
  const base = {
    isSignedIn: true,
    emailVerified: true,
    hasActiveRetailerPlan: true,
    profileComplete: true,
    blockedByThisWholesaler: false,
    hasPendingRequest: false,
    pendingRequestCount: 0,
    requestsOpen: true,
    productActive: true,
    isOwner: false,
  };

  it("passes a complete, signed-in retailer with an open product", () => {
    expect(checkVipEligibility(base)).toBeNull();
  });

  it("names exactly one reason, first failed check wins", () => {
    expect(checkVipEligibility({ ...base, isSignedIn: false })).toBe("vipErrSignedIn");
    expect(checkVipEligibility({ ...base, isOwner: true })).toBe("vipErrOwnProduct");
    expect(checkVipEligibility({ ...base, emailVerified: false })).toBe(
      "vipErrEmailUnverified",
    );
    expect(checkVipEligibility({ ...base, hasActiveRetailerPlan: false })).toBe(
      "vipErrPlanRequired",
    );
    expect(checkVipEligibility({ ...base, profileComplete: false })).toBe(
      "vipErrProfileIncomplete",
    );
    expect(checkVipEligibility({ ...base, blockedByThisWholesaler: true })).toBe(
      "vipErrBlocked",
    );
    expect(checkVipEligibility({ ...base, productActive: false })).toBe("vipErrNotOpen");
    expect(checkVipEligibility({ ...base, hasPendingRequest: true })).toBe(
      "vipErrAlreadyRequested",
    );
    expect(checkVipEligibility({ ...base, pendingRequestCount: 10 })).toBe(
      "vipErrTooManyPending",
    );
    // Blocked still loses to nothing: order matters.
    expect(
      checkVipEligibility({ ...base, isSignedIn: false, blockedByThisWholesaler: true }),
    ).toBe("vipErrSignedIn");
  });
});

describe("autoRejectCause", () => {
  it("accepts everything when the wholesaler set no filter", () => {
    expect(
      autoRejectCause({ wilaya: 16, allowedWilayas: [], quantity: 1, minQuantity: 1 }),
    ).toBeNull();
  });

  it("rejects outside the allowed wilayas and under the minimum", () => {
    expect(
      autoRejectCause({ wilaya: 16, allowedWilayas: [31], quantity: 5, minQuantity: 5 }),
    ).toBe("vipRejectWilaya");
    expect(
      autoRejectCause({ wilaya: 16, allowedWilayas: [16], quantity: 2, minQuantity: 5 }),
    ).toBe("vipRejectQuantity");
  });
});

describe("shouldAutoHideVip", () => {
  it("needs three distinct reporters", () => {
    expect(shouldAutoHideVip(["a", "b", "c"])).toBe(true);
    expect(shouldAutoHideVip(["a", "a", "b"])).toBe(false);
    expect(shouldAutoHideVip(["a", "b", null])).toBe(false);
    expect(shouldAutoHideVip([])).toBe(false);
  });
});

describe("effective status and grants", () => {
  it("only pending requests expire with time", () => {
    expect(effectiveVipStatus({ status: "pending", expiresAt: 1 }, 2)).toBe("expired");
    expect(effectiveVipStatus({ status: "pending", expiresAt: 3 }, 2)).toBe("pending");
    expect(effectiveVipStatus({ status: "approved", expiresAt: 1 }, 2)).toBe("approved");
    expect(effectiveVipStatus({ status: "revoked", expiresAt: 9 }, 2)).toBe("revoked");
  });

  it("grants access only to an approved, unexpired request", () => {
    expect(grantsAccess({ status: "approved", expiresAt: 2 }, 1)).toBe(true);
    expect(grantsAccess({ status: "pending", expiresAt: 2 }, 1)).toBe(false);
    expect(grantsAccess({ status: "revoked", expiresAt: 2 }, 1)).toBe(false);
    expect(grantsAccess({ status: "rejected", expiresAt: 2 }, 1)).toBe(false);
  });
});
