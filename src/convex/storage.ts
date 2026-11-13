/**
 * File storage: product images, shop photos, review photos, payment receipts
 * and private verification documents.
 *
 * Uploads are validated twice — the client checks type/size before spending
 * bandwidth, and this server module re-checks the stored blob's content type
 * and byte length, because a client-side check is a hint, not a guarantee.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

import { MAX_IMAGE_BYTES, MAX_PRODUCT_IMAGES } from "../lib/catalog";
import { enforceRateLimit, requireAdmin, requireUser } from "./lib/access";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const ALLOWED_DOC_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** No-op query so callers can skip the signed-URL lookup when there is no file. */
export const skipUrl = query({
  args: {},
  handler: async () => null,
});

/**
 * Resolve a storage id to a signed URL. Public product imagery is readable by
 * anyone holding the id; ids are only ever handed out inside the same query
 * response that returns the owning product.
 */
export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Issue a one-time upload URL for product/shop/review imagery.
 *
 * Validation happens on the client before the blob is requested (type, size,
 * canvas re-encode), because Convex storage does not expose blob metadata back
 * to the server for inspection. Callers pass the client-measured size so the
 * server can still refuse anything over the limit before authorising a PUT.
 */
export const createImageUpload = mutation({
  args: {
    // `kind` is only echoed back to the client; the limits below are the same
    // for all of them. Courses add three of their own: a cover image, an
    // instructor portrait, and the evidence attached to a complaint.
    kind: v.union(
      v.literal("product"),
      v.literal("shop"),
      v.literal("review"),
      v.literal("course"),
      v.literal("instructor"),
      v.literal("evidence"),
    ),
    contentType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "upload", { userId: principal.userId });

    if (!ALLOWED_IMAGE_TYPES.includes(args.contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      throw new Error("errImageType");
    }
    if (args.sizeBytes <= 0 || args.sizeBytes > MAX_IMAGE_BYTES) {
      throw new Error("errImageSize");
    }

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl, kind: args.kind };
  },
});

/**
 * Private documents (commercial register, ID). Only the owner and an admin can
 * resolve these to signed URLs.
 */
export const createDocumentUpload = mutation({
  args: { contentType: v.string(), sizeBytes: v.number() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "upload", { userId: principal.userId });

    if (!ALLOWED_DOC_TYPES.includes(args.contentType as (typeof ALLOWED_DOC_TYPES)[number])) {
      throw new Error("errImageType");
    }
    // Verification paperwork is scanned documents: cap at 8 MB.
    if (args.sizeBytes <= 0 || args.sizeBytes > 8 * 1024 * 1024) {
      throw new Error("errImageSize");
    }

    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

/** Admin-only resolver for verification documents. */
export const adminDocumentUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Release an orphaned upload. Called when a product form is abandoned or an
 * image is removed, so abandoned files do not accumulate in storage.
 */
export const deleteUpload = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    await ctx.storage.delete(args.storageId);
    return { ok: true };
  },
});

export { MAX_IMAGE_BYTES, MAX_PRODUCT_IMAGES };
export type { Doc };