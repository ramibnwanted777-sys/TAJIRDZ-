import "@vly-ai/integrations";
import { Toaster } from "@/components/ui/sonner";
import { AuthWall } from "@/components/AuthWall";
import {
  capturePageview,
  identifyUser,
  initAnalytics,
  resetAnalytics,
} from "@/lib/analytics";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireAdmin } from "@/components/RequireAdmin";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ScrollToTop } from "@/components/ScrollToTop";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createLocalConvexClient } from "@/lib/localConvexClient";
import React, { StrictMode, useEffect, useRef, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

import { AppShell } from "@/components/AppShell";
import { LanguageProvider } from "@/lib/lang";
import { useAuth } from "@/hooks/use-auth";

const Landing = lazy(() => import("@/pages/Landing").then((m) => ({ default: m.Landing })));
const Feed = lazy(() => import("@/pages/Feed").then((m) => ({ default: m.Feed })));
const SearchPage = lazy(() => import("@/pages/Search").then((m) => ({ default: m.Search })));
const ProductPage = lazy(() =>
  import("@/pages/ProductPage").then((m) => ({ default: m.ProductPage })),
);
const Shop = lazy(() => import("@/pages/Shop").then((m) => ({ default: m.Shop })));
const AuthPage = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.Auth })));
const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Billing = lazy(() => import("@/pages/Billing").then((m) => ({ default: m.Billing })));
const Favorites = lazy(() =>
  import("@/pages/Favorites").then((m) => ({ default: m.Favorites })),
);
const Notifications = lazy(() =>
  import("@/pages/Notifications").then((m) => ({ default: m.Notifications })),
);
const Quotes = lazy(() => import("@/pages/Quotes").then((m) => ({ default: m.Quotes })));
const Messages = lazy(() => import("@/pages/Messages").then((m) => ({ default: m.Messages })));
const Compare = lazy(() => import("@/pages/Compare").then((m) => ({ default: m.Compare })));
const Account = lazy(() => import("@/pages/Account").then((m) => ({ default: m.Account })));
const Admin = lazy(() => import("@/pages/Admin").then((m) => ({ default: m.Admin })));
const Courses = lazy(() => import("@/pages/Courses").then((m) => ({ default: m.Courses })));
const CourseDetail = lazy(() =>
  import("@/pages/CourseDetail").then((m) => ({ default: m.CourseDetail })),
);
const MyCourses = lazy(() => import("@/pages/MyCourses").then((m) => ({ default: m.MyCourses })));
const Instructor = lazy(() =>
  import("@/pages/Instructor").then((m) => ({ default: m.Instructor })),
);
const CoursesPolicy = lazy(() =>
  import("@/pages/CoursesPolicy").then((m) => ({ default: m.CoursesPolicy })),
);
const Legal = lazy(() => import("@/pages/Legal").then((m) => ({ default: m.Legal })));
const VipTeaser = lazy(() =>
  import("@/pages/VipTeaser").then((m) => ({ default: m.VipTeaser })),
);
const VipGuide = lazy(() =>
  import("@/pages/VipGuide").then((m) => ({ default: m.VipGuide })),
);
const MyVip = lazy(() => import("@/pages/MyVip").then((m) => ({ default: m.MyVip })));
const NotFound = lazy(() => import("@/pages/NotFound"));

function RouteLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary so a toolbar crash never blanks the preview. */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/**
 * Hard guard so a runtime error never leaves the preview as a blank page.
 *
 * `AppErrorBoundary` carries its own copy rather than reading the language
 * context, so it still renders a usable screen if the providers below it are
 * what threw.
 */
class RootErrorBoundary extends React.Component<{ children: React.ReactNode }> {
  render() {
    return <AppErrorBoundary>{this.props.children}</AppErrorBoundary>;
  }
}

const remoteConvexUrl = (
  import.meta.env.VITE_CONVEX_URL as string | undefined
)?.trim();
const isRemoteConvex = Boolean(remoteConvexUrl);
const convex = isRemoteConvex
  ? new ConvexReactClient(remoteConvexUrl!)
  : (createLocalConvexClient() as unknown as ConvexReactClient);

function AppProviders({ children }: { children: React.ReactNode }) {
  if (isRemoteConvex) {
    return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}

/**
 * Ties analytics events to the signed-in account, and forgets it on sign-out.
 *
 * The id is used, never the e-mail address, and nothing is sent when no
 * project key is configured (see `lib/analytics`).
 */
function AnalyticsIdentity() {
  const { user } = useAuth();
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const id = user?._id ?? null;
    if (id && id !== seen.current) {
      identifyUser(id, { role: user?.role });
      seen.current = id;
    } else if (!id && seen.current) {
      resetAnalytics();
      seen.current = null;
    }
  }, [user?._id, user?.role]);

  return null;
}

/** Keeps the host preview iframe in sync with client-side navigation. */
function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );

    // One pageview per navigation, sent by the router so a client-side route
    // change counts exactly once.
    capturePageview(`${location.pathname}${location.search}`);
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

/**
 * Register the service worker in production builds only. The Freebuff dev
 * server must never serve a cached shell, or edits would appear to do nothing.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a progressive enhancement; ignore failures.
    });
  });
}

// Starts PostHog when VITE_POSTHOG_KEY is configured; a no-op otherwise.
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <AppProviders>
        <LanguageProvider>
          <BrowserRouter>
            <RouteSyncer />
            <AnalyticsIdentity />
            {/* Rewind the window and any inner scroll panes on navigation. */}
            <ScrollToTop />
            <Suspense fallback={<RouteLoading />}>
              {/* Sign-in is the entry point: every screen below is behind the
                  wall except `/auth` and the legal/help pages. */}
              <AuthWall>
              <Routes>
                {/* Public marketplace */}
                <Route path="/" element={<AppShell><Landing /></AppShell>} />
                <Route path="/feed" element={<AppShell><Feed /></AppShell>} />
                <Route path="/search" element={<AppShell><SearchPage /></AppShell>} />
                <Route
                  path="/product/:slug"
                  element={<AppShell><ProductPage /></AppShell>}
                />
                {/* VIP: the guide and the teaser are public and unlinked from
                    the sitemap; the request list is a private screen. */}
                <Route path="/vip" element={<AppShell><VipGuide /></AppShell>} />
                <Route path="/vip/:slug" element={<AppShell><VipTeaser /></AppShell>} />
                <Route
                  path="/my-vip"
                  element={
                    <RequireAuth>
                      <AppShell><MyVip /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route path="/shop/:slug" element={<AppShell><Shop /></AppShell>} />
                {/* Favourites reads signed-in data, so it must be behind
                    RequireAuth like every other private screen. */}
                <Route
                  path="/favorites"
                  element={
                    <RequireAuth>
                      <AppShell><Favorites /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route path="/compare" element={<AppShell><Compare /></AppShell>} />

                {/* Legal / static */}
                <Route path="/how-it-works" element={<AppShell><Legal page="how" /></AppShell>} />
                <Route path="/faq" element={<AppShell><Legal page="faq" /></AppShell>} />
                <Route path="/terms" element={<AppShell><Legal page="terms" /></AppShell>} />
                <Route path="/privacy" element={<AppShell><Legal page="privacy" /></AppShell>} />
                <Route path="/refund" element={<AppShell><Legal page="refund" /></AppShell>} />
                <Route path="/report-scam" element={<AppShell><Legal page="scam" /></AppShell>} />
                <Route path="/contact" element={<AppShell><Legal page="contact" /></AppShell>} />

                {/* Courses: static slugs must precede `:id` or they never match. */}
                <Route
                  path="/courses"
                  element={<AppShell><Courses /></AppShell>}
                />
                <Route
                  path="/courses/policy"
                  element={<AppShell><CoursesPolicy /></AppShell>}
                />
                <Route
                  path="/courses/mine"
                  element={
                    <RequireAuth>
                      <AppShell><MyCourses /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/courses/:id"
                  element={<AppShell><CourseDetail /></AppShell>}
                />
                <Route
                  path="/instructor"
                  element={
                    <RequireAuth>
                      <AppShell><Instructor /></AppShell>
                    </RequireAuth>
                  }
                />

                {/* Auth: authenticated users land in the product experience */}
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/" />}
                />

                {/* Retailer */}
                <Route
                  path="/notifications"
                  element={
                    <RequireAuth>
                      <AppShell><Notifications /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/messages"
                  element={
                    <RequireAuth>
                      <AppShell><Messages /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/messages/:threadId"
                  element={
                    <RequireAuth>
                      <AppShell><Messages /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/quotes"
                  element={
                    <RequireAuth>
                      <AppShell><Quotes /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/account"
                  element={
                    <RequireAuth>
                      <AppShell><Account /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/billing"
                  element={
                    <RequireAuth>
                      <AppShell><Billing /></AppShell>
                    </RequireAuth>
                  }
                />

                {/* Wholesaler */}
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth>
                      <AppShell><Dashboard /></AppShell>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/dashboard/:tab"
                  element={
                    <RequireAuth>
                      <AppShell><Dashboard /></AppShell>
                    </RequireAuth>
                  }
                />

                {/* Admin: signed-out -> sign-in block, signed-in non-admin -> 403 */}
                <Route
                  path="/admin"
                  element={
                    <RequireAdmin>
                      <AppShell><Admin /></AppShell>
                    </RequireAdmin>
                  }
                />
                <Route
                  path="/admin/:tab"
                  element={
                    <RequireAdmin>
                      <AppShell><Admin /></AppShell>
                    </RequireAdmin>
                  }
                />

                <Route
                  path="*"
                  element={<AppShell><NotFound /></AppShell>}
                />
              </Routes>
              </AuthWall>
            </Suspense>
          </BrowserRouter>
        </LanguageProvider>
        <Toaster />
      </AppProviders>
    </RootErrorBoundary>
  </StrictMode>,
);