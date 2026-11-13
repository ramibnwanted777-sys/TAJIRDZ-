/**
 * Private account page: the signed-in user's own profile, subscription state
 * and quick links. Retailers only ever see their own number here.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useAction } from "convex/react";
import { Bell, Heart, MessageCircle, FileText, CreditCard, LogOut, Globe, ShieldCheck } from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { authErrorText } from "@/lib/authErrors";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/convex/lib/security";
import { PasswordStrength } from "@/components/PasswordStrength";
import { toast } from "sonner";
import {
  CATEGORIES,
  STORE_TYPES,
  formatDate,
  formatPhoneInternational,
  wilayaName,
} from "@/lib/catalog";

export function Account() {
  const { t, lang } = useLang();
  const { user, signOut, isLoading } = useAuth();
  const sub = useAuthQuery(
    api.billing.mySubscription, {});
  const favorites = useAuthQuery(
    api.notifications.myFavorites, {});
  const threads = useAuthQuery(
    api.contact.myThreads, {});
  const passwordState = useAuthQuery(api.account.passwordStatus, {});

  if (isLoading || !user) {
    return <div className="skeleton h-32 rounded-lg bg-neutral-100" />;
  }

  const links = [
    { to: "/favorites", label: t.navFavorites, icon: Heart },
    { to: "/messages", label: t.navMessages, icon: MessageCircle },
    { to: "/quotes", label: t.navQuotes, icon: FileText },
    { to: "/notifications", label: t.navNotifications, icon: Bell },
    { to: "/billing", label: t.dashBilling, icon: CreditCard },
    // Admin-only, so it is listed last and never rendered for anyone else.
    ...(user.role === "admin"
      ? [{ to: "/admin", label: t.navAdmin, icon: ShieldCheck }]
      : []),
  ];

  const storeType = STORE_TYPES.find((s) => s.key === user.storeType);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-black">{t.navProfile}</h1>

      <section className="rounded-lg border border-[#e3e8e5] p-4">
        <p className="text-base font-semibold text-black">{user.name ?? "—"}</p>
        <p className="text-xs text-neutral-600">
          <bdi dir="ltr">{user.email ?? "—"}</bdi>
        </p>

        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-neutral-600">{lang === "ar" ? "النوع" : "Type"}</dt>
            <dd className="font-medium text-black">
              {user.role === "wholesaler"
                ? t.roleWholesaler
                : user.role === "admin"
                  ? t.roleAdmin
                  : t.roleRetailer}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-neutral-600">{t.filterWilaya}</dt>
            <dd className="font-medium text-black">
              {user.wilaya ? wilayaName(user.wilaya, lang) : "—"}
            </dd>
          </div>
          {/* Own number is visible to its owner; never exposed publicly. */}
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-neutral-600">{t.whatsapp}</dt>
            <dd className="font-medium text-black">
              <bdi dir="ltr">
                {user.whatsappE164 ? formatPhoneInternational(user.whatsappE164) : "—"}
              </bdi>
            </dd>
          </div>
          {storeType && (
            <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
              <dt className="text-neutral-600">{t.storeType}</dt>
              <dd className="font-medium text-black">
                {lang === "ar" ? storeType.ar : storeType.fr}
              </dd>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-neutral-600">{t.sellerSince}</dt>
            <dd className="font-medium text-black">
              {/* A session-only profile has no creation time: the label is
                  omitted rather than filled with today's date. */}
              <bdi>
                {user._creationTime ? formatDate(user._creationTime, lang) : "—"}
              </bdi>
            </dd>
          </div>
        </dl>

        {user.niches && user.niches.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {user.niches.map((key: string) => {
              const category = CATEGORIES.find((c) => c.key === key);
              return category ? (
                <Link
                  key={key}
                  to={`/search?category=${key}`}
                  className="rounded-full border border-[#e3e8e5] px-3 py-1 text-xs text-neutral-700 hover:border-[#006233]"
                >
                  {lang === "ar" ? category.ar : category.fr}
                </Link>
              ) : null;
            })}
          </div>
        )}
      </section>

      {/* Subscription state, stated plainly. */}
      <section
        className={`rounded-lg border p-4 ${
          sub?.isActive ? "border-[#006233] bg-[#eef6f1]" : "border-[#e3e8e5]"
        }`}
      >
        <p className="text-sm font-semibold text-black">
          {sub?.isActive ? t.subscriptionActive : t.subscriptionInactive}
        </p>
        {sub?.isActive && sub.expiresAt && (
          <p className="mt-0.5 text-xs text-neutral-700">
            {t.expiresOn} <bdi>{formatDate(sub.expiresAt, lang)}</bdi>
          </p>
        )}
        {!sub?.isActive && (
          <p className="mt-1 text-xs text-neutral-600">{t.contactLockedBody}</p>
        )}
        <Link
          to="/billing"
          className="tap-target mt-3 flex w-full items-center justify-center rounded-lg bg-[#006233] px-4 text-center text-sm font-semibold text-white sm:inline-flex sm:w-auto"
        >
          {t.billingTitle}
        </Link>
      </section>

      <nav className="grid gap-2 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="tap-target flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-[#e3e8e5] px-3 py-3 text-center text-sm"
          >
            <link.icon className="size-5 shrink-0 text-[#006233]" aria-hidden />
            <span className="text-balance w-full leading-tight line-clamp-2">
              {link.label}
            </span>
          </Link>
        ))}
      </nav>

      <p className="text-xs text-neutral-500">
        {favorites?.length ?? 0} · {threads?.length ?? 0}
      </p>

      <PasswordSection hasPassword={passwordState?.hasPassword ?? false} />

      <button
        onClick={signOut}
        className="tap-target flex items-center gap-2 rounded-lg border border-[#e3e8e5] px-4 text-sm"
      >
        <LogOut className="size-4" aria-hidden />
        {t.navLogout}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Change (or set) the password of the signed-in account.
 *
 * An account created with a one-time code has no password; the same form then
 * creates one, because the current-password field doubles as proof that the
 * person asking is the one who made the account.
 */
function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useLang();
  const changePassword = useAction(api.account.changePassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (hasPassword && !current) {
      setError(t.authCurrentPassword);
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(t.errPasswordTooShort);
      return;
    }
    if (passwordStrength(next).problems.length > 0) {
      setError(t.errPasswordTooWeak);
      return;
    }
    if (next !== confirm) {
      setError(t.authPasswordMismatch);
      return;
    }
    if (next === current) {
      setError(t.errPasswordTooWeak);
      return;
    }

    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t.accountPasswordChanged);
    } catch (err) {
      // One generic sentence for a wrong current password and anything else:
      // the same rule the sign-in form follows.
      setError(authErrorText(err, t, t.authInvalidCredentials));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-[#e3e8e5] p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-black">
        <ShieldCheck className="size-4 shrink-0 text-[#006233]" aria-hidden />
        {hasPassword ? t.accountChangePassword : t.accountSetPassword}
      </h2>
      {!hasPassword && (
        <p className="mt-1 text-xs leading-relaxed text-neutral-600">{t.accountNoPassword}</p>
      )}

      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <PasswordInput
          id="account-current-password"
          label={hasPassword ? t.authCurrentPassword : t.authPassword}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          visible={show}
        />
        <PasswordInput
          id="account-new-password"
          label={t.authNewPassword}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          visible={show}
        />
        <PasswordStrength password={next} />
        <PasswordInput
          id="account-confirm-password"
          label={t.authConfirmPassword}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          visible={show}
        />

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="tap-target inline-flex items-center justify-center rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {hasPassword ? t.accountChangePassword : t.accountSetPassword}
          </button>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-pressed={show}
            className="tap-target rounded-lg border border-[#e3e8e5] px-4 text-sm"
          >
            {show ? t.authHidePassword : t.authShowPassword}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  visible,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  visible: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={id}
        type={visible ? "text" : "password"}
        dir="ltr"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-start text-sm outline-none focus:border-[#006233]"
      />
    </div>
  );
}

export { Globe };