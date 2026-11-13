/**
 * App chrome: header, bottom navigation, language switcher, install prompt and
 * footer. Shared by every page so spacing and safe-area handling live once.
 */

import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
  Bell,
  CreditCard,
  Crown,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  Home,
  LayoutDashboard,
  Lock,
  Menu as MenuIcon,
  MessageCircle,
  Scale,
  Search,
  Shield,
  Store,
  User,
  X,
} from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLang } from "@/lib/lang";
import { useAuth } from "@/hooks/use-auth";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Logo, LogoWordmark } from "@/components/Logo";

function NavItem({
  to,
  icon: Icon,
  label,
  badge,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex h-full w-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-center transition-colors",
          isActive ? "text-[#006233] font-bold" : "text-neutral-500 font-medium hover:text-neutral-800",
        )
      }
    >
      <div className="relative flex items-center justify-center">
        <Icon className="size-5 shrink-0" aria-hidden />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1 -end-2.5 flex min-w-4 items-center justify-center rounded-full bg-[#006233] px-1 text-[9px] font-bold leading-4 text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <span className="w-full truncate px-0.5 text-center text-[11px] leading-tight tracking-tight">
        {label}
      </span>
    </NavLink>
  );
}

function HeaderNavItem({
  to,
  icon: Icon,
  label,
  end = false,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-xl text-[11px] transition-all",
          isActive
            ? "text-[#006233] bg-[#eef6f1] font-bold shadow-2xs"
            : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 font-medium",
        )
      }
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      <span className="leading-tight text-center whitespace-nowrap">{label}</span>
    </NavLink>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  usePageMeta();
  const { t, lang, setLang } = useLang();
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  // Phone-sized screens only reach the full site map through this drawer: the
  // bottom bar is capped at five items and the desktop links are hidden at md.
  const [menuOpen, setMenuOpen] = useState(false);

  // Unread count only matters for a signed-in user. `useAuthQuery` suspends the
  // request entirely while signed out, so this header (which renders on every
  // page, including the public landing page) can never fire an authenticated
  // query for a visitor with no session.
  const unread = useAuthQuery(
    api.notifications.unreadCount,
    {},
  );

  const isAdmin = user?.role === "admin";
  const isWholesaler = user?.role === "wholesaler";

  const menuLinks: { to: string; label: string; icon: typeof Home }[] = [
    { to: "/", label: t.navHome, icon: Home },
    { to: "/feed", label: t.navFeed, icon: Store },
    { to: "/search", label: t.navSearch, icon: Search },
    { to: "/vip", label: t.vipGroup, icon: Lock },
    { to: "/courses", label: t.navCourses, icon: GraduationCap },
    { to: "/favorites", label: t.navFavorites, icon: Heart },
    { to: "/compare", label: t.navCompare, icon: Scale },
    { to: "/quotes", label: t.navQuotes, icon: FileText },
    { to: "/messages", label: t.navMessages, icon: MessageCircle },
    { to: "/notifications", label: t.navNotifications, icon: Bell },
    ...(isAuthenticated ? [{ to: "/my-vip", label: t.vipMyTitle, icon: Crown }] : []),
    ...(isWholesaler
      ? [{ to: "/dashboard", label: t.navDashboard, icon: LayoutDashboard }]
      : []),
    ...(isWholesaler ? [{ to: "/dashboard/vip", label: t.vipOfferTitle, icon: Lock }] : []),
    ...(isAdmin ? [{ to: "/admin", label: t.adminTitle, icon: Shield }] : []),
    { to: "/account", label: t.navProfile, icon: User },
    { to: "/billing", label: t.dashBilling, icon: CreditCard },
  ];

  return (
    <div className="app-shell min-h-dvh bg-white">
      <header
        className="sticky top-0 z-[var(--z-header)] border-b border-[#e3e8e5] bg-white"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div
          className="mx-auto flex items-center gap-2 px-3 sm:gap-3 sm:px-4"
          style={{ height: "var(--header-height)", maxWidth: "1440px" }}
        >
          {/* Brand Logo & Name: always clearly visible in the top bar */}
          <Link
            to="/"
            className="flex min-w-0 shrink-0 items-center gap-2.5 transition-opacity hover:opacity-90"
            aria-label={t.brandName}
          >
            <Logo size="sm" label={null} />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-base font-black tracking-tight text-neutral-900 sm:text-lg">
                {t.brandName}
              </span>
              <span className="hidden truncate text-[10px] font-bold text-[#006233] sm:block">
                {t.brandTagline}
              </span>
            </div>
          </Link>

          <form action="/search" className="hidden flex-1 lg:block" role="search">
            <input
              type="search"
              name="q"
              inputMode="search"
              autoComplete="off"
              defaultValue={new URLSearchParams(location.search).get("q") ?? ""}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="h-10 w-full rounded-xl border border-border px-3 text-sm outline-none focus:border-brand-green"
            />
          </form>

          {/* Desktop primary links: icon on top, page name directly underneath */}
          <nav className="hidden shrink-0 items-center gap-1 lg:flex" aria-label={t.navHome}>
            <HeaderNavItem to="/" icon={Home} label={t.navHome} end />
            <HeaderNavItem to="/feed" icon={Store} label={t.navFeed} />
            <HeaderNavItem to="/courses" icon={GraduationCap} label={t.navCourses} />
            <HeaderNavItem to="/favorites" icon={Heart} label={t.navFavorites} />
            <HeaderNavItem to="/quotes" icon={FileText} label={t.navQuotes} />
            <HeaderNavItem to="/compare" icon={Scale} label={t.navCompare} />
            {isAdmin && (
              <HeaderNavItem to="/admin" icon={Shield} label={t.adminTitle} />
            )}
            {isWholesaler && (
              <HeaderNavItem to="/dashboard" icon={LayoutDashboard} label={t.navDashboard} />
            )}
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setLang(lang === "ar" ? "fr" : "ar")}
              className="tap-target flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-black hover:bg-[#eef6f1]"
              aria-label={lang === "ar" ? "Passer au français" : "التبديل إلى العربية"}
            >
              <Globe className="size-4" aria-hidden />
              {lang === "ar" ? "FR" : "ع"}
            </button>

            {isAuthenticated ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Link
                  to="/notifications"
                  className="tap-target relative hidden items-center justify-center rounded-lg hover:bg-[#eef6f1] lg:flex"
                  aria-label={t.navNotifications}
                >
                  <Bell className="size-5" aria-hidden />
                  {unread !== undefined && unread > 0 && (
                    <span className="absolute top-2 end-2 flex min-w-4 items-center justify-center rounded-full bg-[#006233] px-1 text-[9px] font-bold leading-4 text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </Link>
                <Link
                  to={isAdmin ? "/admin" : isWholesaler ? "/dashboard" : "/account"}
                  className="tap-target flex items-center gap-1.5 rounded-xl border border-[#dcefe4] bg-[#eef6f1] px-2 py-1.5 text-xs font-bold text-[#006233] transition-colors hover:bg-[#dcefe4] sm:gap-2 sm:px-3"
                  aria-label={t.navProfile}
                >
                  <User className="size-4 shrink-0" aria-hidden />
                  <span className="max-w-[78px] truncate sm:max-w-[130px]">
                    {user?.name ||
                      user?.ownerName ||
                      (isAdmin ? t.roleAdmin : isWholesaler ? t.roleWholesaler : t.navProfile)}
                  </span>
                </Link>
              </div>
            ) : (
              <Link
                to="/auth"
                className="tap-target inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[#006233] px-3 text-xs font-bold leading-none text-white shadow-xs transition-colors hover:bg-[#004d29] sm:px-4 sm:text-sm"
              >
                {t.navLogin}
              </Link>
            )}

            {/* The only entry to the rest of the site below `lg`. */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="tap-target flex items-center justify-center rounded-lg hover:bg-[#eef6f1] lg:hidden"
              aria-label={t.navMenu}
            >
              <MenuIcon className="size-5" aria-hidden />
            </button>
          </div>
        </div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent
            side={lang === "ar" ? "right" : "left"}
            className="w-[20rem] max-w-[88vw] gap-0 p-0"
          >
            <SheetHeader className="border-b border-[#e3e8e5] py-3 pe-4 ps-11">
              <SheetTitle className="text-base font-bold text-black flex items-center gap-2">
                <Logo size="xs" label={null} />
                <span>{t.navMenu}</span>
              </SheetTitle>
            </SheetHeader>
            <nav
              className="flex-1 overflow-y-auto p-3"
              aria-label={t.navMenu}
            >
              <div className="grid grid-cols-2 gap-2">
                {menuLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === "/"}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex flex-col items-center justify-center text-center gap-1.5 rounded-xl p-3 transition-all border",
                        isActive
                          ? "bg-[#eef6f1] text-[#006233] border-[#006233]/25 font-bold shadow-2xs"
                          : "text-neutral-700 hover:text-black hover:bg-neutral-50 border-neutral-100 font-medium",
                      )
                    }
                  >
                    <link.icon className="size-5 shrink-0 text-[#006233]" aria-hidden />
                    <span className="text-xs leading-tight text-center">{link.label}</span>
                  </NavLink>
                ))}
              </div>
            </nav>
          </SheetContent>
        </Sheet>

        {/* Mobile search sits below the header so it stays reachable at 320px.
            Hidden on the search page itself: the bottom nav already leads there,
            and two search fields stacked eat over a fifth of a 568px screen. */}
        <form
          action="/search"
          className={cn("px-4 pb-2 lg:hidden", location.pathname === "/search" && "hidden")}
          role="search"
        >
          <input
            type="search"
            name="q"
            inputMode="search"
            autoComplete="off"
            defaultValue={new URLSearchParams(location.search).get("q") ?? ""}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="h-11 w-full rounded-lg border border-[#e3e8e5] px-3 text-sm outline-none focus:border-[#006233]"
          />
        </form>
      </header>

      {/* tabIndex={-1} lets ScrollToTop move focus here on navigation
          without adding the landmark to the tab order. */}
      <main
        tabIndex={-1}
        className="mx-auto w-full px-(--page-gutter) py-4 outline-none"
        style={{ maxWidth: "1440px" }}
      >
        {children}
      </main>

      <InstallPrompt />

      <nav
        className="fixed inset-x-0 bottom-0 z-[var(--z-bottom-nav)] border-t border-[#e3e8e5] bg-white lg:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
        aria-label={t.navHome}
      >
        {/* grid-cols-5: equal, fixed tracks — a label can only ever truncate
            inside its own track, never widen the bar past the viewport. */}
        <div className="grid grid-cols-5" style={{ height: "var(--bottom-nav-height)" }}>
          <NavItem to="/" icon={Home} label={t.navHome} />
          <NavItem to="/search" icon={Search} label={t.navSearch} />
          {/* Courses replaces Favorites here: the bar is capped at five
              items, and Favourites stays one tap away in Account and Search. */}
          <NavItem to="/courses" icon={GraduationCap} label={t.navCourses} />
          <NavItem
            to="/notifications"
            icon={Bell}
            label={t.navNotifications}
            badge={unread ?? 0}
          />
          <NavItem to="/account" icon={User} label={t.navProfile} />
        </div>
      </nav>

      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PWA install prompt
// ---------------------------------------------------------------------------

const DISMISS_KEY = "tajirdz:install-dismissed";
const DISMISS_DAYS = 7;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Install banner, mobile only.
 *  - Android/Chrome: fires `beforeinstallprompt`; the button triggers it.
 *  - iOS: no such event, so we show the Share -> Add to Home Screen steps.
 * Hidden when already installed (display-mode: standalone) or when dismissed
 * within the last 7 days. Never shown on desktop.
 */
function isInstallEligible(): { isIOS: boolean } | null {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  if (isStandalone) return null;

  // Desktop already has its own install affordance.
  if (!window.matchMedia("(max-width: 1023px)").matches) return null;

  const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
  if (Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return null;

  return { isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) };
}

function InstallPrompt() {
  const { t, lang } = useLang();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Eligibility depends only on the environment, so it is resolved once at
  // mount rather than written back into state from an effect.
  const [eligible] = useState(isInstallEligible);

  useEffect(() => {
    if (!eligible) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [eligible]);

  const isIOS = eligible?.isIOS ?? false;
  // iOS never fires the event, so the card shows on its own there.
  const visible = !dismissed && (deferred !== null || isIOS);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setDismissed(true);
    else dismiss();
  };

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+12px)] z-50 rounded-xl border border-[#e3e8e5] bg-white p-4 lg:hidden"
      role="dialog"
      aria-label={t.brandName}
    >
      <div className="flex items-start gap-3">
        <Logo size="xs" label={null} className="mt-0.5" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-black">
            {lang === "ar" ? "ثبّت تطبيق TajirDz" : "Installer l'application TajirDz"}
          </p>
          {isIOS ? (
            <p className="mt-1 text-xs text-neutral-600">
              {lang === "ar" ? (
                <>
                  اضغط على زر المشاركة <ShareGlyph /> ثم «إضافة إلى الشاشة الرئيسية».
                </>
              ) : (
                <>
                  Appuyez sur Partager <ShareGlyph /> puis « Sur l'écran d'accueil ».
                </>
              )}
            </p>
          ) : (
            <p className="mt-1 text-xs text-neutral-600">
              {lang === "ar"
                ? "وصول أسرع للمنتجات اللي متابعينها، حتى بلا إنترنت."
                : "Accès plus rapide aux produits suivis, même hors connexion."}
            </p>
          )}
          {!isIOS && deferred && (
            <button
              onClick={install}
              className="mt-3 h-11 w-full rounded-lg bg-[#006233] text-sm font-semibold text-white"
            >
              {lang === "ar" ? "تثبيت" : "Installer"}
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label={t.cancel}
          className="p-1 text-neutral-500"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function ShareGlyph() {
  return (
    <span className="mx-0.5 inline-flex align-text-bottom">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3v12M12 3l-4 4M12 3l4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  const { t } = useLang();
  const links = [
    { to: "/courses", label: t.navCourses },
    { to: "/courses/policy", label: t.coursesPolicy },
    { to: "/how-it-works", label: t.footerHowItWorks },
    { to: "/faq", label: t.faq },
    { to: "/terms", label: t.footerTerms },
    { to: "/privacy", label: t.footerPrivacy },
    { to: "/refund", label: t.footerRefund },
    { to: "/report-scam", label: t.reportScam },
    { to: "/contact", label: t.contactSupport },
  ];

  return (
    <footer className="border-t border-[#e3e8e5] bg-[#eef6f1]/40 px-(--page-gutter) py-8">
      <div className="mx-auto" style={{ maxWidth: "1440px" }}>
        <LogoWordmark size="xs" name={t.brandName} nameClassName="text-sm" />
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-neutral-600">{t.disclaimer}</p>
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label={t.footerAbout}>
          {links.map((l) => (            <Link
              key={l.to}
              to={l.to}
              className="tap-target inline-flex items-center text-xs font-medium text-black hover:underline"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="mt-6 text-[11px] text-neutral-500">
          © <bdi>2026</bdi> TajirDz
        </p>
      </div>
    </footer>
  );
}