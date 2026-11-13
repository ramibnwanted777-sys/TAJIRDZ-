/**
 * 404.
 *
 * Rendered inside the app shell on most routes, so the layout keeps its own
 * full-height container: when it *is* the whole page (a deep link that missed)
 * it still fills the viewport and lands the message in the middle rather than
 * at the very top edge.
 */

import { Link } from "react-router";
import { Compass } from "lucide-react";

import { useLang } from "@/lib/lang";
import { BarePageLayout } from "@/components/BarePageLayout";

export default function NotFound() {
  const { t } = useLang();

  return (
    <BarePageLayout className="min-h-dvh">
      <div className="flex flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-brand-green-tint">
          <Compass className="size-6 text-brand-green" aria-hidden />
        </div>
        <p className="mt-4 text-4xl font-bold text-foreground">
          <bdi>404</bdi>
        </p>
        <h1 className="mt-2 text-lg font-semibold text-foreground">
          {t.notFoundTitle}
        </h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t.notFoundBody}</p>

        <div className="mt-6 flex w-full flex-col gap-2">
          <Link
            to="/"
            className="tap-target inline-flex w-full items-center justify-center rounded-lg bg-brand-green px-4 text-sm font-semibold text-white"
          >
            {t.navHome}
          </Link>
          <Link
            to="/courses"
            className="tap-target inline-flex w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground"
          >
            {t.navCourses}
          </Link>
        </div>
      </div>
    </BarePageLayout>
  );
}
