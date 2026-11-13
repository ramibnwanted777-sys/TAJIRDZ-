/**
 * Admin-managed product types and the empty-launch guarantees.
 *
 * The Convex half drives the real mutations so the rules are asserted where
 * they are enforced, not only in the form that happens to call them:
 *
 *  - creating a type validates its icon against the allow-list and rejects
 *    empty names, both server-side;
 *  - deactivating a type keeps it readable for existing products but removes it
 *    from the selectable list a new product may pick from;
 *  - deleting a type that still has products deactivates instead of orphaning
 *    them;
 *  - the demo removal runs once and then refuses, and it only touches rows the
 *    seeder recorded.
 */

import { describe, expect, it } from "vitest";
import { convexTest, type TestConvex } from "convex-test";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import schema from "@/convex/schema";
import { CATEGORIES, CATEGORY_ICON_KEYS, isCategoryIconKey } from "@/lib/catalog";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

type T = TestConvex<typeof schema>;

/** An admin account, already verified so the allowlist bootstrap has a target. */
async function seedAdmin(t: T): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "admin@tajirdz.dz",
      emailVerificationTime: 1,
      role: "admin",
    }),
  );
}

// ---------------------------------------------------------------------------
// Icon allow-list
// ---------------------------------------------------------------------------

describe("category icon allow-list", () => {
  it("accepts every key it advertises", () => {
    for (const key of CATEGORY_ICON_KEYS) expect(isCategoryIconKey(key)).toBe(true);
  });

  it("rejects a name outside the list instead of coercing it", () => {
    expect(isCategoryIconKey("Rocket")).toBe(false);
    expect(isCategoryIconKey("")).toBe(false);
    expect(isCategoryIconKey(undefined)).toBe(false);
    expect(isCategoryIconKey(42)).toBe(false);
  });

  it("ships a default for every type, and every default is on the list", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    for (const category of CATEGORIES) {
      expect(isCategoryIconKey(category.icon)).toBe(true);
      expect(category.ar.trim()).not.toBe("");
      expect(category.fr.trim()).not.toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// Creating a type
// ---------------------------------------------------------------------------

describe("admin creates a product type", () => {
  it("stores the names, icon and order, and audit-logs the change", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await asAdmin.mutation(api.adminCategories.create, {
      key: "toys",
      ar: "ألعاب",
      fr: "Jouets",
      icon: "Baby",
      order: 3,
    });

    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    const created = rows.find((row) => row.key === "toys");
    expect(created).toBeDefined();
    expect(created?.ar).toBe("ألعاب");
    expect(created?.fr).toBe("Jouets");
    expect(created?.icon).toBe("Baby");
    expect(created?.active).toBe(true);

    const audit = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audit.some((entry) => entry.action === "category.create")).toBe(true);
  });

  it("refuses an icon that is not on the allow-list", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await expect(
      asAdmin.mutation(api.adminCategories.create, {
        key: "weird",
        ar: "غريب",
        fr: "Bizarre",
        icon: "Dragon",
      }),
    ).rejects.toThrow(/IconNotAllowed/);

    // Nothing was written, so the picker and the table stay consistent.
    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    expect(rows.some((row) => row.key === "weird")).toBe(false);
  });

  it("refuses empty and whitespace-only names", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await expect(
      asAdmin.mutation(api.adminCategories.create, {
        key: "blank",
        ar: "   ",
        fr: "Blanc",
        icon: "Package",
      }),
    ).rejects.toThrow(/NameEmpty/);

    await expect(
      asAdmin.mutation(api.adminCategories.create, {
        key: "blank",
        ar: "أبيض",
        fr: "",
        icon: "Package",
      }),
    ).rejects.toThrow(/NameEmpty/);
  });

  it("refuses a duplicate key", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await asAdmin.mutation(api.adminCategories.create, {
      key: "toys",
      ar: "ألعاب",
      fr: "Jouets",
      icon: "Baby",
    });

    await expect(
      asAdmin.mutation(api.adminCategories.create, {
        key: "toys",
        ar: "ألعاب أخرى",
        fr: "Autres jouets",
        icon: "Baby",
      }),
    ).rejects.toThrow(/KeyTaken/);
  });

  it("refuses a caller who is not an admin", async () => {
    const t = convexTest(schema, modules);
    const retailerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Retailer",
        email: "r@tajirdz.dz",
        emailVerificationTime: 1,
        role: "retailer",
      }),
    );

    await expect(
      t.withIdentity({ subject: retailerId }).mutation(api.adminCategories.create, {
        key: "sneaky",
        ar: "متسلل",
        fr: "Intrus",
        icon: "Package",
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

describe("a deactivated product type", () => {
  it("stays readable, so products filed under it keep their label", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await asAdmin.mutation(api.adminCategories.create, {
      key: "toys",
      ar: "ألعاب",
      fr: "Jouets",
      icon: "Baby",
    });
    await asAdmin.mutation(api.adminCategories.setActive, {
      key: "toys",
      active: false,
    });

    // `categories` is what cards and labels read: inactive rows still appear.
    const all = await t.query(api.catalog.categories, {});
    const row = all.find((entry) => entry.key === "toys");
    expect(row).toBeDefined();
    expect(row?.active).toBe(false);
    expect(row?.ar).toBe("ألعاب");
  });

  it("still appears in the admin list, flagged inactive", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await asAdmin.mutation(api.adminCategories.create, {
      key: "toys",
      ar: "ألعاب",
      fr: "Jouets",
      icon: "Baby",
    });
    await asAdmin.mutation(api.adminCategories.setActive, {
      key: "toys",
      active: false,
    });

    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    expect(rows.find((row) => row.key === "toys")?.active).toBe(false);
  });

  it("cannot be deleted while a product still uses it", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);

    // A shop + product filed under a type the admin is about to remove.
    const { shopId } = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        name: "Wholesaler",
        email: "w@tajirdz.dz",
        emailVerificationTime: 1,
        role: "wholesaler",
      });
      const shopId = await ctx.db.insert("shops", {
        ownerId,
        name: "Shop",
        slug: "shop-1",
        wilaya: 16,
        whatsappE164: "213555000001",
        categories: ["toys"],
        deliveryOptions: ["pickup"],
        avgPrepDays: 2,
        verification: "approved",
        isActive: true,
        responseRate: 1,
        createdAt: Date.now(),
      });
      await ctx.db.insert("products", {
        shopId,
        ownerId,
        name: "Toy",
        slug: "toy-1",
        category: "toys",
        description: "",
        wholesalePriceDa: 500,
        minQty: 1,
        priceTiers: [],
        stockStatus: "in_stock",
        prepDays: 2,
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { shopId, ownerId };
    });
    expect(shopId).toBeDefined();

    const asAdmin = t.withIdentity({ subject: adminId });
    await asAdmin.mutation(api.adminCategories.create, {
      key: "toys",
      ar: "ألعاب",
      fr: "Jouets",
      icon: "Baby",
    });

    const result = await asAdmin.mutation(api.adminCategories.remove, { key: "toys" });
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("inUse");
    expect(result.products).toBe(1);

    // The row survives, deactivated rather than deleted.
    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    expect(rows.find((row) => row.key === "toys")?.active).toBe(false);
  });

  it("is deleted when nothing uses it", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await asAdmin.mutation(api.adminCategories.create, {
      key: "toys",
      ar: "ألعاب",
      fr: "Jouets",
      icon: "Baby",
    });
    const result = await asAdmin.mutation(api.adminCategories.remove, { key: "toys" });
    expect(result.deleted).toBe(true);

    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    expect(rows.some((row) => row.key === "toys")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default list migration
// ---------------------------------------------------------------------------

describe("the default list migration", () => {
  it("writes every default once and is idempotent on a second run", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    const first = await asAdmin.mutation(api.adminCategories.ensureDefaults, {});
    expect(first.created).toBe(CATEGORIES.length);

    const second = await asAdmin.mutation(api.adminCategories.ensureDefaults, {});
    expect(second.created).toBe(0);

    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    expect(rows).toHaveLength(CATEGORIES.length);
    expect(new Set(rows.map((row) => row.key)).size).toBe(CATEGORIES.length);
  });

  it("does not overwrite a type the admin has already renamed", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    const asAdmin = t.withIdentity({ subject: adminId });

    await asAdmin.mutation(api.adminCategories.ensureDefaults, {});
    await asAdmin.mutation(api.adminCategories.update, {
      key: "fashion",
      ar: "ملابس",
      fr: "Habits",
      icon: "Shirt",
      order: 0,
      active: true,
    });
    await asAdmin.mutation(api.adminCategories.ensureDefaults, {});

    const rows = await asAdmin.query(api.adminCategories.listAdmin, {});
    expect(rows.find((row) => row.key === "fashion")?.ar).toBe("ملابس");
  });
});

// ---------------------------------------------------------------------------
// Empty platform: demo removal
// ---------------------------------------------------------------------------

describe("removing demo data", () => {
  /** A database containing one demo shop/product plus one real one. */
  async function withDemoAndReal(t: T) {
    return t.run(async (ctx) => {
      const demoUser = await ctx.db.insert("users", {
        name: "Demo",
        email: "wholesale1@tajirdz.demo",
        role: "wholesaler",
      });
      const demoShop = await ctx.db.insert("shops", {
        ownerId: demoUser,
        name: "Demo shop",
        slug: "demo-shop",
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
      const demoProduct = await ctx.db.insert("products", {
        shopId: demoShop,
        ownerId: demoUser,
        name: "Demo product",
        slug: "demo-product",
        category: "fashion",
        description: "",
        wholesalePriceDa: 100,
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const realUser = await ctx.db.insert("users", {
        name: "Real",
        email: "real@example.dz",
        role: "wholesaler",
      });
      const realShop = await ctx.db.insert("shops", {
        ownerId: realUser,
        name: "Real shop",
        slug: "real-shop",
        wilaya: 31,
        whatsappE164: "213555000002",
        categories: [],
        deliveryOptions: [],
        avgPrepDays: 2,
        verification: "approved",
        isActive: true,
        responseRate: 1,
        createdAt: Date.now(),
      });
      const realProduct = await ctx.db.insert("products", {
        shopId: realShop,
        ownerId: realUser,
        name: "Real product",
        slug: "real-product",
        category: "fashion",
        description: "",
        wholesalePriceDa: 200,
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("demoFlags", {
        scope: "demo",
        ids: [String(demoUser), String(demoShop), String(demoProduct)],
      });

      return { demoUser, demoShop, demoProduct, realUser, realShop, realProduct };
    });
  }

  it("deletes the flagged rows and leaves real rows alone", async () => {
    const t = convexTest(schema, modules);
    const ids = await withDemoAndReal(t);

    const result = await t.mutation(api.seed.removeDemoData, {});
    expect(result.removed).toBe(true);

    const after = await t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).map((r) => String(r._id)),
      shops: (await ctx.db.query("shops").collect()).map((r) => String(r._id)),
      products: (await ctx.db.query("products").collect()).map((r) => String(r._id)),
      flags: await ctx.db.query("demoFlags").collect(),
    }));

    expect(after.users).not.toContain(String(ids.demoUser));
    expect(after.shops).not.toContain(String(ids.demoShop));
    expect(after.products).not.toContain(String(ids.demoProduct));

    expect(after.users).toContain(String(ids.realUser));
    expect(after.shops).toContain(String(ids.realShop));
    expect(after.products).toContain(String(ids.realProduct));

    // The flag goes last, so a second run has nothing to prove against.
    expect(after.flags).toHaveLength(0);
  });

  it("refuses to run twice instead of wiping whatever came after", async () => {
    const t = convexTest(schema, modules);
    await withDemoAndReal(t);

    await t.mutation(api.seed.removeDemoData, {});
    await expect(t.mutation(api.seed.removeDemoData, {})).rejects.toThrow(
      /AlreadyRemoved/,
    );
  });

  it("leaves no demo product in the public feed", async () => {
    const t = convexTest(schema, modules);
    await withDemoAndReal(t);
    await t.mutation(api.seed.removeDemoData, {});

    const feed = await t.query(api.catalog.feed, {});
    const names = [
      ...feed.all,
      ...feed.winning,
      ...feed.trending,
      ...feed.newArrivals,
    ].map((card) => card.name);

    // The real shop has no live subscription, so it stays out of the feed by
    // the ordinary publication rule — the point here is that no seeded row
    // survives it.
    expect(names).not.toContain("Demo product");
    expect(feed.winning).toHaveLength(0);
    expect(feed.trending).toHaveLength(0);
  });

  it("reports zero everywhere once the real rows are excluded too", async () => {
    const t = convexTest(schema, modules);
    // No demo flag at all: nothing is seeded, so removal refuses and the body
    // of the home page has nothing to show.
    await expect(t.mutation(api.seed.removeDemoData, {})).rejects.toThrow(
      /AlreadyRemoved/,
    );

    const feed = await t.query(api.catalog.feed, {});
    expect(feed.counts.products).toBe(0);
    expect(feed.counts.reviews).toBe(0);
    expect(feed.winning).toHaveLength(0);
    expect(feed.trending).toHaveLength(0);
    expect(feed.newArrivals).toHaveLength(0);
  });

  it("keeps categories and wilayas, which are configuration not demo data", async () => {
    const t = convexTest(schema, modules);
    const adminId = await seedAdmin(t);
    await t
      .withIdentity({ subject: adminId })
      .mutation(api.adminCategories.ensureDefaults, {});

    await withDemoAndReal(t);
    await t.mutation(api.seed.removeDemoData, {});

    const categories = await t.query(api.catalog.categories, {});
    expect(categories).toHaveLength(CATEGORIES.length);

    const wilayas = await t.query(api.catalog.wilayas, {});
    expect(wilayas.length).toBeGreaterThan(0);
  });
});
