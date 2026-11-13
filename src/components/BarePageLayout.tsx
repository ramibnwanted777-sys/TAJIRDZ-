/**
 * Layout for full-screen pages that render without the app header.
 *
 * The auth screens, onboarding, 404 and the error fallback used to be plain
 * blocks, which is why the logo sat against the top edge on a phone: nothing
 * reserved any space above them. This wrapper is the single answer, so the
 * spacing rule exists once instead of once per screen.
 *
 * Spacing contract:
 *  - top padding is `max(2rem, safe-area + 1.5rem)` on phones and `3rem` from
 *    `md`, so a notched device never starts the logo under the sensor housing
 *    while a desktop screen still gets breathing room;
 *  - the content block is vertically centred on tall screens (`min-h-dvh` with
 *    `justify-center`) but the top padding is *outside* the centred block, so
 *    a form taller than the viewport is never clipped at the top;
 *  - the page gutter and bottom safe-area token come from `src/index.css`, so
 *    the block never hides behind the home indicator.
 *
 * `children` are rendered inside a `max-w-lg` column, which is the reading
 * width every one of these screens already assumed.
 */

import { cn } from "@/lib/utils";
import { usePageMeta } from "@/hooks/use-page-meta";

export function BarePageLayout({
  children,
  className,
  header,
  footer,
  role,
}: {
  children: React.ReactNode;
  className?: string;
  /** Slot above the content: logo + heading, already spaced. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Forwarded for the error fallback, which announces itself as an alert. */
  role?: string;
}) {
  // Auth, onboarding and the 404 render without AppShell, so the tab metadata
  // is pinned here too — every route goes through one of the two layouts.
  usePageMeta();

  return (
    <div
      role={role}
      // `.bare-page-top` holds the max(2rem, safe-area + 1.5rem) rule so the
      // spacing contract lives in the stylesheet next to the other tokens.
      className={cn("min-h-dvh bare-page-top bg-background", className)}
      style={{ paddingBottom: "calc(var(--safe-bottom) + var(--page-gutter))" }}
    >
      <div
        className="mx-auto flex min-h-dvh w-full flex-col justify-center px-4 md:justify-start"
        style={{ maxWidth: "32rem" }}
      >
        <div className="pt-0 pb-4 md:pt-8">{header}</div>
        {children}
        {footer && <div className="pt-4">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Brand head used at the top of the auth flow.
 *
 * The mark is `md` from the logo scale (56px) and the gap before the heading
 * is the page gutter, so the head cannot drift out of step with the rest of
 * the app.
 */
export function BarePageHeader({
  mark,
  title,
  subtitle,
}: {
  mark?: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {mark}
      <h1 className="mt-4 text-xl font-bold text-foreground">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
