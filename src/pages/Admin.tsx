/**
 * Admin panel: KPIs, moderation queues and exportable tables.
 * Every tab reads from an admin-gated Convex query; the UI is a convenience,
 * not the security boundary.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation } from "convex/react";
import { Check, X, Download, Star } from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, formatDinar, formatDate, formatNumber } from "@/lib/catalog";
import { AdminCourses } from "@/components/AdminCourses";
import { AdminPricing } from "@/components/AdminPricing";
import { AdminCategories } from "@/components/AdminCategories";
import { AdminAdmins } from "@/components/AdminAdmins";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Tab =
  | "kpis"
  | "admins"
  | "users"
  | "payments"
  | "verifications"
  | "reviews"
  | "reports"
  | "vip"
  | "promos"
  | "courses"
  | "categories"
  | "pricing"
  | "audit";

const TABS: { key: Tab; labelKey: string }[] = [
  { key: "kpis", labelKey: "adminTitle" },
  { key: "admins", labelKey: "adminAdmins" },
  { key: "users", labelKey: "adminUsers" },
  { key: "payments", labelKey: "adminPayments" },
  { key: "verifications", labelKey: "adminVerify" },
  { key: "reviews", labelKey: "adminReviews" },
  { key: "reports", labelKey: "adminReports" },
  { key: "vip", labelKey: "adminVip" },
  { key: "courses", labelKey: "adminCourses" },
  { key: "categories", labelKey: "adminCategories" },
  { key: "pricing", labelKey: "adminPricing" },
  { key: "promos", labelKey: "adminPromos" },
  { key: "audit", labelKey: "adminAudit" },
];

/** Triggers a client-side CSV download of the given rows. */
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");

  // BOM keeps Arabic readable when opened in Excel.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Admin() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { t } = useLang();
  const { user } = useAuth();
  const active = (TABS.find((x) => x.key === tab)?.key ?? "kpis") as Tab;

  if (user && user.role !== "admin") {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {t.errNotAuthorized}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-black">{t.adminTitle}</h1>

      <nav className="flex gap-1 overflow-x-auto border-b border-[#e3e8e5]" aria-label={t.adminTitle}>
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => navigate(`/admin/${item.key}`)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium ${
              active === item.key
                ? "border-[#006233] text-[#006233]"
                : "border-transparent text-neutral-600"
            }`}
          >
            {t[item.labelKey as keyof typeof t]}
          </button>
        ))}
      </nav>

      {active === "kpis" && <Kpis />}
      {active === "admins" && <AdminAdmins />}
      {active === "users" && <Users />}
      {active === "payments" && <Payments />}
      {active === "verifications" && <Verifications />}
      {active === "reviews" && <Reviews />}
      {active === "reports" && <Reports />}
      {active === "vip" && <VipAdmin />}
      {active === "promos" && <Promos />}
      {active === "courses" && <AdminCourses />}
      {active === "categories" && <AdminCategories />}
      {active === "pricing" && <AdminPricing />}
      {active === "audit" && <Audit />}
    </div>
  );
}

function Kpis() {
  const { t, lang } = useLang();
  const kpis = useAuthQuery(
    api.admin.kpis, {});
  if (kpis === undefined) return <div className="skeleton h-40 rounded bg-neutral-100" />;

  const tiles = [
    { label: t.signups, value: kpis.totals.users },
    { label: t.statsWholesalers, value: kpis.totals.wholesalers },
    { label: t.statsProducts, value: kpis.totals.products },
    { label: t.productReviews, value: kpis.totals.reviews },
    { label: t.activeSubs, value: kpis.activeSubscriptions },
    { label: t.revenue, value: formatDinar(kpis.revenueTotal, lang) },
    { label: t.adminPayments, value: kpis.totals.pendingPayments },
    { label: t.adminReports, value: kpis.totals.openReports },
  ];

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-[#e3e8e5] p-3 text-center">
            <dt className="text-[11px] text-neutral-600">{tile.label}</dt>
            <dd className="text-lg font-bold text-[#006233]">{tile.value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg border border-[#e3e8e5] p-4">
        <h2 className="text-sm font-bold text-black">
          {t.conversionTrial}: <bdi>{kpis.conversionTrialToPaid}%</bdi>
        </h2>
        <p className="mt-1 text-xs text-neutral-600">
          {lang === "ar" ? "تجارب مشطوبة" : "Essais"}: <bdi>{kpis.revenueByPlan.trial}</bdi> ·{" "}
          {t.activeSubs}: <bdi>{kpis.activeSubscriptions}</bdi>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[#e3e8e5] p-4">
          <h2 className="text-sm font-bold text-black">{t.navCategories}</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {kpis.topCategories.map((row) => (
              <li key={row.category} className="flex justify-between">
                <span>{CATEGORIES.find((c) => c.key === row.category)?.[lang] ?? row.category}</span>
                <bdi>{row.count}</bdi>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-[#e3e8e5] p-4">
          <h2 className="text-sm font-bold text-black">{t.statsWholesalers}</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {kpis.topWholesalers.map((row) => (
              <li key={row.shopId} className="flex justify-between gap-2">
                <span className="truncate">{row.name}</span>
                <bdi>{row.products}</bdi>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-[#e3e8e5] p-4">
        <h2 className="text-sm font-bold text-black">{t.signups}</h2>
        <div className="mt-3 flex h-24 items-end gap-1">
          {kpis.signups.map((point) => (
            <div
              key={point.day}
              className="flex-1 rounded-t bg-[#006233]"
              style={{ height: `${Math.min(100, point.count * 12)}%` }}
              title={`${point.day}: ${point.count}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Users() {
  const { t, lang } = useLang();
  const [role, setRole] = useState("");
  const liveUsers = useAuthQuery(api.admin.listUsers, { role: role || undefined });
  const suspend = useMutation(api.admin.setUserSuspended);
  const setUserRole = useMutation(api.admin.setUserRole);

  // Live rows only. The panel used to top the table up with invented accounts
  // so it never looked empty; on a platform that launches empty that would be
  // fake data, so an empty table now says so instead.
  const users = liveUsers ?? [];

  const handleRoleChange = async (
    userId: string,
    newRole: "admin" | "wholesaler" | "retailer",
  ) => {
    try {
      await setUserRole({ userId: userId as unknown as Id<"users">, role: newRole });
      toast.success(
        lang === "ar" ? `تم تغيير نوع الحساب إلى ${newRole}` : `Rôle mis à jour : ${newRole}`,
      );
    } catch {
      toast.error(t.errGeneric);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label={t.adminUsers}
            className="tap-target rounded-lg border border-[#e3e8e5] bg-white px-3 text-xs font-semibold"
          >
            <option value="">{lang === "ar" ? "كل الأدوار" : "Tous les rôles"}</option>
            <option value="admin">{lang === "ar" ? "المسؤولون (Admin)" : "Admins"}</option>
            <option value="wholesaler">{t.roleWholesaler}</option>
            <option value="retailer">{t.roleRetailer}</option>
          </select>
          <button
            onClick={() => downloadCsv("tajirdz-users.csv", users as never)}
            className="tap-target flex items-center gap-1.5 rounded-lg border border-[#e3e8e5] bg-white px-3 text-xs font-semibold hover:bg-neutral-50 shadow-2xs"
          >
            <Download className="size-3.5" aria-hidden />
            {t.adminExport}
          </button>
        </div>
        <span className="text-xs font-semibold text-neutral-500">
          {users.length} {lang === "ar" ? "مستخدم" : "utilisateurs"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#e3e8e5] bg-white shadow-2xs">
        <table className="w-full text-sm">
          <thead className="border-b border-[#e3e8e5] bg-neutral-50/50 text-xs font-bold text-neutral-700">
            <tr>
              <th className="p-3 text-start">{lang === "ar" ? "الاسم" : "Nom"}</th>
              <th className="p-3 text-start">Email</th>
              <th className="p-3 text-start">{lang === "ar" ? "نوع الحساب" : "Rôle"}</th>
              <th className="p-3 text-start">{lang === "ar" ? "تعديل الصلاحية" : "Modifier rôle"}</th>
              <th className="p-3 text-end">{lang === "ar" ? "إجراءات" : "Actions"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e8e5]">
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-neutral-500">
                  {t.adminNoUsers}
                </td>
              </tr>
            )}
            {users.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50/50 transition-colors">
                <td className="p-3">
                  <div className="font-semibold text-neutral-900">{row.name}</div>
                  {row.suspended && (
                    <span className="mt-0.5 inline-block rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-800">
                      {t.adminSuspend}
                    </span>
                  )}
                </td>
                <td className="p-3 text-xs text-neutral-600">
                  <bdi dir="ltr">{row.email}</bdi>
                </td>
                <td className="p-3">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
                      row.role === "admin"
                        ? "bg-[#eef6f1] text-[#006233] border border-[#dcefe4]"
                        : row.role === "wholesaler"
                          ? "bg-amber-50 text-amber-800 border border-amber-200"
                          : "bg-blue-50 text-blue-800 border border-blue-200"
                    }`}
                  >
                    {row.role === "admin" ? "مسؤول" : row.role === "wholesaler" ? "تاجر جملة" : "تاجر تجزئة"}
                  </span>
                </td>
                <td className="p-3">
                  {row.email === "ramibnwantedd777@gmail.com" ? (
                    <span className="text-[11px] text-neutral-400 font-bold">المدير العام</span>
                  ) : (
                    <select
                      value={row.role}
                      onChange={(e) =>
                        handleRoleChange(
                          row.id,
                          e.target.value as "admin" | "wholesaler" | "retailer",
                        )
                      }
                      className="rounded-lg border border-[#e3e8e5] bg-white px-2 py-1 text-xs font-medium cursor-pointer"
                    >
                      <option value="admin">مسؤول (Admin)</option>
                      <option value="wholesaler">تاجر جملة</option>
                      <option value="retailer">تاجر تجزئة</option>
                    </select>
                  )}
                </td>
                <td className="p-3 text-end">
                  <button
                    onClick={() =>
                      suspend({
                        // `row.id` is a string because local fallback rows live
                        // in localStorage; a live row is always a real id.
                        userId: row.id as unknown as Id<"users">,
                        suspended: !row.suspended,
                        reason: "admin action",
                      }).catch(() => {})
                    }
                    className="tap-target rounded-lg border border-[#e3e8e5] bg-white hover:bg-neutral-50 px-3 text-xs font-semibold"
                  >
                    {row.suspended ? t.adminActivate : t.adminSuspend}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Payments() {
  const { t, lang } = useLang();
  const payments = useAuthQuery(
    api.admin.listPayments, {});
  const review = useMutation(api.billing.reviewPayment);

  if (payments === undefined) return <div className="skeleton h-40 rounded bg-neutral-100" />;

  return (
    <div className="space-y-3">
      <button
        onClick={() => downloadCsv("tajirdz-payments.csv", payments as never)}
        className="tap-target flex items-center gap-1 rounded-lg border border-[#e3e8e5] px-3 text-xs"
      >
        <Download className="size-3" aria-hidden />
        {t.adminExport}
      </button>

      <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
        <table className="w-full text-sm">
          <thead className="border-b border-[#e3e8e5] text-xs text-neutral-600">
            <tr>
              <th className="p-2 text-start">{lang === "ar" ? "المرجع" : "Référence"}</th>
              <th className="p-2 text-end">{t.filterPrice}</th>
              <th className="p-2 text-end">{lang === "ar" ? "الحالة" : "Statut"}</th>
              <th className="p-2 text-end">{lang === "ar" ? "إجراءات" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((row) => (
              <tr key={row.id} className="border-b border-[#e3e8e5] last:border-0">
                <td className="p-2">
                  <bdi dir="ltr">{row.reference}</bdi>
                  <span className="block text-[11px] text-neutral-600">{row.ownerName}</span>
                </td>
                <td className="p-2 text-end">
                  <bdi>{formatDinar(row.amountDa, lang)}</bdi>
                </td>
                <td className="p-2 text-end">
                  {row.status === "approved"
                    ? lang === "ar"
                      ? "مقبول"
                      : "Approuvé"
                    : row.status === "rejected"
                      ? lang === "ar"
                        ? "مرفوض"
                        : "Refusé"
                      : lang === "ar"
                        ? "قيد المراجعة"
                        : "En attente"}
                </td>
                <td className="p-2 text-end">
                  {row.status === "pending" && (
                    <span className="flex justify-end gap-1">
                      <button
                        onClick={() => review({ paymentId: row.id, approve: true })}
                        aria-label={t.adminApprove}
                        className="tap-target rounded-lg bg-[#006233] px-2 text-white"
                      >
                        <Check className="size-4" aria-hidden />
                      </button>
                      <button
                        onClick={() =>
                          review({ paymentId: row.id, approve: false, rejectReason: "unclear receipt" })
                        }
                        aria-label={t.adminReject}
                        className="tap-target rounded-lg border border-[#e3e8e5] px-2"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Verifications() {
  const { t, lang } = useLang();
  const shops = useAuthQuery(
    api.admin.listVerifications, {});
  const verify = useMutation(api.admin.verifyShop);

  if (shops === undefined) return <div className="skeleton h-32 rounded bg-neutral-100" />;

  return (
    <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
      <table className="w-full text-sm">
        <thead className="border-b border-[#e3e8e5] text-xs text-neutral-600">
          <tr>
            <th className="p-2 text-start">{t.shopName}</th>
            <th className="p-2 text-start">{t.rcNumber}</th>
            <th className="p-2 text-end">{lang === "ar" ? "إجراءات" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {shops.map((row) => (
            <tr key={row.id} className="border-b border-[#e3e8e5] last:border-0">
              <td className="p-2">{row.shopName}</td>
              <td className="p-2">
                <bdi dir="ltr">{row.rcNumber ?? "—"}</bdi>
              </td>
              <td className="p-2 text-end">
                {row.verification === "pending" ? (
                  <span className="flex justify-end gap-1">
                    <button
                      onClick={() => verify({ shopId: row.id, approve: true })}
                      aria-label={t.adminApprove}
                      className="tap-target rounded-lg bg-[#006233] px-2 text-white"
                    >
                      <Check className="size-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => verify({ shopId: row.id, approve: false })}
                      aria-label={t.adminReject}
                      className="tap-target rounded-lg border border-[#e3e8e5] px-2"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </span>
                ) : (
                  <span className="text-[#006233]">{t.sellerVerified}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reviews() {
  const { t } = useLang();
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const reviews = useAuthQuery(
    api.admin.listReviews, { onlySuspicious });
  const moderate = useMutation(api.admin.moderateReview);

  if (reviews === undefined) return <div className="skeleton h-32 rounded bg-neutral-100" />;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={onlySuspicious}
          onChange={(e) => setOnlySuspicious(e.target.checked)}
        />
        {t.adminTitle} — suspicious only
      </label>

      <ul className="space-y-2">
        {reviews.map((row) => (
          <li key={row.id} className="rounded-lg border border-[#e3e8e5] p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-black">{row.productName}</span>
              <bdi><Star className="inline size-3.5" aria-hidden /> {row.productRating}/5</bdi>
              {row.flagged && (
                <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-900">
                  {row.suspicionReason}
                </span>
              )}
              <span className="ms-auto">{formatDate(row.createdAt)}</span>
            </div>
            {row.comment && <p className="mt-1 text-sm text-neutral-700">{row.comment}</p>}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => moderate({ reviewId: row.id, hide: row.status !== "hidden" })}
                className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs"
              >
                {row.status === "hidden" ? t.adminActivate : t.adminHide}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reports() {
  const { t, lang } = useLang();
  const reports = useAuthQuery(
    api.admin.listReports, {});
  const resolve = useMutation(api.admin.resolveReport);
  const hideProduct = useMutation(api.admin.hideProduct);
  const setUserSuspended = useMutation(api.admin.setUserSuspended);
  // The queue promises the reporter a follow-up, so notifying is the default
  // and the switch stays visible while a row is still open.
  const [notifyReporter, setNotifyReporter] = useState(true);
  const [pendingSuspendUserId, setPendingSuspendUserId] = useState<Id<"users"> | null>(null);

  if (reports === undefined) return <div className="skeleton h-32 rounded bg-neutral-100" />;

  const guard = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
    } catch {
      toast.error(t.errGeneric);
    }
  };

  return (
    <div className="space-y-3">
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm">
        <input
          type="checkbox"
          checked={notifyReporter}
          onChange={(e) => setNotifyReporter(e.target.checked)}
          className="accent-[#006233]"
        />
        {lang === "ar" ? "أبلغ المبلّغ بالنتيجة" : "Notifier le signalant du résultat"}
      </label>

      <ul className="space-y-2">
        {reports.map((row) => (
          <li key={row.id} className="rounded-lg border border-[#e3e8e5] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-neutral-100 px-1.5">{row.targetType}</span>
              <span className="rounded bg-neutral-100 px-1.5">{row.reason}</span>
              <span className="ms-auto text-neutral-500">{formatDate(row.createdAt)}</span>
            </div>
            {row.details && <p className="mt-1 text-xs text-neutral-700">{row.details}</p>}
            {row.status === "open" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    void guard(
                      () => resolve({ reportId: row.id, resolution: "resolved", notifyReporter }),
                      t.adminApprove,
                    )
                  }
                  className="tap-target rounded-lg bg-[#006233] px-3 text-xs text-white"
                >
                  {t.adminApprove}
                </button>
                <button
                  onClick={() =>
                    void guard(
                      () => resolve({ reportId: row.id, resolution: "dismissed", notifyReporter }),
                      t.adminReject,
                    )
                  }
                  className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs"
                >
                  {t.adminReject}
                </button>
                {row.targetType === "product" && (
                  <button
                    onClick={() =>
                      void guard(
                        () => hideProduct({ productId: row.targetId as Id<"products">, hide: true }),
                        lang === "ar" ? "تم إخفاء المنتج" : "Produit masqué",
                      )
                    }
                    className="tap-target rounded-lg border border-red-200 px-3 text-xs text-red-700"
                  >
                    {lang === "ar" ? "إخفاء المنتج" : "Masquer le produit"}
                  </button>
                )}
                {row.targetType === "user" && (
                  <button
                    onClick={() => setPendingSuspendUserId(row.targetId as Id<"users">)}
                    className="tap-target rounded-lg border border-red-200 px-3 text-xs text-red-700"
                  >
                    {lang === "ar" ? "تعليق الحساب" : "Suspendre"}
                  </button>
                )}
              </div>
            )}
            {row.status !== "open" && (
              <p className="mt-1 text-xs text-neutral-500">{row.status}</p>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pendingSuspendUserId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSuspendUserId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.adminSuspend}</AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "ar" ? "نعلّق هاد الحساب؟" : "Suspendre ce compte ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const targetId = pendingSuspendUserId;
                setPendingSuspendUserId(null);
                if (!targetId) return;
                void guard(
                  () => setUserSuspended({ userId: targetId, suspended: true }),
                  lang === "ar" ? "تم تعليق الحساب" : "Compte suspendu",
                );
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t.adminSuspend}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * VIP overview: offers with moderation, the request queue, the open report
 * pile and the emergency revocation. `revokeAll` without arguments kills every
 * approved access — the off-switch when an offer turns out to be a scam.
 */
function VipAdmin() {
  const { t, lang } = useLang();
  const data = useAuthQuery(api.vip.adminOverview, {});
  const moderate = useMutation(api.vip.moderateTeaser);
  const revokeAll = useMutation(api.vip.revokeAll);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  if (data === undefined) return <div className="skeleton h-32 rounded bg-neutral-100" />;

  const guard = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
    } catch {
      toast.error(t.errGeneric);
    }
  };

  const tiles = [
    { label: t.vipOfferTitle, value: data.stats.products },
    { label: t.vipStatusPending, value: data.stats.pending },
    { label: t.vipStatusApproved, value: data.stats.approved },
    { label: t.adminReports, value: data.stats.reports },
    { label: lang === "ar" ? "مخفية" : "Masquées", value: data.stats.hidden },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-[#e3e8e5] p-3 text-center">
            <p className="text-xl font-bold text-[#006233]">
              <bdi>{formatNumber(tile.value, lang)}</bdi>
            </p>
            <p className="text-[11px] text-neutral-600">{tile.label}</p>
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t.vipAutoHideNote.replace("{n}", String(data.autoHideThreshold))}
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-black">{t.vipOfferTitle}</h2>
        {data.products.length === 0 ? (
          <p className="text-sm text-neutral-600">{t.vipMyEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {data.products.map((product) => (
              <li key={product.id} className="rounded-lg border border-[#e3e8e5] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-black">{product.name}</p>
                    <p className="mt-0.5 flex flex-wrap gap-2 text-xs text-neutral-500">
                      <span>{product.category}</span>
                      <span>{formatDate(product.createdAt, lang)}</span>
                      {product.hiddenByReports > 0 && (
                        <span className="font-semibold text-red-600">
                          <bdi>{product.hiddenByReports}</bdi>{" "}
                          {lang === "ar" ? "شكوى" : "signalements"}
                        </span>
                      )}
                      {!product.requestsOpen && (
                        <span>{t.vipPauseRequests}</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      void guard(
                        () =>
                          moderate({
                            productId: product.id,
                            action: product.isPaused ? "restore" : "hide",
                          }),
                        product.isPaused ? t.vipAdminRestore : t.vipAdminHide,
                      )
                    }
                    className={`tap-target shrink-0 rounded-lg border px-3 text-xs font-semibold ${
                      product.isPaused
                        ? "border-[#006233] text-[#006233]"
                        : "border-red-200 text-red-700"
                    }`}
                  >
                    {product.isPaused ? t.vipAdminRestore : t.vipAdminHide}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-black">{t.vipInboxTitle}</h2>
        {data.requests.length === 0 ? (
          <p className="text-sm text-neutral-600">{t.vipRequestsEmpty}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e3e8e5] text-xs text-neutral-500">
                  <th className="p-2 text-start">
                    {lang === "ar" ? "التاجر" : "Acheteur"}
                  </th>
                  <th className="p-2 text-start">
                    {lang === "ar" ? "البريد" : "E-mail"}
                  </th>
                  <th className="p-2 text-start">{t.reportReason}</th>
                  <th className="p-2 text-start">{t.vipStatusPending}</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((row) => (
                  <tr key={row._id} className="border-b border-[#e3e8e5] last:border-0">
                    <td className="p-2">{row.retailerName}</td>
                    <td className="max-w-[220px] truncate p-2">
                      {row.retailerEmail ?? "—"}
                    </td>
                    <td className="p-2">{formatDate(row.createdAt, lang)}</td>
                    <td className="p-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          row.status === "approved"
                            ? "bg-[#006233] text-white"
                            : row.status === "pending"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {t[
                          `vipStatus${row.status.charAt(0).toUpperCase()}${row.status.slice(1)}` as keyof typeof t
                        ]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-black">{t.adminReports}</h2>
        {data.reports.length === 0 ? (
          <p className="text-sm text-neutral-600">{t.vipReportsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {data.reports.map((report) => (
              <li key={report.id} className="rounded-lg border border-[#e3e8e5] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-neutral-100 px-1.5">{report.reason}</span>
                  <span className="text-neutral-500">{report.targetId}</span>
                  <span className="ms-auto text-neutral-500">
                    {formatDate(report.createdAt, lang)}
                  </span>
                </div>
                {report.details && (
                  <p className="mt-1 text-xs text-neutral-700">{report.details}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        onClick={() => setConfirmRevokeAll(true)}
        className="tap-target inline-flex items-center rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700"
      >
        {t.vipAdminRevokeAll}
      </button>

      <AlertDialog open={confirmRevokeAll} onOpenChange={setConfirmRevokeAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.vipAdminRevokeAll}</AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "ar"
                ? "سحب كل صلاحيات VIP الممنوحة؟ إجراء غير قابل للإلغاء."
                : "Révoquer toutes les accords VIP ? Action irréversible."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRevokeAll(false);
                void guard(() => revokeAll({}), t.vipAdminRevokeAll);
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t.vipAdminRevokeAll}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Promos() {
  const { t, lang } = useLang();
  const promos = useAuthQuery(
    api.admin.listPromos, {});
  const toggle = useMutation(api.admin.togglePromoActive);
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState(10);
  const [days, setDays] = useState(30);
  const create = useMutation(api.billing.createPromoCode);

  if (promos === undefined) return <div className="skeleton h-32 rounded bg-neutral-100" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[#e3e8e5] p-3">
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs text-neutral-600">{t.promoCode}</span>
          <input
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="tap-target w-full rounded-lg border border-[#e3e8e5] px-3 text-sm sm:w-40"
          />
        </label>
        <label className="block min-w-[110px] flex-1 sm:flex-initial">
          <span className="mb-1 block text-xs text-neutral-600">
            {lang === "ar" ? "أيام مجانية" : "Jours offerts"}
          </span>
          <input
            type="number"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="tap-target w-full rounded-lg border border-[#e3e8e5] px-3 text-sm sm:w-24"
          />
        </label>
        <label className="block min-w-[110px] flex-1 sm:flex-initial">
          <span className="mb-1 block text-xs text-neutral-600">
            {lang === "ar" ? "الحد الأقصى" : "Max"}
          </span>
          <input
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            className="tap-target w-full rounded-lg border border-[#e3e8e5] px-3 text-sm sm:w-24"
          />
        </label>
        <button
          onClick={async () => {
            try {
              await create({
                code,
                kind: "free_days",
                freeDays: days,
                maxUses,
                audience: "both",
              });
              toast.success(t.adminPromos);
              setCode("");
            } catch {
              toast.error(t.errGeneric);
            }
          }}
          className="tap-target rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
        >
          +
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
        <table className="w-full text-sm">
          <thead className="border-b border-[#e3e8e5] text-xs text-neutral-600">
            <tr>
              <th className="p-2 text-start">{t.promoCode}</th>
              <th className="p-2 text-end">
                {lang === "ar" ? "مستعمل" : "Utilisations"}
              </th>
              <th className="p-2 text-end">{lang === "ar" ? "باقي" : "Restant"}</th>
              <th className="p-2 text-end">{lang === "ar" ? "إجراءات" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {promos.map((row) => (
              <tr key={row.id} className="border-b border-[#e3e8e5] last:border-0">
                <td className="p-2">
                  <bdi>{row.code}</bdi>
                </td>
                <td className="p-2 text-end">
                  <bdi>
                    {row.used}/{row.maxUses}
                  </bdi>
                </td>
                <td className="p-2 text-end">
                  <bdi>{row.remaining}</bdi>
                </td>
                <td className="p-2 text-end">
                  <button
                    onClick={() => toggle({ promoId: row.id })}
                    className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs"
                  >
                    {row.isActive ? t.adminSuspend : t.adminActivate}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit() {
  const { t } = useLang();
  void t;
  const entries = useAuthQuery(
    api.admin.auditLog, { limit: 100 });
  if (entries === undefined) return <div className="skeleton h-32 rounded bg-neutral-100" />;

  return (
    <ul className="space-y-1 text-xs">
      {entries.map((row) => (
        <li key={row.id} className="rounded border border-[#e3e8e5] px-3 py-2">
          <span className="font-medium text-black">{row.action}</span>{" "}
          <span className="text-neutral-600">
            {row.targetType}:{row.targetId}
          </span>{" "}
          <span className="text-neutral-500">{formatDate(row.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}