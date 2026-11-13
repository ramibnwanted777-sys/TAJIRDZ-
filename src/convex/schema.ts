import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

/**
 * TajirDz data model.
 *
 * Security notes that shape this schema:
 *  - A wholesaler's WhatsApp number lives ONLY on `shops.whatsappE164`. Public
 *    reads go through queries that strip it unless the caller is a retailer
 *    with an active subscription, so the number never reaches unauthorized
 *    clients even though the client is a normal React app.
 *  - `contactLogs` is the audit trail that makes reviews unforgeable: a review
 *    is only allowed when a matching logged contact exists.
 *  - Promo redemptions and product counters rely on Convex mutations being
 *    serializable, which is what makes the 10-redemption cap race-safe.
 */

// ---------------------------------------------------------------------------
// Enumerated value validators
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMIN: "admin",
  WHOLESALER: "wholesaler",
  RETAILER: "retailer",
} as const;
export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.WHOLESALER),
  v.literal(ROLES.RETAILER),
);
export type Role = Infer<typeof roleValidator>;

export const stockStatusValidator = v.union(
  v.literal("in_stock"),
  v.literal("low"),
  v.literal("out"),
);
export type StockStatus = Infer<typeof stockStatusValidator>;

export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("expired"),
  v.literal("canceled"),
);
export type SubscriptionStatus = Infer<typeof subscriptionStatusValidator>;

export const planValidator = v.union(
  v.literal("trial"),
  v.literal("free"),
  v.literal("basic"),
  v.literal("pro"),
);
export type Plan = Infer<typeof planValidator>;

export const paymentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);
export type PaymentStatus = Infer<typeof paymentStatusValidator>;

export const quoteStatusValidator = v.union(
  v.literal("open"),
  v.literal("closed"),
  v.literal("expired"),
  v.literal("moderated"),
);
export type QuoteStatus = Infer<typeof quoteStatusValidator>;

export const reportStatusValidator = v.union(
  v.literal("open"),
  v.literal("resolved"),
  v.literal("dismissed"),
);

/** A product is either a normal listing or a VIP teaser. */
export const visibilityValidator = v.union(
  v.literal("public"),
  v.literal("vip"),
);
export type Visibility = Infer<typeof visibilityValidator>;

export const vipRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("revoked"),
  v.literal("expired"),
);
export type VipRequestStatus = Infer<typeof vipRequestStatusValidator>;

export const reportTargetValidator = v.union(
  v.literal("product"),
  v.literal("shop"),
  v.literal("review"),
  v.literal("message"),
  v.literal("user"),
);

export const reportReasonValidator = v.union(
  v.literal("scam"),
  v.literal("abuse"),
  v.literal("fake_review"),
  v.literal("counterfeit"),
  v.literal("spam"),
  /** A private VIP teaser was leaked — a VIP-specific escalation. */
  v.literal("leaked_product"),
  v.literal("harassment"),
  v.literal("other"),
);

export const notificationTypeValidator = v.union(
  v.literal("message"),
  v.literal("quote_reply"),
  v.literal("review"),
  v.literal("price_drop"),
  v.literal("restock"),
  v.literal("subscription_expiring"),
  v.literal("payment_approved"),
  v.literal("payment_rejected"),
  v.literal("verification"),
  v.literal("announcement"),
  /** VIP access requests: new, approved, rejected, revoked, expiring. */
  v.literal("vip"),
  /** Outcome of a report the reporter filed — admin resolved/dismissed it. */
  v.literal("report"),
);
export type NotificationType = Infer<typeof notificationTypeValidator>;

export const verificationStatusValidator = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);
export type VerificationStatus = Infer<typeof verificationStatusValidator>;

// ---------------------------------------------------------------------------
// Shared sub-documents
// ---------------------------------------------------------------------------

/** One quantity breakpoint, e.g. 50 units at 1 100 DA. */
const priceTierValidator = v.object({
  minQty: v.number(),
  priceDa: v.number(),
});

const schema = defineSchema(
  {
    ...authTables,

    // Auth-owned user record, extended with marketplace profile fields.
    users: defineTable({
      name: v.optional(v.string()), // do not remove
      image: v.optional(v.string()), // do not remove
      email: v.optional(v.string()), // do not remove
      emailVerificationTime: v.optional(v.number()), // do not remove
      isAnonymous: v.optional(v.boolean()), // do not remove
      role: v.optional(roleValidator), // do not remove

      // Marketplace profile
      wilaya: v.optional(v.number()),
      commune: v.optional(v.string()),
      /** Private contact number. Never returned by public queries. */
      whatsappE164: v.optional(v.string()),
      ownerName: v.optional(v.string()),
      storeType: v.optional(v.string()),
      storeLink: v.optional(v.string()),
      niches: v.optional(v.array(v.string())),
      language: v.optional(v.union(v.literal("ar"), v.literal("fr"))),
      suspended: v.optional(v.boolean()),
      onboardedAt: v.optional(v.number()),
      lastSeenAt: v.optional(v.number()),
    })
      .index("email", ["email"]) // do not remove or modify
      .index("by_role", ["role"]),

    // -----------------------------------------------------------------------
    // Wholesaler shops
    // -----------------------------------------------------------------------
    shops: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      slug: v.string(),
      nameFr: v.optional(v.string()),
      description: v.optional(v.string()),
      wilaya: v.number(),
      commune: v.optional(v.string()),
      address: v.optional(v.string()),
      /** E.164 without '+'. Stripped from public reads unless entitled. */
      whatsappE164: v.string(),
      shopImageStorageId: v.optional(v.string()),
      rcNumber: v.optional(v.string()),
      /** Private storage id of the uploaded commercial-register document. */
      rcDocumentStorageId: v.optional(v.string()),
      categories: v.array(v.string()),
      deliveryOptions: v.array(v.string()),
      avgPrepDays: v.number(),
      verification: verificationStatusValidator,
      verifiedAt: v.optional(v.number()),
      verifiedBy: v.optional(v.id("users")),
      isActive: v.boolean(),
      /** Denormalised response metrics, recomputed from chats/quotes. */
      responseRate: v.number(), // 0..1
      medianResponseMinutes: v.optional(v.number()),
      /**
       * Denormalised rating summary, recomputed whenever one of this shop's
       * products receives a review. `overall` is the seller-facing mean, used
       * for the "4.8/5 · 32 تقييم" line on cards.
       */
      ratingSummary: v.optional(
        v.object({
          overall: v.number(),
          productAvg: v.number(),
          sellerAvg: v.number(),
          count: v.number(),
        }),
      ),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_slug", ["slug"])
      .index("by_wilaya", ["wilaya"])
      .index("by_verification", ["verification"])
      .index("by_active", ["isActive"]),

    // -----------------------------------------------------------------------
    // Products
    // -----------------------------------------------------------------------
    products: defineTable({
      shopId: v.id("shops"),
      ownerId: v.id("users"),
      name: v.string(),
      /** Author keeps one language; the other stays empty rather than machine-translated. */
      nameFr: v.optional(v.string()),
      slug: v.string(),
      category: v.string(),
      description: v.optional(v.string()),
      wholesalePriceDa: v.number(),
      minQty: v.number(),
      priceTiers: v.array(priceTierValidator),
      stockStatus: stockStatusValidator,
      prepDays: v.number(),
      tags: v.array(v.string()),
      /** Convex storage ids, max 5. */
      imageStorageIds: v.array(v.string()),
      isPaused: v.boolean(),
      /** Sponsored placement; expires after 7 days. */
      boostedUntil: v.optional(v.number()),
      featuredRank: v.optional(v.number()),

      // ---- denormalised review aggregates (refreshed on every review change)
      reviewCount: v.number(),
      avgProductRating: v.number(),
      avgSellerRating: v.number(),
      /** Wilson lower bound over product ratings; the winning-product ranking key. */
      wilsonScore: v.number(),
      isWinning: v.boolean(),

      // ---- lifetime counters
      viewCount: v.number(),
      favoriteCount: v.number(),
      contactCount: v.number(),

      createdAt: v.number(),
      updatedAt: v.number(),

      // ------------------------------------------------------- VIP products
      /**
       * Public visibility. When a row is `vip`, this document *is* the teaser:
       * its title, description and price are already generic (no real name, no
       * real price, no images), so a public query cannot leak what it does not
       * hold. The real details live in `vipShowcase`, read only by the owner
       * and by retailers the owner approved — never by list, search, feed or
       * sitemap queries, which never touch that table.
       *
       * Optional rather than required so existing rows stay valid under
       * `schemaValidation: true`; a missing value means "public".
       */
      visibility: v.optional(visibilityValidator),
      vip: v.optional(
        v.object({
          /** Wilayas that may ask for access; empty = every wilaya. */
          allowedWilayas: v.array(v.number()),
          /** Simultaneous approved buyers; 0 = unlimited. */
          maxApprovedBuyers: v.number(),
          /** The wholesaler's "pause new requests" switch. */
          requestsOpen: v.boolean(),
          /** `paused` is the normal `isPaused`; `closed` ends the offer. */
          status: v.union(v.literal("active"), v.literal("closed")),
        }),
      ),
    })
      .index("by_shop", ["shopId"])
      .index("by_shop_active", ["shopId", "isPaused"])
      .index("by_category", ["category"])
      .index("by_slug", ["slug"])
      .index("by_winning", ["isWinning"])
      .index("by_created", ["createdAt"])
      .index("by_boosted", ["boostedUntil"])
      .index("by_owner", ["ownerId"]),

    /** Per-product per-day counters powering the 7/30-day charts and trending. */
    productDailyStats: defineTable({
      productId: v.id("products"),
      day: v.string(), // YYYY-MM-DD, UTC
      views: v.number(),
      favorites: v.number(),
      contactClicks: v.number(),
    })
      .index("by_product_day", ["productId", "day"])
      .index("by_day", ["day"]),

    // -----------------------------------------------------------------------
    // Favorites & compare
    // -----------------------------------------------------------------------
    favorites: defineTable({
      userId: v.id("users"),
      productId: v.id("products"),
      createdAt: v.number(),
      /** Price when favourited, so price-drop alerts can detect the change. */
      priceAtFavoriteDa: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_product", ["userId", "productId"])
      .index("by_product", ["productId"]),

    // -----------------------------------------------------------------------
    // Contact log — the basis for review eligibility and conversion stats
    // -----------------------------------------------------------------------
    contactLogs: defineTable({
      retailerId: v.id("users"),
      shopId: v.id("shops"),
      productId: v.optional(v.id("products")),
      channel: v.union(v.literal("whatsapp"), v.literal("chat")),
      createdAt: v.number(),
    })
      .index("by_retailer_product", ["retailerId", "productId"])
      .index("by_shop", ["shopId"])
      .index("by_product", ["productId"])
      .index("by_retailer", ["retailerId"]),

    // -----------------------------------------------------------------------
    // Reviews — unforgeable by construction
    // -----------------------------------------------------------------------
    reviews: defineTable({
      productId: v.id("products"),
      shopId: v.id("shops"),
      retailerId: v.id("users"),
      productRating: v.number(), // 1..5 "is it a winning product?"
      sellerRating: v.number(), // 1..5 "is the seller honest?"
      comment: v.optional(v.string()),
      photoStorageId: v.optional(v.string()),
      /** Self-declared, rendered differently from a verified-contact review. */
      claimedPurchase: v.optional(v.boolean()),
      /** True when eligibility was proven by a logged contact. */
      verifiedContact: v.boolean(),
      /** Set once the wholesaler answers publicly. */
      reply: v.optional(v.string()),
      repliedAt: v.optional(v.number()),
      status: v.union(v.literal("visible"), v.literal("hidden")),
      flaggedSuspicious: v.optional(v.boolean()),
      suspicionReason: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_product", ["productId"])
      .index("by_shop", ["shopId"])
      .index("by_retailer", ["retailerId"])
      .index("by_product_retailer", ["productId", "retailerId"])
      .index("by_flagged", ["flaggedSuspicious"]),

    // -----------------------------------------------------------------------
    // Subscriptions & payments
    // -----------------------------------------------------------------------
    subscriptions: defineTable({
      ownerId: v.id("users"),
      /** Retailers get one retailer subscription; wholesalers one per shop. */
      shopId: v.optional(v.id("shops")),
      audience: v.union(v.literal("wholesaler"), v.literal("retailer")),
      plan: planValidator,
      status: subscriptionStatusValidator,
      startedAt: v.number(),
      expiresAt: v.number(),
      promoCodeUsed: v.optional(v.string()),
      isTrial: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_owner_status", ["ownerId", "status"])
      .index("by_shop", ["shopId"])
      .index("by_expiry", ["expiresAt"]),

    promoCodes: defineTable({
      code: v.string(),
      kind: v.union(v.literal("free_days"), v.literal("percent")),
      freeDays: v.optional(v.number()),
      percent: v.optional(v.number()),
      maxUses: v.number(),
      /** null means no expiry. */
      expiresAt: v.optional(v.number()),
      audience: v.union(v.literal("wholesaler"), v.literal("retailer"), v.literal("both")),
      isActive: v.boolean(),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_code", ["code"])
      .index("by_active", ["isActive"]),

    promoRedemptions: defineTable({
      codeId: v.id("promoCodes"),
      code: v.string(),
      userId: v.id("users"),
      createdAt: v.number(),
      subscriptionId: v.id("subscriptions"),
    })
      .index("by_code", ["codeId"])
      .index("by_user", ["userId"])
      .index("by_code_user", ["codeId", "userId"]),

    payments: defineTable({
      ownerId: v.id("users"),
      shopId: v.optional(v.id("shops")),
      audience: v.union(v.literal("wholesaler"), v.literal("retailer")),
      plan: planValidator,
      amountDa: v.number(),
      method: v.union(v.literal("bank"), v.literal("ccp"), v.literal("baridi")),
      reference: v.string(),
      receiptStorageId: v.optional(v.string()),
      status: paymentStatusValidator,
      /** Idempotency key so a webhook/provider replay cannot double-apply. */
      idempotencyKey: v.optional(v.string()),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      rejectReason: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_status", ["status"])
      .index("by_reference", ["reference"]),

    invoices: defineTable({
      /** Sequential per audience, e.g. TD-W-000123. */
      number: v.string(),
      sequence: v.number(),
      audience: v.union(v.literal("wholesaler"), v.literal("retailer")),
      ownerId: v.id("users"),
      paymentId: v.optional(v.id("payments")),
      amountDa: v.number(),
      issuedAt: v.number(),
      description: v.string(),
    })
      .index("by_audience_sequence", ["audience", "sequence"])
      .index("by_owner", ["ownerId"]),

    // -----------------------------------------------------------------------
    // Quote requests (RFQ)
    // -----------------------------------------------------------------------
    quoteRequests: defineTable({
      retailerId: v.id("users"),
      productName: v.string(),
      category: v.string(),
      quantity: v.number(),
      targetPriceDa: v.optional(v.number()),
      wilaya: v.number(),
      note: v.optional(v.string()),
      status: quoteStatusValidator,
      /** Indexed denormalised search text for Arabic-normalized matching. */
      searchBlob: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_status", ["status"])
      .index("by_category_wilaya", ["category", "wilaya"])
      .index("by_retailer", ["retailerId"])
      .index("by_expiry", ["expiresAt"]),

    quoteOffers: defineTable({
      requestId: v.id("quoteRequests"),
      shopId: v.id("shops"),
      ownerId: v.id("users"),
      priceDa: v.number(),
      quantityAvailable: v.number(),
      note: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_request", ["requestId"])
      .index("by_shop", ["shopId"])
      .index("by_owner", ["ownerId"]),

    // -----------------------------------------------------------------------
    // Chat
    // -----------------------------------------------------------------------
    chatThreads: defineTable({
      retailerId: v.id("users"),
      shopId: v.id("shops"),
      productId: v.optional(v.id("products")),
      lastMessageAt: v.number(),
      lastMessagePreview: v.optional(v.string()),
      /** First response time in minutes, drives the shop's response metric. */
      firstResponseMinutes: v.optional(v.number()),
      /** Last time the retailer wrote, used to detect unanswered threads. */
      lastRetailerAt: v.number(),
      lastShopAt: v.optional(v.number()),
    })
      .index("by_retailer", ["retailerId"])
      .index("by_shop", ["shopId"])
      .index("by_retailer_shop", ["retailerId", "shopId"]),

    messages: defineTable({
      threadId: v.id("chatThreads"),
      senderId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
      readAt: v.optional(v.number()),
    })
      .index("by_thread", ["threadId"])
      .index("by_thread_time", ["threadId", "createdAt"]),

    // -----------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------
    notifications: defineTable({
      userId: v.id("users"),
      type: notificationTypeValidator,
      title: v.string(),
      body: v.string(),
      link: v.optional(v.string()),
      readAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_read", ["userId", "readAt"]),

    notificationPrefs: defineTable({
      userId: v.id("users"),
      types: v.array(v.string()),
      inApp: v.boolean(),
      push: v.boolean(),
      email: v.boolean(),
    }).index("by_user", ["userId"]),

    pushSubscriptions: defineTable({
      userId: v.id("users"),
      endpoint: v.string(),
      p256dh: v.optional(v.string()),
      auth: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // -----------------------------------------------------------------------
    // Trust & safety
    // -----------------------------------------------------------------------
    reports: defineTable({
      reporterId: v.optional(v.id("users")),
      targetType: reportTargetValidator,
      targetId: v.string(),
      reason: reportReasonValidator,
      details: v.optional(v.string()),
      status: reportStatusValidator,
      resolvedBy: v.optional(v.id("users")),
      resolvedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_status", ["status"])
      .index("by_target", ["targetId"]),

    blocklist: defineTable({
      userId: v.id("users"),
      reason: v.string(),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    auditLog: defineTable({
      actorId: v.optional(v.id("users")),
      action: v.string(),
      targetType: v.string(),
      targetId: v.string(),
      details: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_created", ["createdAt"])
      .index("by_actor", ["actorId"]),

    supportTickets: defineTable({
      userId: v.id("users"),
      subject: v.string(),
      body: v.string(),
      email: v.string(),
      status: v.union(v.literal("open"), v.literal("closed")),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    /** Rate-limit buckets keyed by action + principal (user id or hashed IP). */
    rateLimits: defineTable({
      key: v.string(),
      count: v.number(),
      windowStart: v.number(),
    }).index("by_key", ["key"]),

    /** Server-side UI copy for announcements, seeded demo content, and the
     *  "remote settings" an admin can edit without a deploy. */
    appConfig: defineTable({
      key: v.string(),
      value: v.string(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    /**
     * Product types (categories and their sub-types), managed by the admin
     * instead of being hardcoded in `src/lib/catalog.ts`.
     *
     * `key` is what products store, so it is immutable once written; `ar`/`fr`
     * are the display names and can change at any time. `icon` is one of the
     * allow-listed lucide names in `lib/catalog.ts`, checked on the server.
     * `active` hides a type from *new* choices while keeping the label on
     * products already filed under it.
     */
    productCategories: defineTable({
      key: v.string(),
      ar: v.string(),
      fr: v.string(),
      icon: v.string(),
      order: v.number(),
      active: v.boolean(),
      /** Key of the parent category for a sub-type; absent for a root type. */
      parent: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_key", ["key"])
      .index("by_order", ["order"]),

    // ---------------------------------------------------------------------
    // Courses: independent instructors listing PAID courses. Money never
    // touches the platform — TajirDz only lists, verifies codes and handles
    // complaints, so every table here carries what is needed to enforce that
    // split rather than to process a payment.
    // ---------------------------------------------------------------------
    instructors: defineTable({
      userId: v.id("users"),
      name: v.string(),
      bio: v.string(),
      experience: v.string(),
      photoStorageId: v.optional(v.string()),
      proofLinks: v.array(v.string()),
      /** E.164, shown only to signed-in visitors. */
      contactE164: v.string(),
      wilaya: v.number(),
      socialLinks: v.array(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("suspended"),
        v.literal("closed"),
      ),
      /** Set when a decision is made, so rejections are always explained. */
      decisionNote: v.optional(v.string()),
      decidedBy: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"]),

    courses: defineTable({
      instructorId: v.id("instructors"),
      ownerId: v.id("users"),
      title: v.string(),
      description: v.string(),
      coverStorageId: v.optional(v.string()),
      topics: v.array(v.string()),
      level: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
      language: v.union(v.literal("ar"), v.literal("fr"), v.literal("both")),
      format: v.union(v.literal("live"), v.literal("recorded"), v.literal("in_person")),
      wilaya: v.optional(v.number()),
      durationHours: v.number(),
      priceDa: v.number(),
      startsAt: v.optional(v.number()),
      seats: v.optional(v.number()),
      curriculum: v.array(v.string()),
      previewVideoUrl: v.optional(v.string()),
      externalContact: v.string(),
      status: v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("paused"),
        v.literal("hidden"),
      ),
      hiddenReason: v.optional(v.string()),
      /** Denormalised so the list can sort/filter without a fan-out. */
      viewCount: v.number(),
      ratingCount: v.number(),
      ratingSum: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_instructor", ["instructorId"])
      .index("by_status", ["status"])
      .index("by_created", ["createdAt"]),

    enrollmentCodes: defineTable({
      courseId: v.id("courses"),
      instructorId: v.id("instructors"),
      code: v.string(),
      /** 1 means single-use. */
      maxUses: v.number(),
      uses: v.number(),
      expiresAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      label: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_code", ["code"])
      .index("by_course", ["courseId"])
      .index("by_instructor", ["instructorId"]),

    enrollments: defineTable({
      userId: v.id("users"),
      courseId: v.id("courses"),
      instructorId: v.id("instructors"),
      codeId: v.id("enrollmentCodes"),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_course", ["userId", "courseId"])
      .index("by_course", ["courseId"]),

    courseMaterials: defineTable({
      courseId: v.id("courses"),
      instructorId: v.id("instructors"),
      title: v.string(),
      link: v.string(),
      note: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_course", ["courseId"]),

    courseAnnouncements: defineTable({
      courseId: v.id("courses"),
      instructorId: v.id("instructors"),
      title: v.string(),
      body: v.string(),
      createdAt: v.number(),
    })
      .index("by_course", ["courseId"]),

    courseReviews: defineTable({
      courseId: v.id("courses"),
      userId: v.id("users"),
      instructorId: v.id("instructors"),
      rating: v.number(),
      comment: v.string(),
      instructorReply: v.optional(v.string()),
      replyAt: v.optional(v.number()),
      status: v.union(v.literal("visible"), v.literal("hidden")),
      createdAt: v.number(),
    })
      .index("by_course", ["courseId"])
      .index("by_course_user", ["courseId", "userId"]),

    courseComplaints: defineTable({
      targetType: v.union(v.literal("course"), v.literal("instructor")),
      targetId: v.string(),
      courseId: v.optional(v.id("courses")),
      instructorId: v.optional(v.id("instructors")),
      userId: v.id("users"),
      reason: v.union(
        v.literal("scam"),
        v.literal("fake"),
        v.literal("harassment"),
        v.literal("other"),
      ),
      description: v.string(),
      evidenceStorageIds: v.array(v.string()),
      code: v.optional(v.string()),
      status: v.union(
        v.literal("new"),
        v.literal("investigating"),
        v.literal("resolved"),
        v.literal("rejected"),
      ),
      internalNote: v.optional(v.string()),
      decidedBy: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_status", ["status"])
      .index("by_target", ["targetType", "targetId"]),

    /** One-time "payments happen outside the platform" acknowledgement. */
    courseAcknowledgements: defineTable({
      userId: v.id("users"),
      acknowledgedAt: v.number(),
    }).index("by_user", ["userId"]),

    // -----------------------------------------------------------------------
    // VIP products: the teaser is the `products` row; everything sensitive
    // lives here, behind an owner-or-approved check on every read.
    // -----------------------------------------------------------------------

    /**
     * The private half of a VIP product: real images, real price hint and
     * notes. Read by exactly two audiences — the owning wholesaler and a
     * retailer with an approved request. Nothing else queries this table.
     */
    vipShowcase: defineTable({
      productId: v.id("products"),
      ownerId: v.id("users"),
      /** Up to 4 real product photos. */
      imageStorageIds: v.array(v.string()),
      /** Real price hint, e.g. "3 200 دج / 100 وحدة". */
      priceHint: v.optional(v.string()),
      notes: v.optional(v.string()),
      updatedAt: v.number(),
    }).index("by_product", ["productId"]),

    /** A retailer's request for access to one VIP product. */
    vipRequests: defineTable({
      productId: v.id("products"),
      ownerId: v.id("users"),
      retailerId: v.id("users"),
      /** Quantity the retailer wants to buy. */
      quantity: v.number(),
      wilaya: v.number(),
      message: v.string(),
      status: vipRequestStatusValidator,
      /** Rejection reason or auto-reject cause, shown to the retailer. */
      decisionReason: v.optional(v.string()),
      decidedAt: v.optional(v.number()),
      decidedBy: v.optional(v.id("users")),
      /** Pending requests die here; an idempotent job flips them to expired. */
      expiresAt: v.number(),
      /** The retailer saw the one-time off-platform acknowledgement. */
      acknowledgedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_product", ["productId"])
      .index("by_product_retailer", ["productId", "retailerId"])
      .index("by_retailer", ["retailerId", "status"])
      .index("by_owner", ["ownerId", "status"])
      .index("by_status", ["status"]),

    /**
     * A wholesaler blocked a retailer from all of their VIP products.
     * Scoped per wholesaler: one bad buyer must not be blacklisted site-wide
     * by another seller.
     */
    vipBlocks: defineTable({
      ownerId: v.id("users"),
      userId: v.id("users"),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_owner_user", ["ownerId", "userId"])
      .index("by_user", ["userId"]),

    /** "تقييم VIP" — written by an approved buyer, once per product. */
    vipReviews: defineTable({
      productId: v.id("products"),
      ownerId: v.id("users"),
      userId: v.id("users"),
      /** Honesty: did the wholesaler deliver what was agreed? */
      rating: v.number(),
      comment: v.string(),
      status: v.union(v.literal("visible"), v.literal("hidden")),
      instructorReply: v.optional(v.string()),
      replyAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_product", ["productId"])
      .index("by_product_user", ["productId", "userId"])
      .index("by_owner", ["ownerId"]),

    /** One-time VIP acknowledgements (requesting + approving are separate). */
    vipAcks: defineTable({
      userId: v.id("users"),
      kind: v.union(v.literal("request"), v.literal("approval")),
      acknowledgedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_kind", ["userId", "kind"]),

    /** Marks every seeded row so one script can wipe demo data. */
    demoFlags: defineTable({
      scope: v.string(),
      ids: v.array(v.string()),
    }).index("by_scope", ["scope"]),
  },
  {
    schemaValidation: true,
  },
);

export default schema;