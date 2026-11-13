/**
 * `/my-vip` — every VIP request the signed-in retailer has made.
 *
 * The list is the retailer's single source of truth after a request leaves
 * the form: status (already expiry-adjusted server-side), the remaining
 * window while pending, the wholesaler's rejection reason, and the door back
 * into the teaser where an approval reveals the private showcase.
 */

import { Link } from "react-router";
import { useQuery } from "convex/react";
import { Crown, ExternalLink } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { useLang } from "@/lib/lang";
import { formatNumber } from "@/lib/catalog";
import { vipStatusKey } from "@/lib/vip";
import { EmptyState, VipBadge } from "@/components/marketplace";

function statusChipClass(status: string): string {
  if (status === "approved") return "bg-[#006233] text-white";
  if (status === "pending") return "bg-amber-100 text-amber-800";
  if (status === "rejected") return "bg-red-100 text-red-700";
  return "bg-neutral-100 text-neutral-600";
}

export function MyVip() {
  const { t, lang } = useLang();
  const data = useQuery(api.vip.myRequests, {});

  if (data === undefined) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-48 rounded bg-neutral-100" />
        <div className="skeleton h-24 rounded-lg bg-neutral-100" />
        <div className="skeleton h-24 rounded-lg bg-neutral-100" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-bold text-black">
          <Crown className="size-5 text-amber-500" aria-hidden />
          {t.vipMyTitle}
        </h1>
      </header>

      {data.requests.length === 0 ? (
        <EmptyState
          title={t.vipMyEmpty}
          hint={t.vipMyEmptyHint}
          action={
            <Link
              to="/search?vip=1"
              className="tap-target mt-1 inline-flex rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
            >
              {t.vipOnlyFilter}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {data.requests.map((row) => {
            const daysLeft = row.expiresInDays;
            const catLabel =
              lang === "ar"
                ? row.product.categoryLabelAr
                : row.product.categoryLabelFr;

            return (
              <li
                key={row.requestId}
                className="rounded-lg border border-[#e3e8e5] bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <VipBadge label={t.vipBadge} />
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusChipClass(row.status)}`}
                      >
                        {t[vipStatusKey(row.status) as keyof typeof t]}
                      </span>
                    </div>
                    <h2 className="truncate text-sm font-bold text-black">
                      {row.product.name}
                    </h2>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
                      <span>{row.shopName}</span>
                      <span aria-hidden>·</span>
                      <span>{catLabel}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {t.vipQuantity}: <bdi>{formatNumber(row.quantity, lang)}</bdi>
                      </span>
                    </p>
                  </div>

                  <Link
                    to={`/vip/${row.product.slug}`}
                    className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#e3e8e5] px-3 text-xs font-semibold text-[#006233]"
                  >
                    {t.vipViewDetails}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                  {row.status === "pending" && daysLeft > 0 && (
                    <span>
                      {t.vipExpiresIn.replace("{n}", String(daysLeft))}
                    </span>
                  )}
                  {row.status === "expired" && <span>{t.vipExpiredNote}</span>}
                  {row.status === "rejected" && row.decisionReason && (
                    <span className="text-red-600">{row.decisionReason}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
