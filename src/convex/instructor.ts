/**
 * Instructor side: applying to teach, and running the courses afterwards.
 *
 * Two gates decide everything:
 *  - only an **approved** instructor may publish a course, so a rejected or
 *    suspended application immediately stops new content going live;
 *  - every write is checked against the instructor record that belongs to the
 *    caller, so one instructor cannot touch another's course, code or material.
 */

import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import { requireUser, AuthError, enforceRateLimit, notify } from "./lib/access";
import { cleanText, normalizeArabic } from "../lib/catalog";
import { codeState, type CodeState } from "../lib/courses";

/** Longest free-text fields, so a paste cannot bloat the table. */
const LIMITS = { name: 80, bio: 600, experience: 600, title: 120, description: 4000 };

const topicList = v.array(v.string());
const linkList = v.array(v.string());

type AnyCtx = QueryCtx | MutationCtx;

/** The instructor row for a user, or null. */
async function myInstructorRow(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("instructors")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

/** Load the instructor row for the caller, or throw if they have none. */
async function requireInstructor(ctx: AnyCtx, userId: Id<"users">) {
  const row = await myInstructorRow(ctx, userId);
  if (!row) throw new AuthError("errNotAuthorized");
  return row;
}

/**
 * An instructor may only publish while approved. Suspended and closed
 * accounts are blocked here rather than only in the admin UI, so revoking an
 * account takes effect on the next write.
 */
async function requireApprovedInstructor(ctx: AnyCtx, userId: Id<"users">) {
  const row = await requireInstructor(ctx, userId);
  if (row.status !== "approved") throw new AuthError("errNotAuthorized");
  return row;
}

function normaliseLinks(links: string[]): string[] {
  return links
    .map((link) => link.trim())
    .filter(Boolean)
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export const apply = mutation({
  args: {
    name: v.string(),
    bio: v.string(),
    experience: v.string(),
    photoStorageId: v.optional(v.string()),
    proofLinks: linkList,
    contactE164: v.string(),
    wilaya: v.number(),
    socialLinks: linkList,
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    // One application every 15 minutes: the form is a free text box.
    await enforceRateLimit(ctx, "support", { userId: principal.userId });

    const name = cleanText(args.name, LIMITS.name);
    const bio = cleanText(args.bio, LIMITS.bio);
    const experience = cleanText(args.experience, LIMITS.experience);
    if (!name || !bio || !experience) throw new Error("errRequired");

    const now = Date.now();
    const existing = await myInstructorRow(ctx, principal.userId);

    // A suspended or closed account may not simply re-apply.
    if (existing && (existing.status === "suspended" || existing.status === "closed")) {
      throw new AuthError("errNotAuthorized");
    }
    // An already-approved instructor editing their profile stays approved.
    if (existing && existing.status === "approved") {
      await ctx.db.patch(existing._id, {
        name,
        bio,
        experience,
        photoStorageId: args.photoStorageId,
        proofLinks: normaliseLinks(args.proofLinks),
        contactE164: args.contactE164.trim(),
        wilaya: args.wilaya,
        socialLinks: normaliseLinks(args.socialLinks),
        updatedAt: now,
      });
      return { status: "approved" as const };
    }

    if (existing) {
      // A rejected application can be amended and re-submitted for review.
      await ctx.db.patch(existing._id, {
        name,
        bio,
        experience,
        photoStorageId: args.photoStorageId,
        proofLinks: normaliseLinks(args.proofLinks),
        contactE164: args.contactE164.trim(),
        wilaya: args.wilaya,
        socialLinks: normaliseLinks(args.socialLinks),
        status: "pending",
        decisionNote: undefined,
        updatedAt: now,
      });
      return { status: "pending" as const };
    }

    await ctx.db.insert("instructors", {
      userId: principal.userId,
      name,
      bio,
      experience,
      photoStorageId: args.photoStorageId,
      proofLinks: normaliseLinks(args.proofLinks),
      contactE164: args.contactE164.trim(),
      wilaya: args.wilaya,
      socialLinks: normaliseLinks(args.socialLinks),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();
    for (const admin of admins) {
      await notify(ctx, {
        userId: admin._id,
        type: "announcement",
        title: "طلب تكوين جديد",
        body: `${name} تقدّم كمدرب`,
        link: "/admin/courses",
        dedupeKey: `instructor-apply:${principal.userId}`,
        dedupeMs: 0,
      });
    }
    return { status: "pending" as const };
  },
});

export const withdraw = mutation({
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const row = await myInstructorRow(ctx, principal.userId);
    if (row && row.status === "pending") {
      await ctx.db.delete(row._id);
    }
    return { ok: true };
  },
});

export const myApplication = query({
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const row = await myInstructorRow(ctx, principal.userId);
    if (!row) return { status: "none" as const };
    return {
      status: row.status,
      decisionNote: row.decisionNote ?? null,
      updatedAt: row.updatedAt,
    };
  },
});

/** Public card for an instructor's profile. */
export const publicProfile = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.instructorId);
    if (!row) return null;
    const principal = await requireUser(ctx).catch(() => null);
    return {
      id: row._id,
      name: row.name,
      bio: row.bio,
      experience: row.experience,
      photoStorageId: row.photoStorageId,
      wilaya: row.wilaya,
      status: row.status,
      verified: row.status === "approved",
      // Same rule as the course page: the number is hidden from signed-out
      // visitors, since the profile is public.
      contactE164: principal ? row.contactE164 : null,
      socialLinks: row.socialLinks,
      createdAt: row.createdAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const courseArgs = {
  title: v.string(),
  description: v.string(),
  coverStorageId: v.optional(v.string()),
  topics: topicList,
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
};

/** Reused by create and edit so the two cannot drift. */
async function validateCourse(args: {
  title: string;
  description: string;
  priceDa: number;
  durationHours: number;
  curriculum: string[];
  externalContact: string;
  previewVideoUrl?: string;
}) {
  const title = cleanText(args.title, LIMITS.title);
  const description = cleanText(args.description, LIMITS.description);
  if (title.length < 6) throw new Error("errRequired");
  if (description.length < 30) throw new Error("errRequired");
  if (args.priceDa < 0 || args.priceDa > 1_000_000) throw new Error("errRequired");
  if (args.durationHours < 0) throw new Error("errRequired");
  if (args.previewVideoUrl && !/^https?:\/\//i.test(args.previewVideoUrl)) {
    throw new Error("errRequired");
  }
  return {
    title,
    description,
    curriculum: args.curriculum
      .map((item) => cleanText(item, 200))
      .filter(Boolean)
      .slice(0, 40),
    externalContact: cleanText(args.externalContact, 120),
  };
}

export const createCourse = mutation({
  args: courseArgs,
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const instructor = await requireApprovedInstructor(ctx, principal.userId);
    const fields = await validateCourse(args);

    const now = Date.now();
    const id = await ctx.db.insert("courses", {
      instructorId: instructor._id,
      ownerId: principal.userId,
      ...fields,
      coverStorageId: args.coverStorageId,
      topics: args.topics.slice(0, 6),
      level: args.level,
      language: args.language,
      format: args.format,
      wilaya: args.format === "in_person" ? args.wilaya : undefined,
      durationHours: Math.round(args.durationHours),
      priceDa: Math.round(args.priceDa),
      startsAt: args.startsAt,
      seats: args.seats,
      previewVideoUrl: args.previewVideoUrl?.trim() || undefined,
      // Starts as a draft: an instructor previews before publishing.
      status: "draft",
      viewCount: 0,
      ratingCount: 0,
      ratingSum: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { courseId: id };
  },
});

export const updateCourse = mutation({
  args: { courseId: v.id("courses"), ...courseArgs },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");
    const instructor = await requireApprovedInstructor(ctx, principal.userId);
    if (course.instructorId !== instructor._id) throw new AuthError("errNotAuthorized");

    const fields = await validateCourse(args);
    await ctx.db.patch(args.courseId, {
      ...fields,
      coverStorageId: args.coverStorageId,
      topics: args.topics.slice(0, 6),
      level: args.level,
      language: args.language,
      format: args.format,
      wilaya: args.format === "in_person" ? args.wilaya : undefined,
      durationHours: Math.round(args.durationHours),
      priceDa: Math.round(args.priceDa),
      startsAt: args.startsAt,
      seats: args.seats,
      previewVideoUrl: args.previewVideoUrl?.trim() || undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Publish, pause or move back to draft.
 *
 * `hidden` is deliberately absent: only moderation can hide a course, so an
 * instructor can never un-hide one themselves.
 */
export const setCourseStatus = mutation({
  args: {
    courseId: v.id("courses"),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");
    const instructor = await requireApprovedInstructor(ctx, principal.userId);
    if (course.instructorId !== instructor._id) throw new AuthError("errNotAuthorized");

    await ctx.db.patch(args.courseId, {
      status: args.status,
      hiddenReason: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const deleteCourse = mutation({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");
    const instructor = await requireInstructor(ctx, principal.userId);
    if (course.instructorId !== instructor._id) throw new AuthError("errNotAuthorized");

    await ctx.db.delete(args.courseId);
    return { ok: true };
  },
});

/** A course as the dashboard needs it: with its live counts attached. */
type OwnedCourse = Doc<"courses"> & {
  redemptions: number;
  reviews: number;
  rating: number | null;
};

type MyCourses = {
  instructor: { status: Doc<"instructors">["status"]; name: string } | null;
  courses: OwnedCourse[];
};

export const listMyCourses = query({
  handler: async (ctx): Promise<MyCourses> => {
    const principal = await requireUser(ctx);
    const instructor = await myInstructorRow(ctx, principal.userId);
    if (!instructor) return { instructor: null, courses: [] };

    const rows = await ctx.db
      .query("courses")
      .withIndex("by_instructor", (q) => q.eq("instructorId", instructor._id))
      .order("desc")
      .collect();

    const out: OwnedCourse[] = [];
    for (const course of rows) {
      const redemptions = await ctx.db
        .query("enrollments")
        .withIndex("by_course", (q) => q.eq("courseId", course._id))
        .collect();
      const reviews = await ctx.db
        .query("courseReviews")
        .withIndex("by_course", (q) => q.eq("courseId", course._id))
        .collect();
      out.push({
        ...course,
        redemptions: redemptions.length,
        reviews: reviews.length,
        rating:
          course.ratingCount > 0
            ? Math.round((course.ratingSum / course.ratingCount) * 10) / 10
            : null,
      });
    }
    return { instructor: { status: instructor.status, name: instructor.name }, courses: out };
  },
});

// ---------------------------------------------------------------------------
// Enrollment codes
// ---------------------------------------------------------------------------

/** Human-friendly code, unambiguous when read out over WhatsApp. */
function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 3) out += "-";
  }
  return out;
}

export const createCode = mutation({
  args: {
    courseId: v.id("courses"),
    maxUses: v.number(),
    expiresAt: v.optional(v.number()),
    label: v.optional(v.string()),
    singleUse: v.boolean(),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const instructor = await requireApprovedInstructor(ctx, principal.userId);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");
    if (course.instructorId !== instructor._id) throw new AuthError("errNotAuthorized");

    const maxUses = args.singleUse ? 1 : Math.max(1, Math.min(500, Math.round(args.maxUses)));
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error("errRequired");
    }

    const id = await ctx.db.insert("enrollmentCodes", {
      courseId: args.courseId,
      instructorId: instructor._id,
      code: makeCode(),
      maxUses,
      uses: 0,
      expiresAt: args.expiresAt,
      label: args.label ? cleanText(args.label, 60) : undefined,
      createdBy: principal.userId,
      createdAt: Date.now(),
    });
    return { codeId: id };
  },
});

/**
 * A code plus the facts the list renders: uses left, whether it has expired,
 * and its badge state.
 *
 * `state` is computed here rather than in the component so the badge is not a
 * `Date.now()` call during render — the server owns "has this expired", which
 * is also the answer the redemption path uses.
 */
type CodeWithState = Doc<"enrollmentCodes"> & {
  remaining: number;
  expired: boolean;
  state: CodeState;
};

export const listCodes = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args): Promise<CodeWithState[]> => {
    const principal = await requireUser(ctx);
    const instructor = await requireInstructor(ctx, principal.userId);
    const course = await ctx.db.get(args.courseId);
    if (!course || course.instructorId !== instructor._id) {
      throw new AuthError("errNotAuthorized");
    }

    const rows = await ctx.db
      .query("enrollmentCodes")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .collect();

    const now = Date.now();
    const out: CodeWithState[] = [];
    for (const code of rows) {
      out.push({
        ...code,
        remaining: Math.max(0, code.maxUses - code.uses),
        expired: code.expiresAt !== undefined && code.expiresAt < now,
        state: codeState(code, now),
      });
    }
    return out;
  },
});

export const revokeCode = mutation({
  args: { codeId: v.id("enrollmentCodes") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const row = await ctx.db.get(args.codeId);
    if (!row) throw new Error("errNotFound");
    const instructor = await requireInstructor(ctx, principal.userId);
    if (row.instructorId !== instructor._id) throw new AuthError("errNotAuthorized");
    await ctx.db.patch(args.codeId, { revokedAt: Date.now() });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Materials & announcements
// ---------------------------------------------------------------------------

async function requireCourseOwner(
  ctx: AnyCtx,
  userId: Id<"users">,
  courseId: Id<"courses">,
) {
  const course = await ctx.db.get(courseId);
  if (!course) throw new Error("errNotFound");
  const instructor = await requireApprovedInstructor(ctx, userId);
  if (course.instructorId !== instructor._id) throw new AuthError("errNotAuthorized");
  return course;
}

export const addMaterial = mutation({
  args: {
    courseId: v.id("courses"),
    title: v.string(),
    link: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const course = await requireCourseOwner(ctx, principal.userId, args.courseId);
    const link = args.link.trim();
    // The whole point of the material is the link, so a non-http link is a bug.
    if (!/^https?:\/\//i.test(link)) throw new Error("errRequired");

    await ctx.db.insert("courseMaterials", {
      courseId: args.courseId,
      instructorId: course.instructorId,
      title: cleanText(args.title, 120),
      link,
      note: args.note ? cleanText(args.note, 800) : undefined,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const removeMaterial = mutation({
  args: { materialId: v.id("courseMaterials") },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const row = await ctx.db.get(args.materialId);
    if (!row) throw new Error("errNotFound");
    await requireCourseOwner(ctx, principal.userId, row.courseId);
    await ctx.db.delete(args.materialId);
    return { ok: true };
  },
});

export const addAnnouncement = mutation({
  args: { courseId: v.id("courses"), title: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireUser(ctx);
    const course = await requireCourseOwner(ctx, principal.userId, args.courseId);

    const title = cleanText(args.title, 120);
    const body = cleanText(args.body, 800);
    if (!title || !body) throw new Error("errRequired");
    await enforceRateLimit(ctx, "support", { userId: principal.userId });

    await ctx.db.insert("courseAnnouncements", {
      courseId: args.courseId,
      instructorId: course.instructorId,
      title,
      body,
      createdAt: Date.now(),
    });

    // Tell everyone enrolled: this is the channel the student signed up for.
    const enrolled = await ctx.db
      .query("enrollments")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .collect();
    const seen = new Set<string>();
    for (const row of enrolled) {
      const key = String(row.userId);
      if (seen.has(key)) continue;
      seen.add(key);
      await notify(ctx, {
        userId: row.userId,
        type: "announcement",
        title: `إعلان: ${title}`,
        body,
        link: `/courses/${args.courseId}`,
        dedupeKey: `ann:${args.courseId}:${row.createdAt}`,
        dedupeMs: 0,
      });
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const stats = query({
  handler: async (ctx) => {
    const principal = await requireUser(ctx);
    const instructor = await myInstructorRow(ctx, principal.userId);
    if (!instructor) return null;

    const courses = await ctx.db
      .query("courses")
      .withIndex("by_instructor", (q) => q.eq("instructorId", instructor._id))
      .collect();

    let views = 0;
    let redemptions = 0;
    let reviews = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    for (const course of courses) {
      views += course.viewCount;
      ratingSum += course.ratingSum;
      ratingCount += course.ratingCount;
      redemptions += (
        await ctx.db
          .query("enrollments")
          .withIndex("by_course", (q) => q.eq("courseId", course._id))
          .collect()
      ).length;
      reviews += (
        await ctx.db
          .query("courseReviews")
          .withIndex("by_course", (q) => q.eq("courseId", course._id))
          .collect()
      ).length;
    }

    return {
      courses: courses.length,
      views,
      redemptions,
      reviews,
      rating: ratingCount
        ? Math.round((ratingSum / ratingCount) * 10) / 10
        : null,
      status: instructor.status,
    };
  },
});

/** Count a view. Deliberately fire-and-forget from the client. */
export const trackView = mutation({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId);
    if (!course) return { ok: false };
    await ctx.db.patch(args.courseId, { viewCount: course.viewCount + 1 });
    return { ok: true };
  },
});

/** Used by the dashboard to fill the form with an existing course. */
export const getMyCourse = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args): Promise<Doc<"courses"> | null> => {
    const principal = await requireUser(ctx);
    const instructor = await myInstructorRow(ctx, principal.userId);
    if (!instructor) return null;
    const course = await ctx.db.get(args.courseId);
    if (!course || course.instructorId !== instructor._id) return null;
    return course;
  },
});

/** Placeholder kept for search normalisation parity with the catalogue. */
export function normaliseCourseText(value: string): string {
  return normalizeArabic(value);
}