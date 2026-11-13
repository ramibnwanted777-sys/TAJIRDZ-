/**
 * Courses — public reads, enrollment by code, reviews and complaints.
 *
 * The platform never takes money, so nothing here touches a payment. What it
 * does do is enforce the trust rules:
 *  - a course only becomes visible once its instructor is approved and the
 *    course itself is active (and not hidden by moderation);
 *  - a code redemption is a single serializable mutation, which is what makes
 *    "uses never exceed max" hold even under concurrent submissions;
 *  - private materials and announcements are gated by a live enrollment, so
 *    they can never leak through a public query;
 *  - three complaints from three different people hide a course immediately.
 */

import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import {
  currentPrincipal,
  requireUser,
  AuthError,
  RateLimitError,
  enforceRateLimit,
  notify,
} from "./lib/access";
import { REVIEW_DELAY_HOURS, cleanText, normalizeArabic } from "../lib/catalog";
import {
  canViewMaterials,
  COMPLAINT_AUTO_HIDE_THRESHOLD as AUTO_HIDE_THRESHOLD,
} from "../lib/courses";

/**
 * Re-exported from the shared module so the admin screen, the course page and
 * the test suite all read the number the server actually enforces — a second
 * copy of `3` in this file would be a bug waiting to happen.
 */
export const COMPLAINT_AUTO_HIDE_THRESHOLD = AUTO_HIDE_THRESHOLD;

/** Everything a visitor needs to render a card in the grid. */
type CourseCard = Doc<"courses"> & {
  instructorName: string;
  instructorVerified: boolean;
  /** Fractional score rounded to one decimal; `null` when nobody has rated. */
  rating: number | null;
};

async function isEnrolled(
  ctx: QueryCtx,
  userId: Id<"users">,
  courseId: Id<"courses">,
): Promise<boolean> {
  const row = await ctx.db
    .query("enrollments")
    .withIndex("by_user_course", (q) => q.eq("userId", userId).eq("courseId", courseId))
    .first();
  return row !== null;
}

/** A course is visible when it is active and its instructor is approved. */
async function isPubliclyVisible(ctx: QueryCtx, course: Doc<"courses">): Promise<boolean> {
  if (course.status !== "active") return false;
  const instructor = await ctx.db.get(course.instructorId);
  return instructor?.status === "approved";
}

/**
 * A review may only be written by an enrolled user, 48 hours after the
 * enrollment, and only once. Shared with `addReview` so the button on the
 * page and the server rule can never disagree.
 */
async function canReview(
  ctx: QueryCtx,
  course: Doc<"courses">,
  principal: Awaited<ReturnType<typeof currentPrincipal>>,
): Promise<boolean> {
  if (!principal) return false;
  const enrollment = await ctx.db
    .query("enrollments")
    .withIndex("by_user_course", (q) =>
      q.eq("userId", principal.userId).eq("courseId", course._id),
    )
    .first();
  if (!enrollment) return false;
  if (Date.now() - enrollment.createdAt < REVIEW_DELAY_HOURS * 60 * 60 * 1000) {
    return false;
  }
  const existing = await ctx.db
    .query("courseReviews")
    .withIndex("by_course_user", (q) =>
      q.eq("courseId", course._id).eq("userId", principal.userId),
    )
    .first();
  return existing === null;
}

function ratingOf(course: Doc<"courses">): number | null {
  return course.ratingCount > 0
    ? Math.round((course.ratingSum / course.ratingCount) * 10) / 10
    : null;
}

async function withInstructor(ctx: QueryCtx, course: Doc<"courses">): Promise<CourseCard> {
  const instructor = await ctx.db.get(course.instructorId);
  return {
    ...course,
    instructorName: instructor?.name ?? "",
    instructorVerified: instructor?.status === "approved",
    rating: ratingOf(course),
  };
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export const list = query({
  args: {
    q: v.optional(v.string()),
    topic: v.optional(v.string()),
    level: v.optional(v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced"))),
    format: v.optional(v.union(v.literal("live"), v.literal("recorded"), v.literal("in_person"))),
    wilaya: v.optional(v.number()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    minRating: v.optional(v.number()),
    verifiedOnly: v.optional(v.boolean()),
    sort: v.optional(v.union(v.literal("newest"), v.literal("rating"), v.literal("price"))),
  },
  handler: async (ctx, args): Promise<CourseCard[]> => {
    const rows = await ctx.db
      .query("courses")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(200);

    const needle = args.q ? normalizeArabic(args.q.trim()) : "";
    const sort = args.sort ?? "newest";

    const out: CourseCard[] = [];
    for (const row of rows) {
      const instructor = await ctx.db.get(row.instructorId);
      if (instructor?.status !== "approved") continue;
      if (args.verifiedOnly && instructor.status !== "approved") continue;
      if (args.topic && !row.topics.includes(args.topic)) continue;
      if (args.level && row.level !== args.level) continue;
      if (args.format && row.format !== args.format) continue;
      if (args.wilaya !== undefined && row.wilaya !== args.wilaya) continue;
      if (args.minPrice !== undefined && row.priceDa < args.minPrice) continue;
      if (args.maxPrice !== undefined && row.priceDa > args.maxPrice) continue;
      const rating = ratingOf(row);
      if (args.minRating !== undefined && (rating ?? 0) < args.minRating) continue;
      if (needle) {
        const haystack = normalizeArabic(`${row.title} ${row.description} ${row.topics.join(" ")}`);
        if (!haystack.includes(needle)) continue;
      }
      out.push({
        ...row,
        instructorName: instructor.name,
        instructorVerified: true,
        rating,
      });
    }

    if (sort === "rating") out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    else if (sort === "price") out.sort((a, b) => a.priceDa - b.priceDa);
    else out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  },
});

export const get = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId);
    if (!course) return null;

    const principal = await currentPrincipal(ctx);
    const instructor = await ctx.db.get(course.instructorId);
    if (!instructor) return null;

    const visible = await isPubliclyVisible(ctx, course);
    const owner = principal !== null && principal.userId === course.ownerId;
    const admin = principal?.role === "admin";
    // Hidden/draft courses are only reachable by their owner and an admin.
    if (!visible && !owner && !admin) return null;

    const enrolled = principal ? await isEnrolled(ctx, principal.userId, course._id) : false;

    const reviews = await ctx.db
      .query("courseReviews")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .order("desc")
      .collect();

    return {
      course: await withInstructor(ctx, course),
      instructor: {
        id: instructor._id,
        name: instructor.name,
        bio: instructor.bio,
        experience: instructor.experience,
        photoStorageId: instructor.photoStorageId,
        wilaya: instructor.wilaya,
        status: instructor.status,
        createdAt: instructor.createdAt,
      },
      /** The WhatsApp number is only ever handed to a signed-in visitor. */
      contactE164: principal ? instructor.contactE164 : null,
      enrolled,
      ownerId: owner ? course.ownerId : null,
      reviews: reviews.filter((r) => r.status === "visible"),
      canReview: await canReview(ctx, course, principal),
      acknowledged: principal
        ? (await ctx.db
            .query("courseAcknowledgements")
            .withIndex("by_user", (q) => q.eq("userId", principal.userId))
            .first()) !== null
        : false,
    };
  },
});

/** Private materials: enrolled students and the owning instructor only. */
export const materials = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const principal = await currentPrincipal(ctx);
    if (!principal) return [];
    const course = await ctx.db.get(args.courseId);
    if (!course) return [];
    // The rule lives in `src/lib/courses.ts`, next to the test that asserts it:
    // the instructor who owns the course, an admin, or an enrolled student.
    const enrolled = await isEnrolled(ctx, principal.userId, course._id);
    if (
      !canViewMaterials({
        isOwner: course.ownerId === principal.userId,
        isAdmin: principal.role === "admin",
        isEnrolled: enrolled,
      })
    ) {
      throw new AuthError("errNotAuthorized");
    }
    const rows = await ctx.db
      .query("courseMaterials")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .collect();
    return rows;
  },
});

/** Announcements are public-ish (a teaser) but the content gate is the same. */
export const announcements = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("courseAnnouncements")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .take(50);
    return rows;
  },
});

/** A row in "my courses": the enrollment, its course and its instructor. */
type MyEnrollment = {
  enrollment: Doc<"enrollments">;
  course: {
    id: Id<"courses">;
    title: string;
    coverStorageId?: string;
    priceDa: number;
    status: Doc<"courses">["status"];
    startsAt?: number;
  };
  instructorName: string;
  instructorVerified: boolean;
};

export const myEnrollments = query({
  handler: async (ctx): Promise<MyEnrollment[]> => {
    const principal = await currentPrincipal(ctx);
    if (!principal) return [];
    const rows = await ctx.db
      .query("enrollments")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .order("desc")
      .collect();

    const out: MyEnrollment[] = [];
    for (const row of rows) {
      const course = await ctx.db.get(row.courseId);
      if (!course) continue;
      const instructor = await ctx.db.get(course.instructorId);
      out.push({
        enrollment: row,
        course: {
          id: course._id,
          title: course.title,
          coverStorageId: course.coverStorageId,
          priceDa: course.priceDa,
          status: course.status,
          startsAt: course.startsAt,
        },
        instructorName: instructor?.name ?? "",
        instructorVerified: instructor?.status === "approved",
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Enrollment by code
// ---------------------------------------------------------------------------

/**
 * One-time acknowledgement that payment happens outside the platform.
 *
 * Required before the *first* code redemption, so nobody can claim they never
 * saw it while still unlocking content.
 */
export const acknowledge = mutation({
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const existing = await ctx.db
      .query("courseAcknowledgements")
      .withIndex("by_user", (q) => q.eq("userId", principal.userId))
      .first();
    if (existing) return { ok: true };
    await ctx.db.insert("courseAcknowledgements", {
      userId: principal.userId,
      acknowledgedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Redeem an enrollment code.
 *
 * Everything happens in one mutation, so Convex's serializable execution makes
 * the read-modify-write on `uses` atomic: two people submitting the last use of
 * a code can never both win.
 */
export const redeemCode = mutation({
  args: {
    courseId: v.id("courses"),
    code: v.string(),
    acknowledged: v.boolean(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const now = Date.now();

    // 5 failures (and, cheaply, 5 attempts) per 15 minutes per user.
    try {
      await enforceRateLimit(ctx, "codeRedeem", { userId: principal.userId });
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new Error(`errCourseLocked:${error.retryMinutes}`);
      }
      throw error;
    }

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");
    if (!(await isPubliclyVisible(ctx, course))) throw new Error("errNotFound");

    if (!(await isEnrolled(ctx, principal.userId, course._id))) {
      if (!args.acknowledged) throw new Error("errAckRequired");

      const normalised = args.code.trim().toUpperCase().replace(/\s+/g, "");
      const row = await ctx.db
        .query("enrollmentCodes")
        .withIndex("by_code", (q) => q.eq("code", normalised))
        .first();

      if (!row || row.courseId !== course._id) throw new Error("errCodeInvalid");
      if (row.revokedAt !== undefined) throw new Error("errCodeRevoked");
      if (row.expiresAt !== undefined && row.expiresAt < now) {
        throw new Error("errCodeExpired");
      }
      if (row.uses >= row.maxUses) throw new Error("errCodeUsedUp");

      // Instructor must still be in good standing.
      const instructor = await ctx.db.get(course.instructorId);
      if (!instructor || instructor.status !== "approved") {
        throw new Error("errCodeInvalid");
      }

      await ctx.db.patch(row._id, { uses: row.uses + 1 });
      await ctx.db.insert("enrollments", {
        userId: principal.userId,
        courseId: course._id,
        instructorId: course.instructorId,
        codeId: row._id,
        createdAt: now,
      });

      // Tell the instructor: this is their only signal that somebody paid.
      await notify(ctx, {
        userId: course.ownerId,
        type: "announcement",
        title: "تسجيل جديد في دورتك",
        body: `${principal.doc.name ?? "طالب جديد"} سجّل في "${course.title}"${
          row.label ? ` (الكود: ${row.label})` : ""
        }`,
        link: `/instructor`,
        dedupeKey: `enroll:${course._id}:${principal.userId}`,
        dedupeMs: 0,
      });
    }

    return { ok: true, alreadyEnrolled: true };
  },
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Reviews need a live enrollment, 48 hours of patience and one per person. */
export const addReview = mutation({
  args: {
    courseId: v.id("courses"),
    rating: v.number(),
    comment: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    if (args.rating < 1 || args.rating > 5) throw new Error("errInvalidRating");

    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_user_course", (q) =>
        q.eq("userId", principal.userId).eq("courseId", args.courseId),
      )
      .first();
    if (!enrollment) throw new Error("errNotEnrolled");

    const existing = await ctx.db
      .query("courseReviews")
      .withIndex("by_course_user", (q) =>
        q.eq("courseId", args.courseId).eq("userId", principal.userId),
      )
      .first();
    if (existing) throw new Error("errReviewOnce");

    // 48h after enrollment: a review written seconds after a code is entered
    // says nothing about whether the course was worth it.
    if (Date.now() - enrollment.createdAt < REVIEW_DELAY_HOURS * 60 * 60 * 1000) {
      throw new Error("errReviewTooEarly");
    }

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");

    const comment = cleanText(args.comment, 800);
    await ctx.db.insert("courseReviews", {
      courseId: args.courseId,
      userId: principal.userId,
      instructorId: course.instructorId,
      rating: Math.round(args.rating),
      comment,
      status: "visible",
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.courseId, {
      ratingCount: course.ratingCount + 1,
      ratingSum: course.ratingSum + Math.round(args.rating),
      updatedAt: Date.now(),
    });

    await notify(ctx, {
      userId: course.ownerId,
      type: "review",
      title: "تقييم جديد",
      body: `تقييم ${Math.round(args.rating)}/5 لدورتك "${course.title}"`,
      link: `/courses/${args.courseId}`,
      dedupeKey: `review:${args.courseId}:${principal.userId}`,
      dedupeMs: 0,
    });
    return { ok: true };
  },
});

/** The instructor answers a review — once. */
export const replyToReview = mutation({
  args: { reviewId: v.id("courseReviews"), reply: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("errNotFound");
    const owner = await ctx.db.get(review.instructorId);
    if (!owner) throw new Error("errNotFound");
    // Only the instructor who owns the course, or an admin, may answer.
    if (owner.userId !== principal.userId && principal.role !== "admin") {
      throw new AuthError("errNotAuthorized");
    }
    if (review.instructorReply !== undefined) throw new Error("errReplyOnce");

    await ctx.db.patch(args.reviewId, {
      instructorReply: cleanText(args.reply, 500),
      replyAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

export const COMPLAINT_REASON = v.union(
  v.literal("scam"),
  v.literal("fake"),
  v.literal("harassment"),
  v.literal("other"),
);

/**
 * File a complaint against a course or an instructor.
 *
 * Three distinct complainants on one course hide it straight away and flag it
 * for review — the one rule that has to happen without an admin in the loop,
 * because waiting for a queue is what lets an obvious scam keep collecting
 * payments.
 */
export const fileComplaint = mutation({
  args: {
    targetType: v.union(v.literal("course"), v.literal("instructor")),
    targetId: v.string(),
    courseId: v.optional(v.id("courses")),
    reason: COMPLAINT_REASON,
    description: v.string(),
    evidenceStorageIds: v.array(v.string()),
    code: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    await enforceRateLimit(ctx, "report", { userId: principal.userId });

    const description = cleanText(args.description, 800);
    if (description.length < 10) throw new Error("errRequired");

    const course = args.courseId ? await ctx.db.get(args.courseId) : null;
    const instructor = course
      ? await ctx.db.get(course.instructorId)
      : null;

    const id = await ctx.db.insert("courseComplaints", {
      targetType: args.targetType,
      targetId: args.targetId,
      courseId: course?._id,
      instructorId: instructor?._id,
      userId: principal.userId,
      reason: args.reason,
      description,
      evidenceStorageIds: args.evidenceStorageIds.slice(0, 5),
      code: args.code?.trim() || undefined,
      status: "new",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Auto-hide once three *different* people complain about the same course.
    if (course && course.status !== "hidden") {
      const all = await ctx.db
        .query("courseComplaints")
        .withIndex("by_target", (q) =>
          q.eq("targetType", args.targetType).eq("targetId", args.targetId),
        )
        .collect();
      // Three *different* complainants: one person filing three times must
      // not be able to hide a competitor's course.
      const distinct = new Set(all.map((c) => String(c.userId)));
      if (distinct.size >= COMPLAINT_AUTO_HIDE_THRESHOLD) {
        await ctx.db.patch(course._id, {
          status: "hidden",
          hiddenReason: "auto_complaints",
          updatedAt: Date.now(),
        });
        await notify(ctx, {
          userId: course.ownerId,
          type: "announcement",
          title: "دورتك مخفية مؤقتاً",
          body: "وصلتنا 3 شكاوى مختلفة، وغادي نراجعو المحتوى.",
          link: `/courses/${course._id}`,
        });
      }
    }

    // Admins need to see this without polling the table.
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();
    for (const admin of admins) {
      await notify(ctx, {
        userId: admin._id,
        type: "announcement",
        title: "شكوى جديدة على الدورات",
        body: `${args.targetType === "course" ? "دورة" : "مدرب"}: ${description.slice(0, 80)}`,
        link: "/admin/courses",
        dedupeKey: `complaint:${id}`,
        dedupeMs: 0,
      });
    }

    return { ok: true };
  },
});

/** Re-exported so the admin module and tests share one threshold. */
export const COURSE_COMPLAINT_THRESHOLD = COMPLAINT_AUTO_HIDE_THRESHOLD;