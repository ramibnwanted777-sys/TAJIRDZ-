/**
 * "My courses" — every course the signed-in user redeemed a code for.
 *
 * A read-only list on purpose: the useful action here is opening the course,
 * where the private materials and announcements live.
 */

import { Link } from "react-router";
import { GraduationCap } from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/catalog";
import { coursePriceText, courseStatusLabelKey } from "@/lib/courses";
import { StorageImage } from "@/components/StorageImage";

export function MyCourses() {
  const { t, lang } = useLang();
  const enrollments = useAuthQuery(api.courses.myEnrollments, {});

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <GraduationCap className="size-5 shrink-0 text-brand-green" aria-hidden />
          {t.myCoursesTitle}
        </h1>
        <Link
          to="/courses"
          className="tap-target inline-flex items-center rounded-lg border border-border px-3 text-sm"
        >
          {t.coursesTitle}
        </Link>
      </header>

      {enrollments === undefined ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <div key={key} className="skeleton h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : enrollments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <GraduationCap className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-foreground">{t.myCoursesEmpty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.enrollHint}</p>
          <Link
            to="/courses"
            className="tap-target mt-4 inline-flex items-center rounded-lg bg-brand-green px-4 text-sm font-semibold text-white"
          >
            {t.coursesTitle}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {enrollments.map((row) => {
            const course = row.course;
            return (
              <li key={String(row.enrollment._id)}>
                <Link
                  to={`/courses/${course.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-brand-green"
                >
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-brand-green-tint">
                    {course.coverStorageId ? (
                      <StorageImage
                        storageId={course.coverStorageId}
                        alt={course.title}
                        seed={String(course.id)}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <GraduationCap className="size-6 text-brand-green" aria-hidden />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">
                      {course.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {t.courseInstructor}: {row.instructorName}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-semibold text-brand-green">
                        <bdi dir="ltr">{coursePriceText(course.priceDa, lang)}</bdi>
                      </span>
                      <span>
                        {t[courseStatusLabelKey(course.status) as keyof typeof t]}
                      </span>
                      {course.startsAt !== undefined && (
                        <span>
                          {t.courseStartsAt}: <bdi>{formatDate(course.startsAt, lang)}</bdi>
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        {t.courseNotice}
      </p>
    </div>
  );
}
