import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { BarePageLayout } from "@/components/BarePageLayout";
import { useAuth } from "@/hooks/use-auth";

/**
 * Site-wide sign-in gate.
 *
 * Sign-in is the entry point of the product now: every screen except the
 * sign-in page itself and the legal/help pages redirects a signed-out visitor
 * to `/auth`, carrying the page they asked for so they land back on it.
 *
 * The legal and help pages stay public on purpose — terms, privacy and the
 * scam-report form have to be readable by someone who has not created an
 * account yet, and by anyone verifying the marketplace before signing up.
 */
const PUBLIC_PATHS = [
  "/auth",
  "/terms",
  "/privacy",
  "/refund",
  "/contact",
  "/faq",
  "/how-it-works",
  "/report-scam",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function AuthWall({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isPublicPath(location.pathname)) return <>{children}</>;

  if (isLoading) {
    return (
      <BarePageLayout>
        <div className="flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </BarePageLayout>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}
