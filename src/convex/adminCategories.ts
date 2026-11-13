/**
 * Admin-managed product types.
 *
 * Categories used to live as a hardcoded array in `src/lib/catalog.ts`, which
 * meant adding a type needed a deploy and a reviewer. They now live in the
 * `productCategories` table; this module is the only writer.
 *
 * Rules the server enforces so the admin UI cannot be the only thing standing
 * between bad data and the marketplace:
 *  - the icon must be one of `CATEGORY_ICON_KEYS` (a fixed lucide allow-list),
 *  - neither name may be empty or whitespace,
 *  - the slug is immutable and unique, because products store it,
 *  - a type that is still in use cannot be deleted, only deactivated.
 *
 * Every change is audit-logged, matching the rest of the admin surface.
 */

import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

import { audit, requireAdmin } from "./lib/access";
import { CATEGORY_ICON_KEYS, CATEGORIES, isCategoryIconKey } from "../lib/catalog";

/** Slug a key must match: short, lowercase, safe to put in a URL. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;

const MIN_ORDER = 0;
const MAX_ORDER = 9999;
const MAX_NAME_LENGTH = 60;

/** Trimmed, length-capped, and never empty. */
function cleanName(raw: string, field: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`errCategoryNameEmpty:${field}`);
  if (value.length > MAX_NAME_LENGTH) {
    throw new Error(`errCategoryNameTooLong:${field}`);
  }
  return value;
}

function cleanKey(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!KEY_PATTERN.test(value)) throw new Error("errCategoryKeyInvalid");
  return value;
}

/**
 * Create the default list if it is not there yet.
 *
 * Idempotent by design: it only ever *adds* keys that are missing, so running
 * it on every deployment (or ten times by accident) never overwrites an edit
 * an admin has already made. Returns how many rows were actually inserted.
 */
export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const existing = await ctx.db.query("productCategories").collect();
    const present = new Set(existing.map((row) => row.key));
    const now = Date.now();

    let created = 0;
    const highest = existing.reduce((max, row) => Math.max(max, row.order), -1);
    let order = highest + 1;

    for (const seed of CATEGORIES) {
      if (present.has(seed.key)) continue;
      await ctx.db.insert("productCategories", {
        key: seed.key,
        ar: seed.ar,
        fr: seed.fr,
        icon: seed.icon,
        order: order++,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }

    if (created > 0) {
      await audit(ctx, {
        actorId: admin.userId,
        action: "category.ensureDefaults",
        targetType: "productCategory",
        targetId: "defaults",
        details: `created ${created}`,
      });
    }
    return { created };
  },
});

/** Everything, for the admin list. Ordered, then by key for a stable render. */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("productCategories").collect();
    rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    return rows;
  },
});

/**
 * How many products are filed under a key.
 *
 * Reused by the admin list (to explain why a delete became a deactivate) and
 * by `remove` itself, so the check cannot drift from the explanation.
 */
export async function productCountForKey(
  ctx: MutationCtx,
  key: string,
): Promise<number> {
  const rows = await ctx.db.query("products").collect();
  return rows.filter((row) => row.category === key).length;
}

export const create = mutation({
  args: {
    key: v.string(),
    ar: v.string(),
    fr: v.string(),
    icon: v.string(),
    order: v.optional(v.number()),
    parent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const key = cleanKey(args.key);
    const ar = cleanName(args.ar, "ar");
    const fr = cleanName(args.fr, "fr");
    if (!isCategoryIconKey(args.icon)) throw new Error("errCategoryIconNotAllowed");

    // First row in an empty table seeds the defaults alongside it. Without
    // this, adding one type would switch every reader from the compiled-in
    // fallback to the table and silently drop the other eight types from the
    // home tiles and the product form.
    //
    // The incoming key is skipped: re-creating a default should come back as
    // "already exists" from the clash check below, not as a duplicate insert.
    const before = await ctx.db.query("productCategories").collect();
    if (before.length === 0) {
      const now = Date.now();
      let order = 0;
      for (const seed of CATEGORIES) {
        if (seed.key === key) continue;
        await ctx.db.insert("productCategories", {
          key: seed.key,
          ar: seed.ar,
          fr: seed.fr,
          icon: seed.icon,
          order: order++,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const clash = await ctx.db
      .query("productCategories")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (clash) throw new Error("errCategoryKeyTaken");

    let parent: string | undefined;
    if (args.parent) {
      // Captured in a `const`: the narrowing of `args.parent` does not survive
      // into the index-builder callback, and a `let` would not either.
      const parentKey = cleanKey(args.parent);
      if (parentKey === key) throw new Error("errCategoryParentMissing");
      const parentRow = await ctx.db
        .query("productCategories")
        .withIndex("by_key", (q) => q.eq("key", parentKey))
        .first();
      if (!parentRow) throw new Error("errCategoryParentMissing");
      parent = parentKey;
    }

    const now = Date.now();
    const order =
      args.order === undefined
        ? (await ctx.db.query("productCategories").collect()).length
        : Math.min(MAX_ORDER, Math.max(MIN_ORDER, Math.trunc(args.order)));

    const id = await ctx.db.insert("productCategories", {
      key,
      ar,
      fr,
      icon: args.icon,
      order,
      active: true,
      ...(parent ? { parent } : {}),
      createdAt: now,
      updatedAt: now,
    });

    await audit(ctx, {
      actorId: admin.userId,
      action: "category.create",
      targetType: "productCategory",
      targetId: key,
      details: `${ar} / ${fr} · ${args.icon}`,
    });

    return { id, key };
  },
});

/** Rename, re-icon, re-order, reparent. The slug itself is never rewritten. */
export const update = mutation({
  args: {
    key: v.string(),
    ar: v.string(),
    fr: v.string(),
    icon: v.string(),
    order: v.number(),
    active: v.boolean(),
    parent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const key = cleanKey(args.key);
    if (!isCategoryIconKey(args.icon)) throw new Error("errCategoryIconNotAllowed");

    const row = await ctx.db
      .query("productCategories")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!row) throw new Error("errNotFound");

    let parent: string | undefined;
    if (args.parent) {
      const parentKey = cleanKey(args.parent);
      if (parentKey === key) throw new Error("errCategoryParentMissing");
      const parentRow = await ctx.db
        .query("productCategories")
        .withIndex("by_key", (q) => q.eq("key", parentKey))
        .first();
      if (!parentRow) throw new Error("errCategoryParentMissing");
      parent = parentKey;
    }

    await ctx.db.patch(row._id, {
      ar: cleanName(args.ar, "ar"),
      fr: cleanName(args.fr, "fr"),
      icon: args.icon,
      order: Math.min(MAX_ORDER, Math.max(MIN_ORDER, Math.trunc(args.order))),
      active: args.active,
      parent,
      updatedAt: Date.now(),
    });

    await audit(ctx, {
      actorId: admin.userId,
      action: "category.update",
      targetType: "productCategory",
      targetId: key,
      details: `${args.ar} / ${args.fr} · ${args.icon} · ${args.active ? "active" : "inactive"}`,
    });

    return { ok: true };
  },
});

/** Show or hide a type without touching the products already filed under it. */
export const setActive = mutation({
  args: { key: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db
      .query("productCategories")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!row) throw new Error("errNotFound");

    await ctx.db.patch(row._id, { active: args.active, updatedAt: Date.now() });
    await audit(ctx, {
      actorId: admin.userId,
      action: args.active ? "category.activate" : "category.deactivate",
      targetType: "productCategory",
      targetId: args.key,
    });
    return { ok: true };
  },
});

/**
 * Delete a type, but only when nothing depends on it.
 *
 * A type that still appears on a product (or has sub-types under it) is a label
 * somebody is looking at: deleting it would leave "undefined" in a listing, so
 * the mutation deactivates instead and says which of the two it did.
 */
export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const key = cleanKey(args.key);

    const row = await ctx.db
      .query("productCategories")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!row) throw new Error("errNotFound");

    const products = await ctx.db
      .query("products")
      .collect()
      .then((rows) => rows.filter((row) => row.category === key));
    const children = (await ctx.db.query("productCategories").collect()).filter(
      (other) => other.parent === key,
    );

    if (products.length > 0 || children.length > 0) {
      await ctx.db.patch(row._id, { active: false, updatedAt: Date.now() });
      await audit(ctx, {
        actorId: admin.userId,
        action: "category.deactivate",
        targetType: "productCategory",
        targetId: key,
        details: `in use by ${products.length} product(s), ${children.length} sub-type(s)`,
      });
      return {
        deleted: false,
        reason: products.length > 0 ? "inUse" : "hasChildren",
        products: products.length,
        children: children.length,
      } as const;
    }

    await ctx.db.delete(row._id);
    await audit(ctx, {
      actorId: admin.userId,
      action: "category.delete",
      targetType: "productCategory",
      targetId: key,
    });
    return { deleted: true as const, reason: null, products: 0, children: 0 };
  },
});

/**
 * How many products sit under each type, as one `key → count` map.
 *
 * A single query for the whole panel rather than one per row: the list has to
 * explain *why* a delete became a deactivate before it is pressed, and forty
 * rows must not mean forty subscriptions.
 */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const counts = new Map<string, number>();
    for (const row of await ctx.db.query("products").collect()) {
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }
    return Object.fromEntries(counts);
  },
});

/**
 * Icon names the admin may choose.
 *
 * Served from the allow-list itself so the picker can never offer a name the
 * server would then reject.
 */
export const iconKeys = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return CATEGORY_ICON_KEYS;
  },
});
