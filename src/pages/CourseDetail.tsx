/**
 * One course page.
 *
 * Everything a visitor can do lives here, and every one of those actions is
 * gated by the server as well — this page only decides what to *show*:
 *
 *  - the price and the description are public;
 *  - the instructor's number is only rendered for a signed-in visitor (the
 *    query returns `null` for anyone else, so it is never in the payload);
 *  - the enrollment box is replaced by the private materials once a code has
 *    been redeemed;
 *  - the review form appears only when the server says `canReview`, so the
 *    button and the 48-hour rule can never disagree;
 *  - a complaint is one form, reachable from the course and from the
 *    instructor card.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock,
  GraduationCap,
  Image as ImageIcon,
  KeyRound,
  MapPin,
  MessageCircle,
  Send,
  Star,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuth } from "@/hooks/use-auth";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { interpolate } from "@/lib/i18n";
import {
  formatDate,
  formatRelativeTime,
  wilayaName,
  whatsappUrl,
} from "@/lib/catalog";
import {
  COMPLAINT_REASONS,
  courseDurationText,
  coursePriceText,
  courseWhatsappMessage,
  formatLabelKey,
  languageLabelKey,
  levelLabelKey,
  parseCourseLock,
  reasonLabelKey,
} from "@/lib/courses";
import { StorageImage } from "@/components/StorageImage";
import { uploadImage } from "@/lib/imageUpload";
import { cn } from "@/lib/utils";

const inputClass =
  "tap-target w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand-green";

export function CourseDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const { isAuthenticated, user } = useAuth();

  const data = useQuery(api.courses.get, id ? { courseId: id as never } : "skip");
  const trackView = useMutation(api.instructor.trackView);
  const tracked = useRef<string | null>(null);

  // Count the view once per course, not once per render.
  useEffect(() => {
    const courseId = data?.course._id;
    if (!courseId || tracked.current === courseId) return;
    tracked.current = courseId;
    void trackView({ courseId }).catch(() => undefined);
  }, [data?.course._id, trackView]);

  if (data === undefined) {
    return (
      <div className="space-y-3">
        <div className="skeleton aspect-video w-full rounded-lg" />
        <div className="skeleton h-6 w-2/3 rounded" />
        <div className="skeleton h-24 w-full rounded" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <GraduationCap className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-semibold text-foreground">{t.errNotFound}</p>
        <Link
          to="/courses"
          className="tap-target mt-4 inline-flex items-center rounded-lg border border-border px-4 text-sm"
        >
          {t.backToCourses}
        </Link>
      </div>
    );
  }

  const { course, instructor, reviews } = data;
  // Whether *this* user already reviewed decides which message the box shows;
  // the server still has the last word via `canReview`.
  const alreadyReviewed = user
    ? reviews.some((review) => String(review.userId) === String(user._id))
    : false;

  return (
    <article className="space-y-5">
      <Link to="/courses" className="inline-flex text-sm text-muted-foreground hover:text-brand-green">
        {t.backToCourses}
      </Link>

      {/* ----------------------------------------------------------- cover */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-brand-green-tint">
        {course.coverStorageId ? (
          <StorageImage
            storageId={course.coverStorageId}
            alt={course.title}
            seed={course._id}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <GraduationCap className="size-10 text-brand-green" aria-hidden />
          </div>
        )}
      </div>

      <header className="space-y-2">
        <h1 className="text-xl font-bold text-foreground">{course.title}</h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {courseDurationText(course.durationHours, lang)}
          </span>
          <span>{t[formatLabelKey(course.format) as keyof typeof t]}</span>
          <span>{t[levelLabelKey(course.level) as keyof typeof t]}</span>
          <span>{t[languageLabelKey(course.language) as keyof typeof t]}</span>
          {course.format === "in_person" && course.wilaya !== undefined && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {wilayaName(course.wilaya, lang)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xl font-extrabold text-brand-green">
            <bdi dir="ltr">{coursePriceText(course.priceDa, lang)}</bdi>
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {course.startsAt !== undefined && (
              <span>
                {t.courseStartsAt}: <bdi>{formatDate(course.startsAt, lang)}</bdi>
              </span>
            )}
            {course.seats !== undefined && (
              <span>
                <bdi>{interpolate(t.seatsLeft, { n: course.seats })}</bdi>
              </span>
            )}
          </div>
        </div>

        {course.topics.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {course.topics.map((topic) => (
              <li
                key={topic}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {t[topic as keyof typeof t] ?? topic}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Outside-money notice: first thing under the price, always present. */}
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        {t.courseNotice}
      </p>

      <section aria-labelledby="course-description" className="space-y-2">
        <h2 id="course-description" className="text-sm font-bold text-foreground">
          {t.productDescription}
        </h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {course.description}
        </p>
      </section>

      {course.curriculum.length > 0 && (
        <section aria-labelledby="course-curriculum" className="space-y-2">
          <h2 id="course-curriculum" className="text-sm font-bold text-foreground">
            {t.courseCurriculum}
          </h2>
          <ol className="space-y-1.5">
            {course.curriculum.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-green" aria-hidden />
                <span className="text-foreground">{item}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ------------------------------------------------------ instructor */}
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-bold text-foreground">{t.courseInstructor}</h2>
        <div className="mt-3 flex items-start gap-3">
          <div className="size-12 shrink-0 overflow-hidden rounded-full bg-brand-green-tint">
            {instructor.photoStorageId ? (
              <StorageImage
                storageId={instructor.photoStorageId}
                alt={instructor.name}
                seed={instructor.id}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-sm font-bold text-brand-green">
                {instructor.name.slice(0, 1)}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
              <span className="truncate">{instructor.name}</span>
              {instructor.status === "approved" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-green-tint px-1.5 py-0.5 text-[10px] font-bold text-brand-green-dark">
                  <BadgeCheck className="size-3" aria-hidden />
                  {t.verifiedInstructor}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {wilayaName(instructor.wilaya, lang)}
              {course.rating !== null && (
                <>
                  {" · "}
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    <Star className="size-3 fill-current text-amber-500" aria-hidden />
                    <bdi>{course.rating}</bdi>
                  </span>
                </>
              )}
            </p>
            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
              {instructor.bio}
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {t.courseExternalContact}: <bdi>{course.externalContact}</bdi>
        </p>

        {isAuthenticated && data.contactE164 ? (
          <a
            href={whatsappUrl(
              data.contactE164,
              courseWhatsappMessage(course.title, lang),
            )}
            target="_blank"
            rel="noreferrer"
            className="tap-target mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-green px-4 text-sm font-semibold text-white"
          >
            <MessageCircle className="size-4" aria-hidden />
            {t.courseContact}
          </a>
        ) : (
          <div className="mt-3 rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">{t.enrollSignIn}</p>
            {/* `returnTo` brings the visitor back to *this* course after
                signing in, not to the grid. */}
            <Link
              to={`/auth?returnTo=${encodeURIComponent(`/courses/${course._id}`)}`}
              className="tap-target mt-2 inline-flex items-center justify-center rounded-lg border border-brand-green px-4 text-sm font-semibold text-brand-green"
            >
              {t.navLogin}
            </Link>
          </div>
        )}
      </section>

      {/* ----------------------------------------------- materials & codes */}
      {data.enrolled ? (
        <MaterialsSection courseId={course._id} />
      ) : (
        <EnrollBox courseId={course._id} acknowledged={data.acknowledged} />
      )}

      {/* -------------------------------------------------------- reviews */}
      <ReviewsSection
        courseId={course._id}
        canReview={data.canReview}
        enrolled={data.enrolled}
        alreadyReviewed={alreadyReviewed}
        ownerId={data.ownerId}
        reviews={reviews}
      />

      {/* ----------------------------------------------------- complaints */}
      <ComplaintForm
        targetType="course"
        targetId={String(course._id)}
        courseId={course._id}
        title={t.reportCourseTitle}
      />
      <ComplaintForm
        targetType="instructor"
        targetId={String(instructor.id)}
        courseId={course._id}
        title={t.reportInstructorTitle}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

function EnrollBox({
  courseId,
  acknowledged,
}: {
  courseId: string;
  acknowledged: boolean;
}) {
  const { t } = useLang();
  const { isAuthenticated } = useAuth();
  const acknowledge = useMutation(api.courses.acknowledge);
  const redeem = useMutation(api.courses.redeemCode);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAcknowledge = async () => {
    setBusy(true);
    try {
      await acknowledge({});
    } catch {
      setError(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await redeem({
        courseId: courseId as never,
        code,
        acknowledged: true,
      });
      setCode("");
      toast.success(t.enrollSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // `parseCourseLock` is the reader of the same constant the server writes.
      const lock = parseCourseLock(message);
      if (lock !== null) setError(interpolate(t.enrollTooMany, { minutes: lock }));
      else if (message === "errCodeRevoked") setError(t.enrollRevoked);
      else if (message === "errCodeExpired") setError(t.enrollExpired);
      else if (message === "errCodeUsedUp") setError(t.enrollUsedUp);
      else if (message === "errAckRequired") setError(t.ackTitle);
      else setError(t.enrollInvalid);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <KeyRound className="size-4 shrink-0 text-brand-green" aria-hidden />
        {t.enrollTitle}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.enrollHint}</p>

      {!isAuthenticated ? (
        // Nobody can be enrolled without an account, so the form would only
        // produce an "errNotSignedIn" toast. Offer the way in instead.
        <Link
          to={`/auth?returnTo=${encodeURIComponent(`/courses/${courseId}`)}`}
          className="tap-target mt-3 inline-flex w-full items-center justify-center rounded-lg border border-brand-green px-4 text-sm font-semibold text-brand-green"
        >
          {t.enrollSignIn}
        </Link>
      ) : !acknowledged ? (
        <div className="mt-3 rounded-lg bg-muted p-3">
          <p className="text-xs font-semibold text-foreground">{t.ackTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.ackBody}</p>
          <button
            type="button"
            onClick={() => void onAcknowledge()}
            disabled={busy}
            className="tap-target mt-3 inline-flex items-center justify-center rounded-lg bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t.ackAccept}
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t.enrollPlaceholder}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            className={cn(inputClass, "text-start font-mono tracking-widest")}
          />
          <button
            type="submit"
            disabled={busy || code.trim().length < 4}
            className="tap-target inline-flex w-full items-center justify-center rounded-lg bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t.enrollSubmit}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}

/** Private materials and announcements: enrolled students only. */
function MaterialsSection({ courseId }: { courseId: string }) {
  const { t, lang } = useLang();
  const materials = useAuthQuery(api.courses.materials, { courseId: courseId as never });
  const announcements = useQuery(api.courses.announcements, {
    courseId: courseId as never,
  });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-brand-green bg-brand-green-tint p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Check className="size-4 shrink-0 text-brand-green" aria-hidden />
          {t.enrollSuccess}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t.enrollHint}</p>
      </section>

      <section aria-labelledby="course-materials" className="space-y-2">
        <h2 id="course-materials" className="text-sm font-bold text-foreground">
          {t.materialsTitle}
        </h2>
        {materials === undefined ? (
          <div className="skeleton h-16 w-full rounded-lg" />
        ) : materials.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.materialsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {(materials as { _id: string; title: string; link: string; note?: string }[]).map(
              (row) => (
                <li key={row._id} className="rounded-lg border border-border p-3">
                  <a
                    href={row.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-brand-green hover:underline"
                  >
                    {row.title}
                  </a>
                  {row.note && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {row.note}
                    </p>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="course-announcements" className="space-y-2">
        <h2 id="course-announcements" className="text-sm font-bold text-foreground">
          {t.announcementsTitle}
        </h2>
        {announcements === undefined ? (
          <div className="skeleton h-16 w-full rounded-lg" />
        ) : announcements.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.announcementsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {announcements.map((row) => (
              <li key={row._id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-semibold text-foreground">{row.title}</p>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                  {row.body}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  <bdi>{formatRelativeTime(row.createdAt, lang)}</bdi>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

function ReviewsSection({
  courseId,
  canReview,
  enrolled,
  alreadyReviewed,
  ownerId,
  reviews,
}: {
  courseId: string;
  canReview: boolean;
  enrolled: boolean;
  alreadyReviewed: boolean;
  ownerId: string | null;
  reviews: {
    _id: string;
    userId: string;
    rating: number;
    comment: string;
    createdAt: number;
    instructorReply?: string;
  }[];
}) {
  const { t, lang } = useLang();
  const { isAuthenticated } = useAuth();
  const addReview = useMutation(api.courses.addReview);
  const replyToReview = useMutation(api.courses.replyToReview);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addReview({ courseId: courseId as never, rating, comment });
      setComment("");
      toast.success(t.reviewSubmitted);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "errReviewTooEarly") setError(t.reviewWait48);
      else if (message === "errReviewOnce") setError(t.reviewOnce);
      else if (message === "errNotEnrolled") setError(t.reviewNeedsEnrollment);
      else setError(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="course-reviews" className="space-y-3">
      <h2 id="course-reviews" className="text-sm font-bold text-foreground">
        {t.courseReviews}
      </h2>

      {reviews.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noReviews}</p>
      ) : (
        <ul className="space-y-2">
          {reviews.map((review) => (
            <li key={review._id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-0.5"
                  aria-label={`${review.rating}/5`}
                >
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
                </span>
                <span className="text-[11px] text-muted-foreground">
                  <bdi>{formatRelativeTime(review.createdAt, lang)}</bdi>
                </span>
              </div>

              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">
                {review.comment}
              </p>

              {review.instructorReply && (
                <div className="mt-2 rounded-lg bg-muted p-2">
                  <p className="text-[11px] font-semibold text-foreground">
                    {t.instructorReply}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {review.instructorReply}
                  </p>
                </div>
              )}

              {/* The instructor answers once, and only their own reviews. */}
              {ownerId !== null && !review.instructorReply && (
                <ReplyForm
                  busy={busy}
                  onReply={async (reply) => {
                    setBusy(true);
                    try {
                      await replyToReview({ reviewId: review._id as never, reply });
                      toast.success(t.replyForm);
                    } catch {
                      toast.error(t.errGeneric);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canReview ? (
        <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border p-3" noValidate>
          <p className="text-sm font-semibold text-foreground">{t.reviewFormTitle}</p>

          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setRating(step)}
                aria-label={`${step}/5`}
                aria-pressed={rating === step}
                className="tap-target inline-flex items-center justify-center"
              >
                <Star
                  className={cn(
                    "size-6",
                    step <= rating ? "fill-current text-amber-500" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t.reviewComment}
            rows={3}
            maxLength={800}
            className={cn(inputClass, "h-auto py-2")}
          />

          <button
            type="submit"
            disabled={busy || comment.trim().length < 3}
            className="tap-target inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Send className="size-4" aria-hidden />
            {t.reviewSubmit}
          </button>
        </form>
      ) : (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {!isAuthenticated
            ? t.enrollSignIn
            : !enrolled
              ? t.reviewNeedsEnrollment
              : alreadyReviewed
                ? t.reviewOnce
                : t.reviewWait48}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}

function ReplyForm({
  busy,
  onReply,
}: {
  busy: boolean;
  onReply: (reply: string) => Promise<void>;
}) {
  const { t } = useLang();
  const [reply, setReply] = useState("");
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onReply(reply);
        setReply("");
      }}
    >
      <label className="block">
        <span className="mb-1 block text-[11px] text-muted-foreground">{t.replyForm}</span>
        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          rows={2}
          maxLength={500}
          className={cn(inputClass, "h-auto py-2")}
        />
      </label>
      <button
        type="submit"
        disabled={busy || reply.trim().length < 2}
        className="tap-target inline-flex items-center justify-center rounded-lg border border-border px-3 text-xs disabled:opacity-60"
      >
        {t.replySubmit}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

const MAX_EVIDENCE = 3;

function ComplaintForm({
  targetType,
  targetId,
  courseId,
  title,
}: {
  targetType: "course" | "instructor";
  targetId: string;
  courseId: string;
  title: string;
}) {
  const { t } = useLang();
  const { isAuthenticated } = useAuth();
  const file = useMutation(api.storage.createImageUpload);
  const report = useMutation(api.courses.fileComplaint);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof COMPLAINT_REASONS)[number]>("scam");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!isAuthenticated) return null;

  const onPickEvidence = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_EVIDENCE - evidence.length;
    for (const item of Array.from(files).slice(0, room)) {
      const result = await uploadImage(item, "evidence", file);
      if (result.ok) setEvidence((prev) => [...prev, result.storageId]);
      else toast.error(t[result.error]);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await report({
        targetType,
        targetId,
        courseId: courseId as never,
        reason,
        description,
        evidenceStorageIds: evidence,
        code: code.trim() || undefined,
      });
      toast.success(t.reportSent);
      setOpen(false);
      setDescription("");
      setCode("");
      setEvidence([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // The server's rate-limit message carries no window (only the message
      // survives the wire), so the generic sentence is the honest one here.
      if (message === "errRateLimited") toast.error(t.errRateLimitedShort);
      else if (message === "errRequired") toast.error(t.errRequired);
      else toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="tap-target inline-flex items-center gap-2 text-sm font-semibold text-red-700"
      >
        <AlertTriangle className="size-4" aria-hidden />
        {title}
      </button>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">{t.reportReason}</span>
            <select
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as (typeof COMPLAINT_REASONS)[number])
              }
              className={inputClass}
            >
              {COMPLAINT_REASONS.map((key) => (
                <option key={key} value={key}>
                  {t[reasonLabelKey(key) as keyof typeof t]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t.reportDescription}
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              maxLength={800}
              required
              className={cn(inputClass, "h-auto py-2")}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">{t.reportCode}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              dir="ltr"
              autoComplete="off"
              className={cn(inputClass, "text-start font-mono tracking-widest")}
            />
          </label>

          <div>
            <span className="mb-1 block text-xs text-muted-foreground">{t.reportEvidence}</span>
            <div className="flex flex-wrap items-center gap-2">
              {evidence.map((storageId) => (
                <div
                  key={storageId}
                  className="relative size-16 overflow-hidden rounded-lg border border-border"
                >
                  <StorageImage storageId={storageId} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setEvidence((prev) => prev.filter((item) => item !== storageId))
                    }
                    className="absolute end-0 top-0 inline-flex size-5 items-center justify-center rounded-es bg-background/90"
                    aria-label={t.cancel}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </div>
              ))}
              {evidence.length < MAX_EVIDENCE && (
                <label className="tap-target inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground">
                  <ImageIcon className="size-4" aria-hidden />
                  {t.uploadEvidence}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(event) => void onPickEvidence(event.target.files)}
                  />
                </label>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || description.trim().length < 10}
            className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Upload className="size-4" aria-hidden />
            {t.reportSend}
          </button>
        </form>
      )}
    </section>
  );
}
