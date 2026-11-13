/**
 * Courses: the taxonomy and the rules, in one file.
 *
 * The point of keeping this here rather than inside `src/convex/courses.ts` is
 * that the server mutation, the course page and the test suite all have to
 * agree. A rule that lives in only one of them is a rule that will drift:
 * whichever way it drifts, either a student sees an "activate code" button the
 * server refuses, or a code gets redeemed one time too many.
 *
 * Nothing in this file touches React or Convex, so it is safe to import from
 * both sides and from Vitest.
 */

import { REVIEW_DELAY_HOURS, formatDinar } from "./catalog";

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/** Topics an instructor can tag a course with. Values are i18n keys. */
export const COURSE_TOPICS = [
  "topicDropshipping",
  "topicAds",
  "topicFacebook",
  "topicTiktok",
  "topicStore",
  "topicSourcing",
  "topicLogistics",
  "topicOther",
] as const;
export type CourseTopic = (typeof COURSE_TOPICS)[number];

export const COURSE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const COURSE_FORMATS = ["live", "recorded", "in_person"] as const;
export type CourseFormat = (typeof COURSE_FORMATS)[number];

export const COURSE_LANGUAGES = ["ar", "fr", "both"] as const;
export type CourseLanguage = (typeof COURSE_LANGUAGES)[number];

export const COURSE_SORTS = ["newest", "rating", "price"] as const;
export type CourseSort = (typeof COURSE_SORTS)[number];

/** The label key for a level, format, language or sort value. */
export function levelLabelKey(level: CourseLevel): string {
  return `level${level.charAt(0).toUpperCase()}${level.slice(1)}` as const;
}

export function formatLabelKey(format: CourseFormat): string {
  return `format${format === "in_person" ? "InPerson" : format === "live" ? "Live" : "Recorded"}`;
}

export function languageLabelKey(language: CourseLanguage): string {
  if (language === "ar") return "langArabic";
  if (language === "fr") return "langFrench";
  return "langBoth";
}

export function sortLabelKey(sort: CourseSort): string {
  if (sort === "rating") return "sortTopRated";
  if (sort === "price") return "sortPrice";
  return "sortNewest";
}

/** The i18n key for a course's own status (draft / active / paused / hidden). */
export function courseStatusLabelKey(status: "draft" | "active" | "paused" | "hidden"): string {
  if (status === "active") return "courseStatusActive";
  if (status === "paused") return "courseStatusPaused";
  if (status === "hidden") return "courseStatusHidden";
  return "courseStatusDraft";
}

/** "3 500 دج" — the digits are wrapped in `<bdi>` by the caller. */
export function coursePriceText(priceDa: number, lang: "ar" | "fr"): string {
  return formatDinar(priceDa, lang);
}

/** "3 سا" / "3 h" — a duration is always an integer number of hours. */
export function courseDurationText(hours: number, lang: "ar" | "fr"): string {
  const unit = lang === "ar" ? "سا" : "h";
  return `${hours} ${unit}`;
}

/**
 * The message a student sends the instructor before paying.
 *
 * Prefilled so the first thing the instructor reads already names the course,
 * which is what stops the "which course?" back-and-forth that loses sales.
 */
export function courseWhatsappMessage(title: string, lang: "ar" | "fr"): string {
  return lang === "ar"
    ? `السلام عليكم، شفت دورة "${title}" في TajirDz وحاب نسجّل. واش ما زال كاين بلاصة وشحال الثمن والدفع؟`
    : `Bonjour, j'ai vu la formation « ${title} » sur TajirDz et je souhaite m'inscrire. Reste-t-il des places, et quelles sont les modalités de paiement ?`;
}

// ---------------------------------------------------------------------------
// Enrollment codes
// ---------------------------------------------------------------------------

/** The subset of an `enrollmentCodes` row the rules need. */
export type CodeLike = {
  courseId: string;
  code: string;
  maxUses: number;
  uses: number;
  revokedAt?: number;
  expiresAt?: number;
};

/**
 * Codes are read out loud over the phone, so they are normalised before they
 * are stored and before they are compared: upper-case, no spaces.
 *
 * The dash is *kept*, because it is part of the stored code ("ABCD-EFGH") and
 * the lookup index is on the stored value. `codeCandidates` below is what makes
 * typing it without the dash still work.
 */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Every spelling of one code that should match the stored row: as typed, and
 * with the dash put back where `makeCode` puts it.
 */
export function codeCandidates(input: string): string[] {
  const typed = normaliseCode(input);
  const out = [typed];
  const bare = typed.replace(/-/g, "");
  if (bare.length === 8) out.push(`${bare.slice(0, 4)}-${bare.slice(4)}`);
  return out;
}

/**
 * Why a code cannot be used, or `null` when it can.
 *
 * The return value is an i18n/error key rather than a sentence: the server
 * throws it and the form maps it to a translated message, so the same verdict
 * produces the same wording in both places.
 *
 * Order matters. "Wrong course" is indistinguishable from "no such code" on
 * purpose — telling a stranger that a code exists but belongs to a different
 * course would leak the codes of other instructors.
 */
export function codeRejectionReason(
  row: CodeLike | null | undefined,
  opts: { courseId: string; now: number },
): "errCodeInvalid" | "errCodeRevoked" | "errCodeExpired" | "errCodeUsedUp" | null {
  if (!row) return "errCodeInvalid";
  // No such code and "a code for another course" are the same answer: telling
  // a stranger that a code exists would leak other instructors' codes.
  if (String(row.courseId) !== String(opts.courseId)) return "errCodeInvalid";
  if (row.revokedAt !== undefined) return "errCodeRevoked";
  if (row.expiresAt !== undefined && row.expiresAt <= opts.now) return "errCodeExpired";
  if (row.uses >= row.maxUses) return "errCodeUsedUp";
  return null;
}

/**
 * The lockout the redemption mutation throws after too many wrong codes.
 *
 * The wait is encoded in the message because that is the only part of a
 * `RateLimitError` that survives a Convex round trip — the error *class* does
 * not cross the wire, so `retryMinutes` has to travel as text.
 */
export const CODE_LOCK_PREFIX = "errCourseLocked:";

/** Minutes to wait from an "errCourseLocked:12" message, or `null`. */
export function parseCourseLock(message: string): number | null {
  if (!message.startsWith(CODE_LOCK_PREFIX)) return null;
  const minutes = Number(message.slice(CODE_LOCK_PREFIX.length));
  return Number.isFinite(minutes) ? minutes : null;
}

/** Badge state for a code in the instructor's list. */
export type CodeState = "revoked" | "expired" | "usedUp" | "available";

/** The fields a status badge needs — a list row may not carry `courseId`. */
type CodeMeta = Pick<CodeLike, "maxUses" | "uses" | "revokedAt" | "expiresAt">;

export function codeState(row: CodeMeta, now: number): CodeState {
  if (row.revokedAt !== undefined) return "revoked";
  if (row.expiresAt !== undefined && row.expiresAt <= now) return "expired";
  if (row.uses >= row.maxUses) return "usedUp";
  return "available";
}

export function codeStateLabelKey(state: CodeState): string {
  if (state === "revoked") return "codeRevoked";
  if (state === "expired") return "codeExpired";
  if (state === "usedUp") return "codeUsedUp";
  return "codeAvailable";
}

/** Uses still available on a code — never negative, even on a corrupt row. */
export function codeRemaining(row: CodeMeta): number {
  return Math.max(0, row.maxUses - row.uses);
}

/**
 * The result of a redemption attempt, as an outcome the tests can assert on.
 *
 * `alreadyEnrolled` is not an error: re-entering a code you already used is the
 * common case for a student who lost the link, and it must be idempotent.
 */
export type RedemptionOutcome =
  | { ok: true; alreadyEnrolled: boolean }
  | { ok: false; reason: NonNullable<ReturnType<typeof codeRejectionReason>> };

/**
 * Decide the outcome of a redemption, given the state *before* it happens.
 *
 * `usesAfter` is returned so a caller can assert the invariant that matters —
 * concurrent redemptions never push `uses` past `maxUses`.
 */
export function redemptionOutcome(opts: {
  alreadyEnrolled: boolean;
  row: CodeLike | null | undefined;
  courseId: string;
  now: number;
}): { outcome: RedemptionOutcome; usesAfter: number } {
  if (opts.alreadyEnrolled) {
    // Nothing is incremented: an existing enrollment is already proof of use.
    return { outcome: { ok: true, alreadyEnrolled: true }, usesAfter: opts.row?.uses ?? 0 };
  }
  const reason = codeRejectionReason(opts.row, opts);
  if (reason) return { outcome: { ok: false, reason }, usesAfter: opts.row?.uses ?? 0 };
  return {
    outcome: { ok: true, alreadyEnrolled: false },
    usesAfter: (opts.row?.uses ?? 0) + 1,
  };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewVerdict = "ok" | "notEnrolled" | "tooEarly" | "alreadyReviewed";

/** The error key each verdict maps to on the server. */
export const REVIEW_VERDICT_ERROR: Record<Exclude<ReviewVerdict, "ok">, string> = {
  notEnrolled: "errNotEnrolled",
  tooEarly: "errReviewTooEarly",
  alreadyReviewed: "errReviewOnce",
};

/**
 * Who may review: an enrolled student, 48 hours after enrolling, once.
 *
 * The delay is deliberate. A review written seconds after a code is entered
 * describes the checkout, not the course.
 */
export function reviewVerdict(opts: {
  enrolled: boolean;
  enrolledAt?: number;
  hasReviewed: boolean;
  now: number;
  delayHours?: number;
}): ReviewVerdict {
  if (!opts.enrolled) return "notEnrolled";
  const delayHours = opts.delayHours ?? REVIEW_DELAY_HOURS;
  const waited = opts.enrolledAt !== undefined && opts.now - opts.enrolledAt >= delayHours * 3_600_000;
  if (!waited) return "tooEarly";
  if (opts.hasReviewed) return "alreadyReviewed";
  return "ok";
}

/** Hours still to wait before the review form unlocks. */
export function reviewWaitHours(
  enrolledAt: number,
  now: number,
  delayHours = REVIEW_DELAY_HOURS,
): number {
  const remainingMs = enrolledAt + delayHours * 3_600_000 - now;
  return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 3_600_000);
}

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

/**
 * Distinct complainants that hide a course without waiting for an admin.
 *
 * Waiting for a human is exactly what lets an obvious scam keep collecting
 * payments, so the third *different* person who complains takes the course
 * down. One person filing three times changes nothing.
 */
export const COMPLAINT_AUTO_HIDE_THRESHOLD = 3;

export function distinctComplainants(userIds: readonly string[]): number {
  return new Set(userIds.map(String)).size;
}

export function shouldAutoHide(userIds: readonly string[]): boolean {
  return distinctComplainants(userIds) >= COMPLAINT_AUTO_HIDE_THRESHOLD;
}

export const COMPLAINT_REASONS = ["scam", "fake", "harassment", "other"] as const;
export type ComplaintReason = (typeof COMPLAINT_REASONS)[number];

export function reasonLabelKey(reason: ComplaintReason): string {
  if (reason === "scam") return "reasonScam";
  if (reason === "fake") return "reasonFake";
  if (reason === "harassment") return "reasonHarassment";
  return "reasonOther";
}

export const COMPLAINT_STATUSES = ["new", "investigating", "resolved", "rejected"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export function statusLabelKey(status: ComplaintStatus): string {
  if (status === "investigating") return "statusInvestigating";
  if (status === "resolved") return "statusResolved";
  if (status === "rejected") return "statusRejected";
  return "statusNew";
}

// ---------------------------------------------------------------------------
// Instructor standing
// ---------------------------------------------------------------------------

/**
 * Who may see a course's private materials — links and notes the instructor
 * adds for people who actually paid.
 *
 * One function, three callers: the `courses.materials` query, the course page
 * (which decides what to show) and the tests. A rule that exists only on the
 * server is a rule the UI will eventually contradict.
 */
export function canViewMaterials(opts: {
  /** The course belongs to the signed-in instructor. */
  isOwner: boolean;
  /** An admin, for support and moderation. */
  isAdmin: boolean;
  /** A live enrollment exists for this user on this course. */
  isEnrolled: boolean;
}): boolean {
  return opts.isOwner || opts.isAdmin || opts.isEnrolled;
}

/** The standing of an instructor, as decided by an admin. */
export type InstructorStatus = "pending" | "approved" | "rejected" | "suspended" | "closed";

/** Only an approved instructor may publish, and only then is a course public. */
export function canPublish(status: InstructorStatus): boolean {
  return status === "approved";
}

/** A suspended or closed instructor cannot re-apply: the block is enforced. */
export function canApply(status: InstructorStatus | "none"): boolean {
  return status === "none" || status === "pending" || status === "rejected";
}

export function instructorStatusLabelKey(status: InstructorStatus): string {
  if (status === "approved") return "instructorApproved";
  if (status === "rejected") return "instructorRejected";
  if (status === "suspended") return "statusSuspended";
  if (status === "closed") return "statusClosed";
  return "instructorPending";
}
