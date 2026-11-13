/**
 * Admin moderation for the courses area.
 *
 * Every decision here writes an audit row, so "who hid this course and why"
 * is always answerable. The two actions that matter most are:
 *  - `decideInstructor`, where `closed` cascades — all of that instructor's
 *    courses go hidden and every enrollment code is revoked in the same
 *    mutation, so there is never a window where a closed account can still
 *    redeem a code;
 *  - `resolveComplaint`, which can hide the course, revoke codes and notify the
 *    complainant in one place instead of three separate screens.
 */

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

import { requireAdmin, notify, audit } from "./lib/access";
import { cleanText } from "../lib/catalog";

/** Hide every course owned by an instructor and disable their codes. */
async function revokeInstructor(
  ctx: Parameters<typeof notify>[0],
  instructorId: string,
  reason: string,
): Promise<{ coursesHidden: number; codesRevoked: number }> {
  const courses = await ctx.db
    .query("courses")
    .withIndex("by_instructor", (q) => q.eq("instructorId", instructorId as never))
    .collect();
  for (const course of courses) {
    if (course.status !== "hidden") {
      await ctx.db.patch(course._id, { status: "hidden", hiddenReason: reason });
    }
  }

  const codes = await ctx.db
    .query("enrollmentCodes")
    .withIndex("by_instructor", (q) => q.eq("instructorId", instructorId as never))
    .collect();
  for (const code of codes) {
    if (code.revokedAt === undefined) {
      await ctx.db.patch(code._id, { revokedAt: Date.now() });
    }
  }

  return { coursesHidden: courses.length, codesRevoked: codes.length };
}

/** One row per queue, with the counts the admin screen shows. */
type CoursesOverview = {
  kpis: {
    courses: number;
    instructors: number;
    enrollments: number;
    complaints: number;
    /** Codes issued across every instructor — the "are they selling?" number. */
    codes: number;
  };
  instructors: (Doc<"instructors"> & { courseCount: number })[];
  complaints: Doc<"courseComplaints">[];
  newComplaints: number;
  courses: Doc<"courses">[];
  reviews: Doc<"courseReviews">[];
};

export const overview = query({
  handler: async (ctx): Promise<CoursesOverview> => {
    await requireAdmin(ctx);

    const instructors = await ctx.db.query("instructors").order("desc").take(200);
    const complaints = await ctx.db
      .query("courseComplaints")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .order("desc")
      .take(200);
    const allComplaints = await ctx.db.query("courseComplaints").order("desc").take(200);

    const courses = await ctx.db
      .query("courses")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(200);
    const hiddenCourses = await ctx.db
      .query("courses")
      .withIndex("by_status", (q) => q.eq("status", "hidden"))
      .order("desc")
      .take(200);

    let enrollments = 0;
    for (const course of [...courses, ...hiddenCourses]) {
      enrollments += (
        await ctx.db
          .query("enrollments")
          .withIndex("by_course", (q) => q.eq("courseId", course._id))
          .collect()
      ).length;
    }

    const codes = await ctx.db.query("enrollmentCodes").collect();
    const reviews = await ctx.db.query("courseReviews").order("desc").take(100);

    const instructorRows: (Doc<"instructors"> & { courseCount: number })[] = [];
    for (const row of instructors) {
      const count = await ctx.db
        .query("courses")
        .withIndex("by_instructor", (q) => q.eq("instructorId", row._id))
        .collect();
      instructorRows.push({ ...row, courseCount: count.length });
    }

    return {
      kpis: {
        courses: courses.length + hiddenCourses.length,
        instructors: instructors.length,
        enrollments,
        complaints: allComplaints.length,
        codes: codes.length,
      },
      instructors: instructorRows,
      complaints: allComplaints,
      newComplaints: complaints.length,
      courses: [...courses, ...hiddenCourses],
      reviews,
    };
  },
});

const decision = v.union(
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("suspended"),
  v.literal("unsuspended"),
  v.literal("closed"),
);

export const decideInstructor = mutation({
  args: {
    instructorId: v.id("instructors"),
    decision,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.instructorId);
    if (!row) throw new Error("errNotFound");

    const note = args.note ? cleanText(args.note, 400) : undefined;
    const now = Date.now();

    // `unsuspended` is a distinct verb so "resume" never reads as a fresh
    // approval: the instructor keeps their courses.
    const status =
      args.decision === "unsuspended" ? "approved" : args.decision;

    await ctx.db.patch(args.instructorId, {
      status,
      decisionNote: note,
      decidedBy: admin.userId,
      decidedAt: now,
      updatedAt: now,
    });

    let cascade = { coursesHidden: 0, codesRevoked: 0 };
    if (status === "closed" || status === "suspended") {
      cascade = await revokeInstructor(
        ctx,
        args.instructorId,
        status === "closed" ? "instructor_closed" : "instructor_suspended",
      );
    }

    const message: Record<string, { title: string; body: string }> = {
      approved: {
        title: "تم قبولك كمدرب",
        body: "مبروك! تقدر دابا تنشر دوراتك من لوحة المدرب.",
      },
      rejected: {
        title: "مرفوض",
        body: note ? `السبب: ${note}` : "تقدّم من جديد بعد ما تحسن ملفك.",
      },
      suspended: {
        title: "حسابك معلّق",
        body: note ? `السبب: ${note}` : "مراجعة جارية. تواصل مع الإدارة.",
      },
      unsuspended: {
        title: "رُفع التعليق",
        body: "تدابري من جديد.",
      },
      closed: {
        title: "تم إغلاق حسابك",
        body: note ? `السبب: ${note}` : "مخالفة لشروط المنصة.",
      },
    };
    const copy = message[status] ?? message.approved;
    await notify(ctx, {
      userId: row.userId,
      type: "verification",
      title: copy.title,
      body:
        status === "closed"
          ? `${copy.body} (دوراتك: ${cascade.coursesHidden} — أكواد ملغاة: ${cascade.codesRevoked})`
          : copy.body,
      link: "/instructor",
    });

    await audit(ctx, {
      actorId: admin.userId,
      action: `instructor.${status}`,
      targetType: "instructor",
      targetId: args.instructorId,
      details: note,
    });

    return { ok: true, cascade };
  },
});

/** Hide or restore a single course. */
export const setCourseVisible = mutation({
  args: {
    courseId: v.id("courses"),
    visible: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");

    await ctx.db.patch(args.courseId, {
      status: args.visible ? "active" : "hidden",
      hiddenReason: args.visible ? undefined : "admin_hidden",
      updatedAt: Date.now(),
    });

    if (!args.visible) {
      await notify(ctx, {
        userId: course.ownerId,
        type: "verification",
        title: "دورتك مخفية",
        body: args.note
          ? `السبب: ${cleanText(args.note, 300)}`
          : "تواصلي مع الإدارة للمزيد.",
        link: `/courses/${args.courseId}`,
      });
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: args.visible ? "course.unhidden" : "course.hidden",
      targetType: "course",
      targetId: args.courseId,
      details: args.note,
    });
    return { ok: true };
  },
});

/**
 * Hide or restore one course review.
 *
 * A hidden review is excluded from the course payload (`get` filters on
 * `status === "visible"`) and its rating is taken back out of the denormalised
 * totals, so a hidden one-star review stops dragging the average down and a
 * hidden five-star review stops inflating it.
 */
export const setReviewVisible = mutation({
  args: { reviewId: v.id("courseReviews"), visible: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("errNotFound");

    const next = args.visible ? "visible" : "hidden";
    if (review.status === next) return { ok: true };

    await ctx.db.patch(args.reviewId, { status: next });

    const course = await ctx.db.get(review.courseId);
    if (course) {
      const delta = args.visible ? 1 : -1;
      await ctx.db.patch(course._id, {
        ratingCount: Math.max(0, course.ratingCount + delta),
        ratingSum: Math.max(0, course.ratingSum + delta * review.rating),
        updatedAt: Date.now(),
      });
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: args.visible ? "courseReview.unhidden" : "courseReview.hidden",
      targetType: "courseReview",
      targetId: args.reviewId,
    });
    return { ok: true };
  },
});

export const deleteCourse = mutation({
  args: { courseId: v.id("courses"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new Error("errNotFound");

    const codes = await ctx.db
      .query("enrollmentCodes")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .collect();
    for (const code of codes) {
      if (code.revokedAt === undefined) await ctx.db.patch(code._id, { revokedAt: Date.now() });
    }

    await ctx.db.delete(args.courseId);
    await audit(ctx, {
      actorId: admin.userId,
      action: "course.deleted",
      targetType: "course",
      targetId: args.courseId,
      details: args.note,
    });
    return { ok: true };
  },
});

export const decideComplaint = mutation({
  args: {
    complaintId: v.id("courseComplaints"),
    status: v.union(
      v.literal("new"),
      v.literal("investigating"),
      v.literal("resolved"),
      v.literal("rejected"),
    ),
    internalNote: v.optional(v.string()),
    /** Hide the course as part of resolving. */
    hideCourse: v.boolean(),
    /** Revoke every code of the course's instructor. */
    revokeCodes: v.boolean(),
    /** Tell the complainant the outcome. */
    notifyComplainant: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const complaint = await ctx.db.get(args.complaintId);
    if (!complaint) throw new Error("errNotFound");

    const internalNote = args.internalNote
      ? cleanText(args.internalNote, 400)
      : undefined;

    let coursesHidden = 0;
    let codesRevoked = 0;

    if (args.hideCourse && complaint.courseId) {
      const course = await ctx.db.get(complaint.courseId);
      if (course && course.status !== "hidden") {
        await ctx.db.patch(course._id, {
          status: "hidden",
          hiddenReason: "complaint",
          updatedAt: Date.now(),
        });
        coursesHidden = 1;
        await notify(ctx, {
          userId: course.ownerId,
          type: "verification",
          title: "دورتك مخفية بسبب شكوى",
          body: internalNote ? `السبب: ${internalNote}` : "قيد المراجعة.",
          link: `/courses/${course._id}`,
        });
      }
    }

    if (args.revokeCodes && complaint.instructorId) {
      const result = await revokeInstructor(
        ctx,
        complaint.instructorId,
        "complaint_revoked",
      );
      codesRevoked = result.codesRevoked;
    }

    await ctx.db.patch(args.complaintId, {
      status: args.status,
      internalNote,
      decidedBy: admin.userId,
      updatedAt: Date.now(),
    });

    if (args.notifyComplainant) {
      const copy =
        args.status === "resolved"
          ? { title: "تم حل الشكوى", body: "اتخذنا الإجراء اللازم. شكراً." }
          : args.status === "rejected"
            ? { title: "مقبول الاعتراض", body: "راجعنا البلاغ وما لقيناش مخالفة." }
            : { title: "الشكوى قيد التحقيق", body: "غادي نرجعو بيك." };
      await notify(ctx, {
        userId: complaint.userId,
        type: "verification",
        title: copy.title,
        body: copy.body,
        link: "/notifications",
        dedupeKey: `complaint:${args.complaintId}`,
        dedupeMs: 0,
      });
    }

    await audit(ctx, {
      actorId: admin.userId,
      action: `complaint.${args.status}`,
      targetType: "complaint",
      targetId: args.complaintId,
      details: [
        internalNote,
        args.hideCourse ? "hid course" : "",
        args.revokeCodes ? "revoked codes" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });

    return { ok: true, coursesHidden, codesRevoked };
  },
});
