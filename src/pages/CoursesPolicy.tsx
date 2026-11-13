/**
 * Courses policy.
 *
 * Short by design: this is the page a disputing user gets linked to, so it has
 * to state three things without ambiguity — the platform is a listing service,
 * money changes hands outside it, and a complaint has a real consequence.
 */

import { Link } from "react-router";
import { AlertTriangle, BadgeCheck, GraduationCap, Scale, ShieldAlert } from "lucide-react";

import { useLang } from "@/lib/lang";
import { COMPLAINT_AUTO_HIDE_THRESHOLD } from "@/lib/courses";

export function CoursesPolicy() {
  const { t } = useLang();

  const tips = [t.scamTip1, t.scamTip2, t.scamTip3];
  const duties = [t.coursesPolicyDuty1, t.coursesPolicyDuty2, t.coursesPolicyDuty3];

  return (
    <article className="space-y-5">
      <Link
        to="/courses"
        className="inline-flex text-sm text-muted-foreground hover:text-brand-green"
      >
        {t.backToCourses}
      </Link>

      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <GraduationCap className="size-5 shrink-0 text-brand-green" aria-hidden />
          {t.coursesPolicy}
        </h1>
        <p className="text-sm leading-relaxed text-foreground">{t.coursesPolicyBody}</p>
      </header>

      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        {t.courseNotice}
      </p>

      <section aria-labelledby="policy-duties" className="space-y-2">
        <h2
          id="policy-duties"
          className="flex items-center gap-2 text-sm font-bold text-foreground"
        >
          <Scale className="size-4 shrink-0 text-brand-green" aria-hidden />
          {t.coursesPolicyDuties}
        </h2>
        <ul className="space-y-2">
          {duties.map((duty) => (
            <li key={duty} className="flex items-start gap-2 text-sm text-foreground">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-green" aria-hidden />
              <span className="leading-relaxed">{duty}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="policy-tips" className="space-y-2">
        <h2
          id="policy-tips"
          className="flex items-center gap-2 text-sm font-bold text-foreground"
        >
          <ShieldAlert className="size-4 shrink-0 text-brand-green" aria-hidden />
          {t.scamTipsTitle}
        </h2>
        <ul className="space-y-2">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-green" aria-hidden />
              <span className="leading-relaxed">{tip}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="policy-enforcement" className="space-y-2">
        <h2
          id="policy-enforcement"
          className="flex items-center gap-2 text-sm font-bold text-foreground"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-700" aria-hidden />
          {t.coursesPolicyEnforcement}
        </h2>
        <p className="text-sm leading-relaxed text-foreground">
          {t.coursesPolicyEnforcementBody.replace(
            "{n}",
            String(COMPLAINT_AUTO_HIDE_THRESHOLD),
          )}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/terms"
          className="tap-target inline-flex items-center rounded-lg border border-border px-4 text-sm"
        >
          {t.footerTerms}
        </Link>
        <Link
          to="/report-scam"
          className="tap-target inline-flex items-center rounded-lg border border-red-300 px-4 text-sm text-red-700"
        >
          {t.reportScam}
        </Link>
      </div>
    </article>
  );
}
