/**
 * Admin → Courses.
 *
 * Four queues in one screen, in the order an admin actually works them:
 * complaints first (someone may be losing money right now), then instructor
 * applications, then the course list, then the numbers.
 *
 * Every destructive action takes a note, because the mutation writes an audit
 * row and "who closed this account, and why" has to be answerable later. The
 * note is optional for `approve` only.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Ban,
  Check,
  Eye,
  EyeOff,
  GraduationCap,
  Play,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { formatDate, wilayaName } from "@/lib/catalog";
import {
  COMPLAINT_STATUSES,
  courseStatusLabelKey,
  instructorStatusLabelKey,
  reasonLabelKey,
  statusLabelKey,
} from "@/lib/courses";
import { cn } from "@/lib/utils";

type InstructorRow = {
  _id: string;
  name: string;
  bio: string;
  experience: string;
  wilaya: number;
  status: "pending" | "approved" | "rejected" | "suspended" | "closed";
  courseCount: number;
  contactE164: string;
  createdAt: number;
};

type CourseRow = {
  _id: string;
  title: string;
  status: "draft" | "active" | "paused" | "hidden";
  hiddenReason?: string;
  viewCount: number;
  ratingCount: number;
};

type ReviewRow = {
  _id: string;
  courseId: string;
  rating: number;
  comment: string;
  status: "visible" | "hidden";
  instructorReply?: string;
  createdAt: number;
};

type ComplaintRow = {
  _id: string;
  targetType: "course" | "instructor";
  targetId: string;
  courseId?: string;
  reason: "scam" | "fake" | "harassment" | "other";
  description: string;
  code?: string;
  status: "new" | "investigating" | "resolved" | "rejected";
  internalNote?: string;
  createdAt: number;
};

const smallBtn =
  "tap-target inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs disabled:opacity-60";
const noteInput =
  "tap-target w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-brand-green";

export function AdminCourses() {
  const { t } = useLang();
  const data = useAuthQuery(api.adminCourses.overview, {});

  if (data === undefined) return <div className="skeleton h-40 w-full rounded-lg" />;

  const instructors = data.instructors;
  const courses = data.courses;
  const complaints = data.complaints as ComplaintRow[];
  const reviews = data.reviews as ReviewRow[];
  const pending = instructors.filter((row) => row.status === "pending");

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label={t.kpiCourses} value={data.kpis.courses} />
        <Tile label={t.kpiInstructors} value={data.kpis.instructors} />
        <Tile label={t.kpiEnrollments} value={data.kpis.enrollments} />
        <Tile label={t.codeCreate} value={data.kpis.codes} />
        <Tile label={t.kpiComplaints} value={data.kpis.complaints} highlight={data.newComplaints > 0} />
      </dl>

      {/* ------------------------------------------------------ complaints */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ShieldAlert className="size-4 shrink-0 text-red-700" aria-hidden />
          {t.adminComplaints}
        </h2>
        {complaints.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.adminNoComplaints}</p>
        ) : (
          <ul className="space-y-2">
            {complaints.map((row) => (
              <ComplaintCard key={row._id} complaint={row} />
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------- instructors */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-foreground">
          {t.adminInstructors} ({pending.length})
        </h2>
        {instructors.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.adminNoInstructors}</p>
        ) : (
          <ul className="space-y-2">
            {instructors.map((row) => (
              <InstructorCard key={row._id} instructor={row} />
            ))}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------- reviews */}
      {reviews.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-foreground">{t.courseReviews}</h2>
          <ul className="space-y-2">
            {reviews.slice(0, 20).map((row) => (
              <ReviewCard key={row._id} review={row} />
            ))}
          </ul>
        </section>
      )}

      {/* -------------------------------------------------------- courses */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <GraduationCap className="size-4 shrink-0 text-brand-green" aria-hidden />
          {t.adminCourses}
        </h2>
        {courses.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.instructorCoursesEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {courses.map((row) => (
              <CourseCard key={row._id} course={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-center",
        highlight ? "border-red-300 bg-red-50" : "border-border",
      )}
    >
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-bold", highlight ? "text-red-700" : "text-brand-green")}>
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function InstructorCard({ instructor }: { instructor: InstructorRow }) {
  const { t, lang } = useLang();
  const decide = useMutation(api.adminCourses.decideInstructor);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (decision: "approved" | "rejected" | "suspended" | "unsuspended" | "closed") => {
    setBusy(true);
    try {
      const result = await decide({
        instructorId: instructor._id as never,
        decision,
        note: note.trim() || undefined,
      });
      toast.success(
        result.cascade.coursesHidden > 0 || result.cascade.codesRevoked > 0
          ? `${t.approve} · ${result.cascade.coursesHidden} · ${result.cascade.codesRevoked}`
          : t.save,
      );
      setNote("");
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{instructor.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {wilayaName(instructor.wilaya, lang)}
            {" · "}
            <bdi dir="ltr">{instructor.contactE164}</bdi>
            {" · "}
            {t.kpiCourses}: <bdi>{instructor.courseCount}</bdi>
            {" · "}
            <bdi>{formatDate(instructor.createdAt, lang)}</bdi>
          </p>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {instructor.bio}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {instructor.experience}
          </p>
        </div>

        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            instructor.status === "approved"
              ? "border-brand-green text-brand-green"
              : instructor.status === "pending"
                ? "border-amber-400 text-amber-700"
                : "border-red-300 text-red-700",
          )}
        >
          {t[instructorStatusLabelKey(instructor.status) as keyof typeof t]}
        </span>
      </div>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t.internalNote}
        maxLength={400}
        className={cn(noteInput, "mt-2")}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        {instructor.status !== "approved" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("approved")}
            className={cn(smallBtn, "border-brand-green text-brand-green")}
          >
            <Check className="size-3" aria-hidden />
            {t.approve}
          </button>
        )}
        {instructor.status === "pending" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("rejected")}
            className={cn(smallBtn, "text-red-700")}
          >
            <X className="size-3" aria-hidden />
            {t.reject}
          </button>
        )}
        {instructor.status === "approved" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("suspended")}
            className={smallBtn}
          >
            <Ban className="size-3" aria-hidden />
            {t.suspend}
          </button>
        )}
        {instructor.status === "suspended" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("unsuspended")}
            className={smallBtn}
          >
            <Play className="size-3" aria-hidden />
            {t.unsuspend}
          </button>
        )}
        {instructor.status !== "closed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("closed")}
            className={cn(smallBtn, "border-red-300 text-red-700")}
          >
            <Ban className="size-3" aria-hidden />
            {t.closeInstructor}
          </button>
        )}
      </div>
    </li>
  );
}

function CourseCard({ course }: { course: CourseRow }) {
  const { t } = useLang();
  const setVisible = useMutation(api.adminCourses.setCourseVisible);
  const remove = useMutation(api.adminCourses.deleteCourse);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const hidden = course.status === "hidden";

  return (
    <li className="rounded-lg border border-border p-3">
      <p className="truncate text-sm font-bold text-foreground">{course.title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {t[courseStatusLabelKey(course.status) as keyof typeof t]}
        {" · "}
        {t.statsViews}: <bdi>{course.viewCount}</bdi>
        {" · "}
        {t.statsReviews}: <bdi>{course.ratingCount}</bdi>
        {course.hiddenReason ? ` · ${course.hiddenReason}` : ""}
      </p>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t.internalNote}
        maxLength={400}
        className={cn(noteInput, "mt-2")}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await setVisible({
                courseId: course._id as never,
                visible: hidden,
                note: note.trim() || undefined,
              });
              toast.success(hidden ? t.unhideCourse : t.hideCourse);
            } catch {
              toast.error(t.errGeneric);
            } finally {
              setBusy(false);
            }
          }}
          className={smallBtn}
        >
          {hidden ? <Eye className="size-3" aria-hidden /> : <EyeOff className="size-3" aria-hidden />}
          {hidden ? t.unhideCourse : t.hideCourse}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await remove({ courseId: course._id as never, note: note.trim() || undefined });
              toast.success(t.deleteCourse);
            } catch {
              toast.error(t.errGeneric);
            } finally {
              setBusy(false);
            }
          }}
          className={cn(smallBtn, "border-red-300 text-red-700")}
        >
          <Trash2 className="size-3" aria-hidden />
          {t.deleteCourse}
        </button>
      </div>
    </li>
  );
}

function ReviewCard({ review }: { review: ReviewRow }) {
  const { t, lang } = useLang();
  const setVisible = useMutation(api.adminCourses.setReviewVisible);
  const [busy, setBusy] = useState(false);
  const hidden = review.status === "hidden";

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-0.5" aria-label={`${review.rating}/5`}>
            {[1, 2, 3, 4, 5].map((step) => (
              <Star
                key={step}
                className={cn(
                  "size-3.5",
                  step <= review.rating
                    ? "fill-current text-amber-500"
                    : "text-muted-foreground",
                )}
                aria-hidden
              />
            ))}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-foreground">
            {review.comment}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <bdi>{formatDate(review.createdAt, lang)}</bdi>
            {review.instructorReply ? ` · ${t.instructorReply}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await setVisible({ reviewId: review._id as never, visible: hidden });
              toast.success(hidden ? t.unhideReview : t.hideReview);
            } catch {
              toast.error(t.errGeneric);
            } finally {
              setBusy(false);
            }
          }}
          className={cn(smallBtn, "disabled:opacity-60")}
        >
          {hidden ? (
            <Eye className="size-3" aria-hidden />
          ) : (
            <EyeOff className="size-3" aria-hidden />
          )}
          {hidden ? t.unhideReview : t.hideReview}
        </button>
      </div>
    </li>
  );
}

function ComplaintCard({ complaint }: { complaint: ComplaintRow }) {
  const { t, lang } = useLang();
  const decide = useMutation(api.adminCourses.decideComplaint);
  const [note, setNote] = useState(complaint.internalNote ?? "");
  const [hideCourse, setHideCourse] = useState(false);
  const [revokeCodes, setRevokeCodes] = useState(false);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async (status: (typeof COMPLAINT_STATUSES)[number]) => {
    setBusy(true);
    try {
      await decide({
        complaintId: complaint._id as never,
        status,
        internalNote: note.trim() || undefined,
        hideCourse,
        revokeCodes,
        notifyComplainant: notify,
      });
      toast.success(t[statusLabelKey(status) as keyof typeof t]);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-red-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            {complaint.targetType === "course" ? t.reportCourseTitle : t.reportInstructorTitle}
            {" · "}
            {t[reasonLabelKey(complaint.reason) as keyof typeof t]}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <bdi>{formatDate(complaint.createdAt, lang)}</bdi>
            {complaint.code ? (
              <>
                {" · "}
                <bdi dir="ltr">{complaint.code}</bdi>
              </>
            ) : null}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-foreground">
            {complaint.description}
          </p>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {t[statusLabelKey(complaint.status) as keyof typeof t]}
        </span>
      </div>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t.internalNote}
        maxLength={400}
        className={cn(noteInput, "mt-2")}
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="inline-flex cursor-pointer items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            checked={hideCourse}
            onChange={(event) => setHideCourse(event.target.checked)}
            className="size-3.5 accent-brand-green"
          />
          {t.hideCourse}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            checked={revokeCodes}
            onChange={(event) => setRevokeCodes(event.target.checked)}
            className="size-3.5 accent-brand-green"
          />
          {t.codeRevoke}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
            className="size-3.5 accent-brand-green"
          />
          {t.notifyComplainant}
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {COMPLAINT_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            disabled={busy || status === complaint.status}
            onClick={() => void run(status)}
            className={cn(smallBtn, "disabled:opacity-40")}
          >
            {t[statusLabelKey(status) as keyof typeof t]}
          </button>
        ))}
      </div>
    </li>
  );
}
