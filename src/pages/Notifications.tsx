/**
 * In-app notification centre with per-type preferences.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "convex/react";
import { Bell, Check } from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { formatRelativeTime } from "@/lib/catalog";
import { EmptyState } from "@/components/marketplace";

const ALL_TYPES = [
  "message",
  "quote_reply",
  "review",
  "price_drop",
  "restock",
  "subscription_expiring",
  "payment_approved",
  "payment_rejected",
  "verification",
  "announcement",
];

export function Notifications() {
  const { t, lang } = useLang();
  const notifications = useAuthQuery(
    api.notifications.myNotifications, {});
  const prefs = useAuthQuery(
    api.notifications.myPrefs, {});
  const markAll = useMutation(api.notifications.markAllRead);
  const markRead = useMutation(api.notifications.markRead);
  const savePrefs = useMutation(api.notifications.savePrefs);
  const [showPrefs, setShowPrefs] = useState(false);

  if (notifications === undefined) {
    return <div className="skeleton h-32 rounded-lg bg-neutral-100" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-black">{t.notificationsTitle}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPrefs((v) => !v)}
            className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs"
          >
            {lang === "ar" ? "التفضيلات" : "Préférences"}
          </button>
          <button
            onClick={() => markAll()}
            className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs"
          >
            {t.markAllRead}
          </button>
        </div>
      </div>

      {showPrefs && prefs && (
        <section className="rounded-lg border border-[#e3e8e5] p-4">
          <h2 className="text-sm font-bold text-black">
            {lang === "ar" ? "اختر الإشعارات" : "Choisir les notifications"}
          </h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ALL_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={prefs.types.length === 0 || prefs.types.includes(type)}
                  onChange={(e) => {
                    const current =
                      prefs.types.length === 0 ? [...ALL_TYPES] : [...prefs.types];
                    const next = e.target.checked
                      ? current.filter((x) => x !== type).concat(type)
                      : current.filter((x) => x !== type);
                    void savePrefs({
                      types: next,
                      inApp: prefs.inApp,
                      push: prefs.push,
                      email: prefs.email,
                    });
                  }}
                />
                {type}
              </label>
            ))}
          </div>
        </section>
      )}

      {notifications.length === 0 ? (
        <EmptyState title={t.noNotifications} />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const body = (
              <div className="flex items-start gap-3">
                <Bell
                  className={`mt-0.5 size-4 shrink-0 ${
                    n.readAt ? "text-neutral-400" : "text-[#006233]"
                  }`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${n.readAt ? "text-neutral-600" : "font-semibold text-black"}`}
                  >
                    {n.title}
                  </p>
                  <p className="text-xs text-neutral-600">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    {formatRelativeTime(n.createdAt, lang)}
                  </p>
                </div>
                {n.readAt ? (
                  <Check className="size-4 text-neutral-300" aria-hidden />
                ) : (
                  <button
                    onClick={() => markRead({ notificationId: n.id })}
                    aria-label={t.markAllRead}
                    className="tap-target rounded-lg border border-[#e3e8e5] px-2 text-[10px]"
                  >
                    <Check className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            );
            return (
              <li key={n.id} className="rounded-lg border border-[#e3e8e5] p-3">
                {n.link ? (
                  <Link to={n.link} onClick={() => !n.readAt && markRead({ notificationId: n.id })}>
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}