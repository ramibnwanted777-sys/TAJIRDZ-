/**
 * Public wholesaler profile page.
 */

import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { Store, BadgeCheck, MapPin, Clock } from "lucide-react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, DELIVERY_OPTIONS, formatDate, formatNumber } from "@/lib/catalog";
import {
  EmptyState,
  ProductCard,
  ProductGridSkeleton,
  VerifiedBadge,
} from "@/components/marketplace";
import { ReportDialog } from "@/components/ReportDialog";

export function Shop() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useLang();
  const data = useQuery(api.catalog.shopBySlug, slug ? { slug } : "skip");

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-24 w-full rounded-lg bg-[#eef6f1]" />
        <ProductGridSkeleton count={4} />
      </div>
    );
  }

  if (data === null) {
    return <EmptyState title={lang === "ar" ? "التاجر ما كاينش" : "Vendeur introuvable"} />;
  }

  const { shop, products, stats, subscriptionLive } = data;
  const wilaya = lang === "ar" ? shop.wilayaAr : shop.wilayaFr;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-neutral-600" aria-label="breadcrumb">
        <Link to="/" className="hover:underline">
          {t.navHome}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-black">{shop.name}</span>
      </nav>

      <header className="rounded-lg border border-[#e3e8e5] bg-[#eef6f1] p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3 sm:gap-4">
          <Store className="size-9 shrink-0 text-[#006233] sm:size-10" aria-hidden />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-black sm:text-xl">
              <span className="truncate">{shop.name}</span>
              {shop.verification === "approved" && <VerifiedBadge label={t.sellerVerified} />}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-700 sm:text-sm">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4 shrink-0" aria-hidden />
                {wilaya}
                {shop.commune ? ` — ${shop.commune}` : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-4 shrink-0" aria-hidden />
                <bdi>{formatNumber(shop.avgPrepDays, lang)}</bdi> {t.days}
              </span>
              <span>
                {t.sellerSince} <bdi>{formatDate(shop.createdAt, lang)}</bdi>
              </span>
            </p>
          </div>
          <div className="text-end">
            <p className="text-xl font-extrabold text-[#006233] sm:text-2xl">
              <bdi>{(shop.ratingSummary?.overall ?? 0).toFixed(1)}</bdi>/5
            </p>
            <p className="text-xs text-neutral-600">
              <bdi>{formatNumber(shop.ratingSummary?.count ?? 0, lang)}</bdi> {t.productReviews}
            </p>
            <div className="mt-2 flex justify-end">
              <ReportDialog targetType="shop" targetId={shop._id} />
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center sm:gap-3">
          {[
            { label: t.dashProducts, value: stats.count },
            { label: t.winningBadge, value: stats.winning },
            { label: t.sellerResponseRate, value: `${Math.round(shop.responseRate * 100)}%` },
          ].map((item) => (
            <div key={item.label} className="min-w-0 rounded-lg border border-[#e3e8e5] bg-white px-2 py-2">
              <dt className="truncate text-[11px] text-neutral-600">{item.label}</dt>
              <dd className="text-base font-bold text-black sm:text-lg">{item.value}</dd>
            </div>
          ))}
        </dl>

        {shop.categories.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {shop.categories.map((key) => {
              const category = CATEGORIES.find((c) => c.key === key);
              return (
                <Link
                  key={key}
                  to={`/search?category=${key}`}
                  className="rounded-full border border-[#006233] px-3 py-1 text-xs text-[#006233] hover:bg-white"
                >
                  {category ? (lang === "ar" ? category.ar : category.fr) : key}
                </Link>
              );
            })}
          </div>
        )}

        {shop.deliveryOptions.length > 0 && (
          <p className="mt-3 text-xs text-neutral-700">
            {t.deliveryOptions}:{" "}
            {shop.deliveryOptions
              .map((key) => DELIVERY_OPTIONS.find((d) => d.key === key)?.[lang] ?? key)
              .join(" · ")}
          </p>
        )}

        {/* WhatsApp stays hidden until the server proves entitlement. */}
        {!data.canSeeWhatsapp && (
          <p className="mt-3 text-[11px] text-neutral-500">
            {lang === "ar"
              ? "رقم واتساب يظهر فقط للمشترين المسجلين باش يمنع النصب."
              : "Le WhatsApp n'est visible que pour les acheteurs abonnés, contre les arnaques."}
          </p>
        )}
      </header>

      {!subscriptionLive && products.length === 0 ? (
        <EmptyState
          title={t.subscriptionHiddenNote}
          hint={lang === "ar" ? "راسل التاجر مباشرة عبر زر التواصل." : "Contactez le vendeur directement."}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

export { BadgeCheck };