/**
 * Instructor area: applying to teach, then running the courses.
 *
 * The page is a small state machine over one query — `myApplication` — because
 * that is exactly the server's rule:
 *   none      -> the application form;
 *   rejected  -> the same form, pre-faced with the reason (a rejected file can
 *                be amended and re-submitted);
 *   pending   -> a waiting screen with a withdraw button;
 *   approved  -> the dashboard (courses, codes, materials, announcements);
 *   suspended/closed -> an explanation and no editing. The server refuses those
 *                writes anyway, so showing the form would be a lie.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  BadgeCheck,
  BarChart3,
  Eye,
  GraduationCap,
  KeyRound,
  Megaphone,
  Paperclip,
  Plus,
  Star,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { interpolate } from "@/lib/i18n";
import {
  COURSE_FORMATS,
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  COURSE_TOPICS,
  codeRemaining,
  codeStateLabelKey,
  courseStatusLabelKey,
  formatLabelKey,
  instructorStatusLabelKey,
  languageLabelKey,
  levelLabelKey,
} from "@/lib/courses";
import {
  MAX_IMAGE_BYTES,
  WILAYAS,
  formatDate,
  normalizeAlgerianPhone,
} from "@/lib/catalog";
import { StorageImage } from "@/components/StorageImage";
import { uploadImage } from "@/lib/imageUpload";
import { cn } from "@/lib/utils";

const inputClass =
  "tap-target w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand-green";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";
const primaryBtn =
  "tap-target inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-60";
const ghostBtn =
  "tap-target inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm disabled:opacity-60";

/** `yyyy-mm-dd` from a timestamp, for an `<input type="date">`. */
function dateInputValue(timestamp?: number): string {
  if (timestamp === undefined) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function Instructor() {
  const application = useAuthQuery(api.instructor.myApplication, {});

  if (application === undefined) {
    return <div className="skeleton h-40 w-full rounded-lg" />;
  }

  if (application.status === "none" || application.status === "rejected") {
    return <ApplyForm note={application.decisionNote} />;
  }

  if (application.status === "pending") {
    return <ApplicationState note={application.decisionNote} />;
  }

  return <Dashboard status={application.status} note={application.decisionNote} />;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

function ApplyForm({ note }: { note?: string | null }) {
  const { t, lang } = useLang();
  const apply = useMutation(api.instructor.apply);
  const upload = useMutation(api.storage.createImageUpload);

  const [form, setForm] = useState({
    name: "",
    bio: "",
    experience: "",
    contactE164: "",
    wilaya: String(WILAYAS[0]?.code ?? 16),
  });
  const [proofLinks, setProofLinks] = useState("");
  const [socialLinks, setSocialLinks] = useState("");
  const [photoStorageId, setPhotoStorageId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const result = await uploadImage(file, "instructor", upload);
    if (result.ok) setPhotoStorageId(result.storageId);
    else toast.error(t[result.error]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const phone = normalizeAlgerianPhone(form.contactE164);
    if (!phone) {
      setError(t.errInvalidPhone);
      return;
    }
    if (!form.name.trim() || !form.bio.trim() || !form.experience.trim()) {
      setError(t.errRequired);
      return;
    }

    setBusy(true);
    try {
      await apply({
        name: form.name,
        bio: form.bio,
        experience: form.experience,
        photoStorageId,
        proofLinks: proofLinks
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        contactE164: phone,
        wilaya: Number(form.wilaya),
        socialLinks: socialLinks
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      toast.success(t.instructorSubmitted);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message === "errNotAuthorized" ? t.errNotAuthorized : t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <GraduationCap className="size-5 shrink-0 text-brand-green" aria-hidden />
          {t.instructorApplyTitle}
        </h1>
        <p className="text-sm text-muted-foreground">{t.instructorApplyIntro}</p>
        {note && (
          <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
            {t.instructorRejected} {note}
          </p>
        )}
      </header>

      <label className="block">
        <span className={labelClass}>{t.instructorFullName}</span>
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          maxLength={80}
          required
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>{t.instructorBio}</span>
        <textarea
          value={form.bio}
          onChange={(event) => setForm({ ...form, bio: event.target.value })}
          rows={3}
          maxLength={600}
          required
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>

      <label className="block">
        <span className={labelClass}>{t.instructorExperience}</span>
        <textarea
          value={form.experience}
          onChange={(event) => setForm({ ...form, experience: event.target.value })}
          rows={3}
          maxLength={600}
          required
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t.instructorContact}</span>
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder="0555 12 34 56"
            value={form.contactE164}
            onChange={(event) => setForm({ ...form, contactE164: event.target.value })}
            required
            className={cn(inputClass, "text-start")}
          />
        </label>

        <label className="block">
          <span className={labelClass}>{t.filterWilaya}</span>
          <select
            value={form.wilaya}
            onChange={(event) => setForm({ ...form, wilaya: event.target.value })}
            className={inputClass}
          >
            {WILAYAS.map((row) => (
              <option key={row.code} value={String(row.code)}>
                {lang === "ar" ? row.ar : row.fr}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>{t.instructorProof}</span>
        <textarea
          value={proofLinks}
          onChange={(event) => setProofLinks(event.target.value)}
          rows={3}
          dir="ltr"
          placeholder="https://..."
          className={cn(inputClass, "h-auto py-2 text-start")}
        />
      </label>

      <label className="block">
        <span className={labelClass}>{t.instructorSocials}</span>
        <textarea
          value={socialLinks}
          onChange={(event) => setSocialLinks(event.target.value)}
          rows={2}
          dir="ltr"
          className={cn(inputClass, "h-auto py-2 text-start")}
        />
      </label>

      <div>
        <span className={labelClass}>{t.instructorPhoto}</span>
        <div className="flex items-center gap-3">
          {photoStorageId && (
            <div className="size-14 shrink-0 overflow-hidden rounded-full border border-border">
              <StorageImage storageId={photoStorageId} alt="" className="size-full object-cover" />
            </div>
          )}
          <label className={cn(ghostBtn, "cursor-pointer")}>
            <Upload className="size-4" aria-hidden />
            {t.instructorPhoto}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void onPickPhoto(event.target.files?.[0])}
            />
          </label>
          <span className="text-[11px] text-muted-foreground">
            <bdi>{Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB</bdi>
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className={cn(primaryBtn, "w-full")}>
        {t.instructorApplyBtn}
      </button>
    </form>
  );
}

function ApplicationState({ note }: { note?: string | null }) {
  const { t } = useLang();
  const withdraw = useMutation(api.instructor.withdraw);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-foreground">{t.instructorDashboardTitle}</h1>
      <div className="rounded-lg border border-border p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BadgeCheck className="size-4 shrink-0 text-brand-green" aria-hidden />
          {t.instructorPending}
        </p>
        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await withdraw({});
            toast.success(t.instructorWithdraw);
          } catch {
            toast.error(t.errGeneric);
          } finally {
            setBusy(false);
          }
        }}
        className={ghostBtn}
      >
        {t.instructorWithdraw}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({
  status,
  note,
}: {
  status: "approved" | "suspended" | "closed";
  note?: string | null;
}) {
  const { t } = useLang();
  const stats = useAuthQuery(api.instructor.stats, {});
  const courses = useAuthQuery(api.instructor.listMyCourses, {});
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [openPanel, setOpenPanel] = useState<{ courseId: string; panel: Panel } | null>(null);

  const approved = status === "approved";
  const toggle = (courseId: string, panel: Panel) =>
    setOpenPanel(
      openPanel?.courseId === courseId && openPanel.panel === panel
        ? null
        : { courseId, panel },
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-foreground">{t.instructorDashboardTitle}</h1>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <BadgeCheck
              className={cn("size-3.5", approved ? "text-brand-green" : "text-muted-foreground")}
              aria-hidden
            />
            {t[instructorStatusLabelKey(status) as keyof typeof t]}
          </p>
        </div>
        {approved && (
          <button type="button" onClick={() => setEditing("new")} className={primaryBtn}>
            <Plus className="size-4" aria-hidden />
            {t.createCourse}
          </button>
        )}
      </header>

      {!approved && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          {t.instructorNoAccess}
          {note ? ` (${note})` : ""}
        </p>
      )}

      {/* ------------------------------------------------------------- KPIs */}
      {stats && (
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat icon={BarChart3} label={t.kpiCourses} value={stats.courses} />
          <Stat icon={Eye} label={t.statsViews} value={stats.views} />
          <Stat icon={KeyRound} label={t.statsRedemptions} value={stats.redemptions} />
          <Stat
            icon={Star}
            label={t.statsReviews}
            value={stats.rating === null ? stats.reviews : `${stats.reviews} · ${stats.rating}`}
          />
        </dl>
      )}

      {approved && editing !== null && (
        <CourseForm
          courseId={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {/* ---------------------------------------------------------- courses */}
      {courses === undefined ? (
        <div className="skeleton h-32 w-full rounded-lg" />
      ) : courses.courses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t.instructorCoursesEmpty}
        </p>
      ) : (
        <ul className="space-y-2">
          {(courses.courses as CourseRow[]).map((course) => (
            <li key={course._id} className="rounded-lg border border-border p-3">
              <div className="flex items-start gap-3">
                <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-brand-green-tint">
                  {course.coverStorageId ? (
                    <StorageImage
                      storageId={course.coverStorageId}
                      alt={course.title}
                      seed={course._id}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <GraduationCap className="size-5 text-brand-green" aria-hidden />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{course.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-brand-green">
                      {t[courseStatusLabelKey(course.status) as keyof typeof t]}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" aria-hidden />
                      <bdi>{course.redemptions}</bdi>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3" aria-hidden />
                      <bdi>{course.rating === null ? "—" : course.rating}</bdi>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="size-3" aria-hidden />
                      <bdi>{course.viewCount}</bdi>
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {approved && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(course._id)}
                      className="tap-target rounded-lg border border-border px-3 text-xs"
                    >
                      {t.editCourse}
                    </button>
                    <StatusButton courseId={course._id} status={course.status} />
                    <button
                      type="button"
                      onClick={() => toggle(course._id, "codes")}
                      className="tap-target inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs"
                    >
                      <KeyRound className="size-3" aria-hidden />
                      {t.myCodes}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(course._id, "materials")}
                      className="tap-target inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs"
                    >
                      <Paperclip className="size-3" aria-hidden />
                      {t.materialsTitle}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(course._id, "announcements")}
                      className="tap-target inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs"
                    >
                      <Megaphone className="size-3" aria-hidden />
                      {t.announcementsTitle}
                    </button>
                    <DeleteCourseButton courseId={course._id} />
                  </>
                )}
                <Link
                  to={`/courses/${course._id}`}
                  className="tap-target inline-flex items-center rounded-lg border border-border px-3 text-xs text-muted-foreground"
                >
                  {t.viewCourse}
                </Link>
              </div>

              {openPanel?.courseId === course._id && openPanel.panel === "codes" && (
                <CodesPanel courseId={course._id} />
              )}
              {openPanel?.courseId === course._id && openPanel.panel === "materials" && (
                <MaterialsPanel courseId={course._id} />
              )}
              {openPanel?.courseId === course._id && openPanel.panel === "announcements" && (
                <AnnouncementsPanel courseId={course._id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Panel = "codes" | "materials" | "announcements";

type CourseRow = {
  _id: string;
  title: string;
  status: "draft" | "active" | "paused" | "hidden";
  coverStorageId?: string;
  viewCount: number;
  redemptions: number;
  reviews: number;
  rating: number | null;
};

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BarChart3;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <dt className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-base font-bold text-brand-green">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function StatusButton({
  courseId,
  status,
}: {
  courseId: string;
  status: "draft" | "active" | "paused" | "hidden";
}) {
  const { t } = useLang();
  const setStatus = useMutation(api.instructor.setCourseStatus);
  const [busy, setBusy] = useState(false);

  // `hidden` is a moderation decision: an instructor can never un-hide a course.
  if (status === "hidden") return null;

  const next = status === "active" ? "paused" : "active";
  const label =
    status === "active" ? t.pauseCourse : status === "paused" ? t.resumeCourse : t.publishCourse;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await setStatus({ courseId: courseId as never, status: next });
          toast.success(label);
        } catch {
          toast.error(t.errGeneric);
        } finally {
          setBusy(false);
        }
      }}
      className="tap-target rounded-lg border border-border px-3 text-xs disabled:opacity-60"
    >
      {label}
    </button>
  );
}

function DeleteCourseButton({ courseId }: { courseId: string }) {
  const { t } = useLang();
  const remove = useMutation(api.instructor.deleteCourse);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="tap-target inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs text-red-700"
      >
        <Trash2 className="size-3" aria-hidden />
        {t.deleteProduct}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await remove({ courseId: courseId as never });
          toast.success(t.deleteProduct);
        } catch {
          toast.error(t.errGeneric);
        } finally {
          setBusy(false);
          setConfirm(false);
        }
      }}
      className="tap-target inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 text-xs text-red-700 disabled:opacity-60"
    >
      <Trash2 className="size-3" aria-hidden />
      {t.deleteConfirm}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Course create / edit
// ---------------------------------------------------------------------------

type CourseDraft = {
  title: string;
  description: string;
  topics: string[];
  level: (typeof COURSE_LEVELS)[number];
  language: (typeof COURSE_LANGUAGES)[number];
  format: (typeof COURSE_FORMATS)[number];
  wilaya: string;
  durationHours: string;
  priceDa: string;
  startsAt: string;
  seats: string;
  curriculum: string;
  previewVideoUrl: string;
  externalContact: string;
};

function draftFrom(course: Doc<"courses"> | null): CourseDraft {
  return {
    title: course?.title ?? "",
    description: course?.description ?? "",
    topics: course?.topics ?? [],
    level: course?.level ?? "beginner",
    language: course?.language ?? "ar",
    format: course?.format ?? "recorded",
    wilaya: String(course?.wilaya ?? WILAYAS[0]?.code ?? 16),
    durationHours: String(course?.durationHours ?? 6),
    priceDa: course === null ? "" : String(course.priceDa),
    startsAt: dateInputValue(course?.startsAt),
    seats: course?.seats === undefined ? "" : String(course.seats),
    curriculum: course?.curriculum.join("\n") ?? "",
    previewVideoUrl: course?.previewVideoUrl ?? "",
    externalContact: course?.externalContact ?? "",
  };
}

/**
 * Loads the existing course (if any) before mounting the form, so the form
 * body can seed its state once from props instead of overwriting what the
 * instructor is typing on a later render.
 */
function CourseForm({
  courseId,
  onClose,
}: {
  courseId?: string;
  onClose: () => void;
}) {
  const existing = useAuthQuery(
    api.instructor.getMyCourse,
    courseId ? { courseId: courseId as never } : "skip",
  );

  if (courseId && existing === undefined) {
    return <div className="skeleton h-40 w-full rounded-lg" />;
  }

  return (
    <CourseFormBody
      key={courseId ?? "new"}
      courseId={courseId}
      initial={existing ?? null}
      onClose={onClose}
    />
  );
}

function CourseFormBody({
  courseId,
  initial,
  onClose,
}: {
  courseId?: string;
  initial: Doc<"courses"> | null;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const create = useMutation(api.instructor.createCourse);
  const update = useMutation(api.instructor.updateCourse);
  const upload = useMutation(api.storage.createImageUpload);

  const [form, setForm] = useState<CourseDraft>(() => draftFrom(initial));
  const [coverStorageId, setCoverStorageId] = useState<string | undefined>(
    initial?.coverStorageId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPickCover = async (file: File | undefined) => {
    if (!file) return;
    const result = await uploadImage(file, "course", upload);
    if (result.ok) setCoverStorageId(result.storageId);
    else toast.error(t[result.error]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const price = Number(form.priceDa);
    const duration = Number(form.durationHours);
    if (!form.title.trim() || form.description.trim().length < 30) {
      setError(t.errRequired);
      return;
    }
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(duration) || duration < 0) {
      setError(t.errRequired);
      return;
    }

    const payload = {
      title: form.title,
      description: form.description,
      coverStorageId,
      topics: form.topics,
      level: form.level,
      language: form.language,
      format: form.format,
      wilaya: form.format === "in_person" ? Number(form.wilaya) : undefined,
      durationHours: duration,
      priceDa: price,
      startsAt: form.startsAt ? new Date(form.startsAt).getTime() : undefined,
      seats: form.seats ? Number(form.seats) : undefined,
      curriculum: form.curriculum
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      previewVideoUrl: form.previewVideoUrl.trim() || undefined,
      externalContact: form.externalContact,
    };

    setBusy(true);
    try {
      if (courseId) await update({ courseId: courseId as never, ...payload });
      else await create(payload);
      toast.success(courseId ? t.saveCourse : t.createCourse);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message === "errNotAuthorized" ? t.errNotAuthorized : t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-brand-green p-4"
      noValidate
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">
          {courseId ? t.editCourse : t.createCourse}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="tap-target px-2 text-xs text-muted-foreground"
        >
          {t.cancel}
        </button>
      </div>

      <label className="block">
        <span className={labelClass}>{t.courseTitleLabel}</span>
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          maxLength={120}
          required
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>{t.courseDescription}</span>
        <textarea
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          rows={4}
          maxLength={4000}
          required
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>

      <div>
        <span className={labelClass}>{t.courseTopics}</span>
        <div className="flex flex-wrap gap-2">
          {COURSE_TOPICS.map((topic) => {
            const active = form.topics.includes(topic);
            return (
              <button
                key={topic}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setForm({
                    ...form,
                    topics: active
                      ? form.topics.filter((item) => item !== topic)
                      : [...form.topics, topic],
                  })
                }
                className={cn(
                  "tap-target rounded-full border px-3 text-xs",
                  active
                    ? "border-brand-green bg-brand-green-tint text-brand-green-dark"
                    : "border-border text-muted-foreground",
                )}
              >
                {t[topic]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t.filterLevel}</span>
          <select
            value={form.level}
            onChange={(event) =>
              setForm({ ...form, level: event.target.value as CourseDraft["level"] })
            }
            className={inputClass}
          >
            {COURSE_LEVELS.map((key) => (
              <option key={key} value={key}>
                {t[levelLabelKey(key) as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelClass}>{t.courseLanguageLabel}</span>
          <select
            value={form.language}
            onChange={(event) =>
              setForm({ ...form, language: event.target.value as CourseDraft["language"] })
            }
            className={inputClass}
          >
            {COURSE_LANGUAGES.map((key) => (
              <option key={key} value={key}>
                {t[languageLabelKey(key) as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelClass}>{t.courseFormat}</span>
          <select
            value={form.format}
            onChange={(event) =>
              setForm({ ...form, format: event.target.value as CourseDraft["format"] })
            }
            className={inputClass}
          >
            {COURSE_FORMATS.map((key) => (
              <option key={key} value={key}>
                {t[formatLabelKey(key) as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>

        {form.format === "in_person" && (
          <label className="block">
            <span className={labelClass}>{t.filterWilaya}</span>
            <select
              value={form.wilaya}
              onChange={(event) => setForm({ ...form, wilaya: event.target.value })}
              className={inputClass}
            >
              {WILAYAS.map((row) => (
                <option key={row.code} value={String(row.code)}>
                  {lang === "ar" ? row.ar : row.fr}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t.courseDuration}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={form.durationHours}
            onChange={(event) => setForm({ ...form, durationHours: event.target.value })}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>{t.coursePrice}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            dir="ltr"
            value={form.priceDa}
            onChange={(event) => setForm({ ...form, priceDa: event.target.value })}
            className={cn(inputClass, "text-start")}
          />
        </label>

        <label className="block">
          <span className={labelClass}>{t.courseStartsAt}</span>
          <input
            type="date"
            value={form.startsAt}
            onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>{t.courseSeats}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={form.seats}
            onChange={(event) => setForm({ ...form, seats: event.target.value })}
            className={inputClass}
          />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>{t.courseCurriculum}</span>
        <textarea
          value={form.curriculum}
          onChange={(event) => setForm({ ...form, curriculum: event.target.value })}
          rows={4}
          placeholder={t.courseCurriculumHint}
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>

      <label className="block">
        <span className={labelClass}>{t.coursePreviewVideo}</span>
        <input
          dir="ltr"
          placeholder="https://..."
          value={form.previewVideoUrl}
          onChange={(event) => setForm({ ...form, previewVideoUrl: event.target.value })}
          className={cn(inputClass, "text-start")}
        />
      </label>

      <label className="block">
        <span className={labelClass}>{t.courseExternalContact}</span>
        <input
          value={form.externalContact}
          onChange={(event) => setForm({ ...form, externalContact: event.target.value })}
          maxLength={120}
          required
          className={inputClass}
        />
      </label>

      <div>
        <span className={labelClass}>{t.courseCover}</span>
        <div className="flex items-center gap-3">
          {coverStorageId && (
            <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-border">
              <StorageImage storageId={coverStorageId} alt="" className="size-full object-cover" />
            </div>
          )}
          <label className={cn(ghostBtn, "cursor-pointer")}>
            <Upload className="size-4" aria-hidden />
            {t.courseCover}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void onPickCover(event.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className={cn(primaryBtn, "w-full")}>
        {t.saveCourse}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** `state` comes from the server: the badge must not re-derive it per render. */
type CodeRow = {
  _id: string;
  code: string;
  maxUses: number;
  uses: number;
  label?: string;
  expiresAt?: number;
  revokedAt?: number;
  state: "revoked" | "expired" | "usedUp" | "available";
};

function CodesPanel({ courseId }: { courseId: string }) {
  const { t, lang } = useLang();
  const codes = useAuthQuery(api.instructor.listCodes, { courseId: courseId as never }) as
    | CodeRow[]
    | undefined;
  const createCode = useMutation(api.instructor.createCode);
  const revokeCode = useMutation(api.instructor.revokeCode);

  const [single, setSingle] = useState(true);
  const [maxUses, setMaxUses] = useState("10");
  const [expiresAt, setExpiresAt] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      await createCode({
        courseId: courseId as never,
        singleUse: single,
        maxUses: Number(maxUses) || 1,
        expiresAt: expiresAt ? new Date(expiresAt).getTime() : undefined,
        label: label.trim() || undefined,
      });
      setLabel("");
      toast.success(t.codeCreated);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-muted p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t.codeLabel}</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={60}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>{t.codeExpiry}</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="tap-target inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={single}
            onChange={(event) => setSingle(event.target.checked)}
            className="size-4 accent-brand-green"
          />
          {t.codeSingle}
        </label>

        {!single && (
          <label className="block">
            <span className={labelClass}>{t.codeMaxUses}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              className={inputClass}
            />
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className={cn(primaryBtn, "w-full")}
      >
        <KeyRound className="size-4" aria-hidden />
        {t.codeCreate}
      </button>

      {codes === undefined ? (
        <div className="skeleton h-12 w-full rounded-lg" />
      ) : codes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.codesEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {codes.map((row) => {
            const state = row.state;
            return (
              <li
                key={row._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-2"
              >
                <div className="min-w-0">
                  <p
                    className="font-mono text-sm font-bold tracking-widest text-foreground"
                    dir="ltr"
                  >
                    {row.code}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {interpolate(t.codeUses, { used: row.uses, max: row.maxUses })}
                    {" · "}
                    {t[codeStateLabelKey(state) as keyof typeof t]}
                    {row.label ? ` · ${row.label}` : ""}
                    {row.expiresAt !== undefined && (
                      <>
                        {" · "}
                        <bdi>{formatDate(row.expiresAt, lang)}</bdi>
                      </>
                    )}
                    {" · "}
                    <bdi>{codeRemaining(row)}</bdi>
                  </p>
                </div>

                {state !== "revoked" && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await revokeCode({ codeId: row._id as never });
                        toast.success(t.codeRevoke);
                      } catch {
                        toast.error(t.errGeneric);
                      }
                    }}
                    className="tap-target rounded-lg border border-red-300 px-3 text-xs text-red-700"
                  >
                    {t.codeRevoke}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Materials & announcements
// ---------------------------------------------------------------------------

function MaterialsPanel({ courseId }: { courseId: string }) {
  const { t } = useLang();
  const materials = useAuthQuery(api.courses.materials, { courseId: courseId as never }) as
    | { _id: string; title: string; link: string; note?: string }[]
    | undefined;
  const addMaterial = useMutation(api.instructor.addMaterial);
  const removeMaterial = useMutation(api.instructor.removeMaterial);

  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await addMaterial({
        courseId: courseId as never,
        title,
        link,
        note: note.trim() || undefined,
      });
      setTitle("");
      setLink("");
      setNote("");
      toast.success(t.addMaterial);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-muted p-3">
      <label className="block">
        <span className={labelClass}>{t.materialTitle}</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>{t.materialLink}</span>
        <input
          dir="ltr"
          placeholder="https://..."
          value={link}
          onChange={(event) => setLink(event.target.value)}
          className={cn(inputClass, "text-start")}
        />
      </label>
      <label className="block">
        <span className={labelClass}>{t.materialNote}</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={800}
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>

      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || !title.trim() || !link.trim()}
        className={cn(primaryBtn, "w-full")}
      >
        <Paperclip className="size-4" aria-hidden />
        {t.addMaterial}
      </button>

      {materials === undefined ? (
        <div className="skeleton h-10 w-full rounded-lg" />
      ) : materials.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.materialsEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {materials.map((row) => (
            <li
              key={row._id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{row.title}</p>
                <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                  {row.link}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await removeMaterial({ materialId: row._id as never });
                  } catch {
                    toast.error(t.errGeneric);
                  }
                }}
                className="tap-target inline-flex items-center gap-1 rounded-lg border border-border px-2 text-xs text-red-700"
              >
                <Trash2 className="size-3" aria-hidden />
                {t.deleteProduct}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnouncementsPanel({ courseId }: { courseId: string }) {
  const { t, lang } = useLang();
  const announcements = useAuthQuery(api.courses.announcements, {
    courseId: courseId as never,
  });
  const addAnnouncement = useMutation(api.instructor.addAnnouncement);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    setBusy(true);
    try {
      await addAnnouncement({ courseId: courseId as never, title, body });
      setTitle("");
      setBody("");
      toast.success(t.publish);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-muted p-3">
      <label className="block">
        <span className={labelClass}>{t.announcementTitle}</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>{t.announcementBody}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={800}
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>

      <button
        type="button"
        onClick={() => void publish()}
        disabled={busy || !title.trim() || !body.trim()}
        className={cn(primaryBtn, "w-full")}
      >
        <Megaphone className="size-4" aria-hidden />
        {t.addAnnouncement}
      </button>

      {announcements === undefined ? (
        <div className="skeleton h-10 w-full rounded-lg" />
      ) : announcements.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.announcementsEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {announcements.map((row) => (
            <li key={row._id} className="rounded-lg border border-border bg-background p-2">
              <p className="text-sm font-semibold text-foreground">{row.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <bdi>{formatDate(row.createdAt, lang)}</bdi>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
