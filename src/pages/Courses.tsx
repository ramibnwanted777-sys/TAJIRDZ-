/**
 * Courses listing — the public grid.
 *
 * Filters live in the URL rather than in component state. Two reasons: a
 * filtered view can be shared or bookmarked, and the back button behaves the
 * way people expect when they open a course and return to the list.
 *
 * The server does the filtering (`api.courses.list`), so an empty grid always
 * means "nothing matched", never "the client forgot to apply a filter".
 */

import { Link, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { BadgeCheck, Clock, GraduationCap, MapPin, Search, Star, X } from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { interpolate } from "@/lib/i18n";
import { WILAYAS, formatRelativeTime, wilayaName } from "@/lib/catalog";
import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  COURSE_SORTS,
  COURSE_TOPICS,
  courseDurationText,
  coursePriceText,
  formatLabelKey,
  levelLabelKey,
  sortLabelKey,
} from "@/lib/courses";
import { StorageImage } from "@/components/StorageImage";
import { cn } from "@/lib/utils";

const selectClass =
  "tap-target w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-brand-green";

export function Courses() {
  const { t, lang } = useLang();
  const { isAuthenticated } = useAuth();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const topic = params.get("topic") ?? "";
  const level = params.get("level") ?? "";
  const format = params.get("format") ?? "";
  const wilaya = params.get("wilaya") ?? "";
  const verified = params.get("verified") === "1";
  const sort = (params.get("sort") ?? "newest") as (typeof COURSE_SORTS)[number];

  /** Patch the query string, dropping empty values so the URL stays readable. */
  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const courses = useQuery(api.courses.list, {
    q: q || undefined,
    topic: topic || undefined,
    level: (level || undefined) as (typeof COURSE_LEVELS)[number] | undefined,
    format: (format || undefined) as (typeof COURSE_FORMATS)[number] | undefined,
    wilaya: wilaya ? Number(wilaya) : undefined,
    verifiedOnly: verified || undefined,
    sort,
  });

  const filtersActive = Boolean(q || topic || level || format || wilaya || verified);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <GraduationCap className="size-5 shrink-0 text-brand-green" aria-hidden />
            {t.coursesTitle}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.coursesSubtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAuthenticated && (
            <>
              <Link
                to="/courses/mine"
                className="tap-target inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm text-foreground"
              >
                {t.navMyCourses}
              </Link>
              <Link
                to="/instructor"
                className="tap-target inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm text-foreground"
              >
                {t.navInstructor}
              </Link>
            </>
          )}
          <Link
            to="/courses/policy"
            className="tap-target inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm text-muted-foreground"
          >
            {t.coursesPolicy}
          </Link>
        </div>
      </header>

      {/* ------------------------------------------------------------ search */}
      <label className="relative block">
        <span className="sr-only">{t.coursesSearch}</span>
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          value={q}
          onChange={(event) => update({ q: event.target.value })}
          placeholder={t.coursesSearch}
          className="tap-target w-full rounded-lg border border-border bg-background ps-9 pe-3 text-sm outline-none focus:border-brand-green"
        />
      </label>

      {/* ----------------------------------------------------------- filters */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">{t.filterTopic}</span>
          <select
            className={selectClass}
            value={topic}
            onChange={(event) => update({ topic: event.target.value })}
          >
            <option value="">{t.filterAll}</option>
            {COURSE_TOPICS.map((key) => (
              <option key={key} value={key}>
                {t[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">{t.filterLevel}</span>
          <select
            className={selectClass}
            value={level}
            onChange={(event) => update({ level: event.target.value })}
          >
            <option value="">{t.filterAll}</option>
            {COURSE_LEVELS.map((key) => (
              <option key={key} value={key}>
                {t[levelLabelKey(key) as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">{t.filterFormat}</span>
          <select
            className={selectClass}
            value={format}
            onChange={(event) => update({ format: event.target.value })}
          >
            <option value="">{t.filterAll}</option>
            {COURSE_FORMATS.map((key) => (
              <option key={key} value={key}>
                {t[formatLabelKey(key) as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">{t.filterWilaya}</span>
          <select
            className={selectClass}
            value={wilaya}
            onChange={(event) => update({ wilaya: event.target.value })}
          >
            <option value="">{t.allWilayas}</option>
            {WILAYAS.map((row) => (
              <option key={row.code} value={String(row.code)}>
                {lang === "ar" ? row.ar : row.fr}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="tap-target inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm">
          <input
            type="checkbox"
            checked={verified}
            onChange={(event) => update({ verified: event.target.checked ? "1" : undefined })}
            className="size-4 accent-brand-green"
          />
          {t.filterVerifiedOnly}
        </label>

        <label className="tap-target inline-flex items-center gap-2 rounded-lg border border-border px-3 text-sm">
          <span className="text-muted-foreground">{t.sortLabel}</span>
          <select
            value={sort}
            onChange={(event) => update({ sort: event.target.value })}
            className="bg-transparent text-sm text-foreground outline-none"
          >
            {COURSE_SORTS.map((key) => (
              <option key={key} value={key}>
                {t[sortLabelKey(key) as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>

        {filtersActive && (
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="tap-target inline-flex items-center gap-1 rounded-lg border border-border px-3 text-sm text-muted-foreground"
          >
            <X className="size-4" aria-hidden />
            {t.filterReset}
          </button>
        )}

        {courses !== undefined && courses.length > 0 && (
          <p className="ms-auto text-xs text-muted-foreground">
            {interpolate(t.coursesCount, { n: courses.length })}
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------- grid */}
      {courses === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <div key={key} className="overflow-hidden rounded-lg border border-border">
              <div className="skeleton aspect-video w-full" />
              <div className="space-y-2 p-3">
                <div className="skeleton h-4 w-3/4 rounded" />
                <div className="skeleton h-3 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <GraduationCap className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-foreground">{t.coursesEmpty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.coursesEmptyHint}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course._id}>
              <Link
                to={`/courses/${course._id}`}
                className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-brand-green"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-brand-green-tint">
                  {course.coverStorageId ? (
                    <StorageImage
                      storageId={course.coverStorageId}
                      alt={course.title}
                      seed={course._id}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <GraduationCap className="size-8 text-brand-green" aria-hidden />
                    </div>
                  )}
                  <span className="absolute start-2 top-2 inline-flex items-center rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-semibold text-brand-green">
                    <bdi dir="ltr">{coursePriceText(course.priceDa, lang)}</bdi>
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-3">
                  <h2 className="line-clamp-2 text-sm font-bold text-foreground">
                    {course.title}
                  </h2>

                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <BadgeCheck
                      className={cn(
                        "size-3.5 shrink-0",
                        course.instructorVerified ? "text-brand-green" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{course.instructorName}</span>
                    {course.instructorVerified && (
                      <span className="sr-only">{t.verifiedInstructor}</span>
                    )}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {course.rating !== null && (
                      <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                        <Star className="size-3 fill-current text-amber-500" aria-hidden />
                        <bdi>{course.rating}</bdi>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" aria-hidden />
                      {courseDurationText(course.durationHours, lang)}
                    </span>
                    <span>{t[formatLabelKey(course.format) as keyof typeof t]}</span>
                    {course.format === "in_person" && course.wilaya !== undefined && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden />
                        {wilayaName(course.wilaya, lang)}
                      </span>
                    )}
                  </div>

                  <p className="mt-auto pt-2 text-[11px] text-muted-foreground">
                    <bdi>{formatRelativeTime(course.createdAt, lang)}</bdi>
                    {course.seats !== undefined && (
                      <>
                        {" · "}
                        <bdi>{interpolate(t.seatsLeft, { n: course.seats })}</bdi>
                      </>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* The platform never handles the money, so the disclaimer is on the
          listing too — not only inside a course. */}
      <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        {t.courseNotice}
      </p>
    </div>
  );
}
