/**
 * VIP products — the rules, in one pure module.
 *
 * Nothing here touches Convex or React, so the same function is what the
 * mutation runs, what the form renders and what Vitest asserts. That matters
 * because every rule below is a *promise to a user*: "you may not request twice",
 * "your request expires after seven days", "this wholesaler allows this wilaya".
 * A promise that only exists on the server shows up as a mysterious error; a
 * promise that only exists in the UI shows up as a missing feature.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A pending request goes stale after this many days if nobody answers. */
export const VIP_REQUEST_TTL_DAYS = 7;
/** Remind the retailer one day before their request expires. */
export const VIP_EXPIRY_NOTICE_DAYS = 1;
/** An approved buyer may rate the wholesaler this long after approval. */
export const VIP_REVIEW_DELAY_DAYS = 7;
/** One live request per product, this many in flight across all products. */
export const VIP_MAX_PENDING_PER_PRODUCT = 1;
export const VIP_MAX_PENDING = 10;
/** Three different reporters take a VIP product down pending review. */
export const VIP_AUTO_HIDE_REPORTS = 3;
/** Real photos in the private showcase. */
export const VIP_MAX_SHOWCASE_IMAGES = 4;
/** Teaser text limits: a teaser is a paragraph, not a pitch deck. */
export const VIP_MAX_TEASER_TITLE = 120;
export const VIP_MAX_TEASER_DESCRIPTION = 600;
export const VIP_MAX_MESSAGE = 400;

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Why a retailer cannot send a request. The value doubles as the i18n key, so
 * the client renders the sentence the server would have refused with.
 */
export type VipEligibilityReason =
  | "vipErrSignedIn"
  | "vipErrEmailUnverified"
  | "vipErrPlanRequired"
  | "vipErrProfileIncomplete"
  | "vipErrBlocked"
  | "vipErrAlreadyRequested"
  | "vipErrTooManyPending"
  | "vipErrNotOpen"
  | "vipErrOwnProduct";

export interface VipEligibilityInput {
  isSignedIn: boolean;
  /** The address was confirmed with a code (`emailVerificationTime`). */
  emailVerified: boolean;
  /** An active retailer subscription. */
  hasActiveRetailerPlan: boolean;
  /** Store type and wilaya filled in — the wholesaler decides on those. */
  profileComplete: boolean;
  blockedByThisWholesaler: boolean;
  /** A pending request already exists for this product. */
  hasPendingRequest: boolean;
  pendingRequestCount: number;
  /** `requestsOpen` and product status, as decided by the wholesaler. */
  requestsOpen: boolean;
  productActive: boolean;
  isOwner: boolean;
}

/**
 * The first failed check wins, ordered from "fix your account" to "nothing to
 * do here", so the message a user sees is the one they can actually act on.
 */
export function checkVipEligibility(
  input: VipEligibilityInput,
): VipEligibilityReason | null {
  if (!input.isSignedIn) return "vipErrSignedIn";
  if (input.isOwner) return "vipErrOwnProduct";
  if (!input.emailVerified) return "vipErrEmailUnverified";
  if (!input.hasActiveRetailerPlan) return "vipErrPlanRequired";
  if (!input.profileComplete) return "vipErrProfileIncomplete";
  if (input.blockedByThisWholesaler) return "vipErrBlocked";
  if (!input.productActive || !input.requestsOpen) return "vipErrNotOpen";
  if (input.hasPendingRequest) return "vipErrAlreadyRequested";
  if (input.pendingRequestCount >= VIP_MAX_PENDING) return "vipErrTooManyPending";
  return null;
}

// ---------------------------------------------------------------------------
// Auto-reject
// ---------------------------------------------------------------------------

/**
 * The wholesaler's criteria, applied before a human ever sees the request.
 *
 * These are the product's own published rules (allowed wilayas, minimum
 * quantity), so they are always on: a wholesaler who does not want the filter
 * simply leaves the wilaya list empty and the minimum at 1. Rejecting here is
 * kinder than leaving someone waiting seven days for an answer the seller could
 * already have given.
 *
 * Returns the reason, or `null` when the request may go to the inbox.
 */
export function autoRejectCause(input: {
  wilaya: number;
  allowedWilayas: readonly number[];
  quantity: number;
  minQuantity: number;
}): "vipRejectWilaya" | "vipRejectQuantity" | null {
  if (input.allowedWilayas.length > 0 && !input.allowedWilayas.includes(input.wilaya)) {
    return "vipRejectWilaya";
  }
  if (input.quantity < Math.max(1, Math.round(input.minQuantity))) {
    return "vipRejectQuantity";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type VipRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked"
  | "expired";

/**
 * The status a request is *actually* in right now.
 *
 * A pending row past its expiry reads as `expired` everywhere in the UI and in
 * eligibility checks, without needing the expiry job to have run first — the
 * job only makes it permanent so the notification goes out once.
 */
export function effectiveVipStatus(
  request: { status: VipRequestStatus; expiresAt: number },
  now: number,
): VipRequestStatus {
  if (request.status === "pending" && request.expiresAt <= now) return "expired";
  return request.status;
}

export function vipStatusKey(status: VipRequestStatus): string {
  if (status === "pending") return "vipStatusPending";
  if (status === "approved") return "vipStatusApproved";
  if (status === "rejected") return "vipStatusRejected";
  if (status === "revoked") return "vipStatusRevoked";
  return "vipStatusExpired";
}

/** Only an approved, unexpired request is a live access grant. */
export function grantsAccess(
  request: { status: VipRequestStatus; expiresAt: number },
  now: number,
): boolean {
  return effectiveVipStatus(request, now) === "approved";
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

/**
 * The public title of a VIP product: generic by construction.
 *
 * `template` comes from the dictionary ("منتج رابح في فئة {category}") and the
 * category label is the only thing interpolated, so no seller-typed text can
 * reach this string.
 */
export function vipTeaserTitle(
  template: string,
  categoryLabel: string,
): string {
  return template.replace("{category}", categoryLabel);
}

/**
 * The watermark stamped over the private showcase.
 *
 * Honest by design: it identifies *who* is looking, which is what makes
 * leaking traceable, and the page says plainly that screenshots cannot be
 * stopped.
 */
export function watermarkText(input: {
  name: string;
  userId: string;
  date: string;
}): string {
  const who = input.name.trim() || "TajirDz";
  return `${who} · ${input.userId.slice(-6)} · ${input.date}`;
}

/**
 * The prefilled WhatsApp message an approved retailer opens.
 *
 * Deliberately says nothing about the product: the deal is theirs to negotiate
 * directly, and the message must not become a screenshot of someone else's
 * commercial terms.
 */
export function vipWhatsappMessage(wholesalerName: string, lang: "ar" | "fr"): string {
  const who = wholesalerName.trim();
  return lang === "ar"
    ? `السلام عليكم${who ? ` ${who}` : ""}، طلبت الوصول لمنتج VIP في TajirDz وتوافقكم. حاب نتفاهم معاكم على الكمية والثمن والتوصيل.`
    : `Bonjour${who ? ` ${who}` : ""}, mon accès à votre produit VIP sur TajirDz a été accepté. Je souhaite convenir de la quantité, du prix et de la livraison.`;
}

// ---------------------------------------------------------------------------
// Report escalation
// ---------------------------------------------------------------------------

/**
 * Distinct reporters that hide a VIP product automatically.
 *
 * The set is over *reporters*, so one determined person cannot take a listing
 * down; three different people saying "this leaks a real product" is enough to
 * stop the exposure while a human looks.
 */
export function shouldAutoHideVip(reporterIds: readonly (string | null)[]): boolean {
  const distinct = new Set(reporterIds.filter((id): id is string => id !== null));
  return distinct.size >= VIP_AUTO_HIDE_REPORTS;
}
