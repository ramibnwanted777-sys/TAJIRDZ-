/**
 * Landing page. Arabic-first, image-led, with the promo code and the two
 * audience paths (retailer vs wholesaler) clearly separated.
 */

import { Link } from "react-router";
import { useQuery } from "convex/react";
import {
  ShieldCheck,
  MessageCircle,
  BadgeCheck,
  ArrowRight,
  Store,
  ShoppingBag,
  TrendingUp,
  Lock,
  Crown,
} from "lucide-react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { formatNumber } from "@/lib/catalog";
import { useCategories } from "@/hooks/use-categories";
import { LogoWordmark } from "@/components/Logo";
import { CategoryBadge } from "@/components/CategoryIcon";
import { PricingSection } from "@/components/PricingSection";
import {
  ProductCard,
  ProductGridSkeleton,
  SectionHeader,
} from "@/components/marketplace";

export function Landing() {
  const { t, lang } = useLang();
  const feed = useQuery(api.catalog.feed, {});
  const categories = useCategories();

  const winning = feed?.winning.slice(0, 8) ?? [];

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="-mx-4 border-b border-[#e3e8e5] bg-[#eef6f1] px-4 py-10">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-6 flex justify-center">
            <LogoWordmark
              size="md"
              name={t.brandName}
              nameClassName="text-2xl"
            />
          </div>
          <h1 className="text-balance text-2xl font-extrabold leading-tight text-black sm:text-4xl">
            {t.heroTitle}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-neutral-700 sm:text-base">
            {t.heroSubtitle}
          </p>

          <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-stretch">
            <Link
              to="/auth?role=retailer"
              className="tap-target inline-flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg bg-[#006233] px-6 py-3 text-sm font-semibold text-white"
            >
              <ShoppingBag className="size-5 shrink-0" aria-hidden />
              <span className="text-balance text-center leading-tight line-clamp-2">
                {t.heroCtaRetailer}
              </span>
            </Link>
            <Link
              to="/auth?role=wholesaler"
              className="tap-target inline-flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-black bg-white px-6 py-3 text-sm font-semibold text-black"
            >
              <Store className="size-5 shrink-0" aria-hidden />
              <span className="text-balance text-center leading-tight line-clamp-2">
                {t.heroCtaWholesaler}
              </span>
            </Link>
          </div>

          <div className="mx-auto mt-6 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-[#006233] bg-white px-3 py-2 text-center text-xs">
            <span className="font-semibold text-[#006233]">{t.promoFirstMonthFree}</span>
            <code className="rounded bg-[#eef6f1] px-2 py-0.5 font-bold tracking-wider text-black">
              TAJIR-FREE
            </code>
            <span className="text-neutral-600">
              {lang === "ar"
                ? "للأول 10 مستخدمين فقط"
                : "pour les 10 premiers utilisateurs"}
            </span>
          </div>
        </div>

        {/* Marketplace statistics. Every number is counted from the live
            database; nothing here is a demo figure. While the launch catalogue
            is still empty the row is replaced by one card that says what to do
            next, instead of four zeroes. */}
        {feed === undefined ? (
          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-20 rounded-lg bg-white/70" />
            ))}
          </div>
        ) : feed.counts.products === 0 ? (
          <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-[#006233] bg-white p-5 text-center">
            <Store className="mx-auto size-6 text-[#006233]" aria-hidden />
            <p className="mt-2 text-sm font-bold text-black">{t.homeEmptyTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">
              {t.homeEmptyBody}
            </p>
            <Link
              to="/auth?role=wholesaler"
              className="tap-target mt-3 inline-flex items-center justify-center rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
            >
              {t.homeEmptyCta}
            </Link>
          </div>
        ) : (
          <dl className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t.statsWholesalers, value: feed.counts.verifiedShops },
              { label: t.statsProducts, value: feed.counts.products },
              { label: t.statsWilayas, value: feed.counts.wilayas },
              { label: t.statsReviews, value: feed.counts.reviews },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-[#e3e8e5] bg-white px-3 py-3 text-center"
              >
                <dt className="text-[11px] text-neutral-600">{stat.label}</dt>
                <dd className="text-xl font-bold text-[#006233]">
                  <bdi>{formatNumber(stat.value, lang)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ------------------------------------------------------------ Categories */}
      <section>
        <SectionHeader title={t.navCategories} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {categories.map((category) => (
            <Link
              key={category.key}
              to={`/search?category=${category.key}`}
              className="flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-[#e3e8e5] bg-white px-2 py-3 text-center transition-colors hover:border-[#006233]"
            >
              <CategoryBadge
                categoryKey={category.key}
                className="size-9"
              />
              <span className="text-balance text-center text-xs leading-tight font-medium text-black line-clamp-2">
                {lang === "ar" ? category.ar : category.fr}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- Winning */}
      {/* Hidden entirely while there is nothing to show: an empty rail with a
          heading reads as a broken page on a marketplace that just launched. */}
      {(feed === undefined || winning.length > 0) && (
        <section>
          <SectionHeader
            title={t.feedWinning}
            action={t.navSearch}
            to="/search?winning=1"
          />
          {feed === undefined ? (
            <ProductGridSkeleton />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {winning.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------- How it works */}
      <section className="rounded-lg border border-[#e3e8e5] bg-[#eef6f1]/50 p-5">
        <h2 className="text-base font-bold text-black">{t.footerHowItWorks}</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Store,
              title: lang === "ar" ? "1. التاجر يسجّل" : "1. Le grossiste s'inscrit",
              body:
                lang === "ar"
                  ? "يعرض منتجاته بأسعار جملة وكميات دنيا واضحة، ويرفع وثيقة السجل التجاري باش يتوثق."
                  : "Il publie ses produits avec prix de gros et quantités minimum claires, puis fait vérifier son registre de commerce.",
            },
            {
              icon: ShieldCheck,
              title: lang === "ar" ? "2. التقييمات ما يمكن تتزور" : "2. Des avis infalsifiables",
              body:
                lang === "ar"
                  ? "ما يمكن حتى بائع يقيم منتج إلا بعد ما تواصل مع التاجر، وبعد 48 سا، ومرة وحدة."
                  : "Un acheteur ne peut noter qu'après avoir contacté le vendeur, 48 h plus tard, et une seule fois.",
            },
            {
              icon: MessageCircle,
              title: lang === "ar" ? "3. تواصل مباشرة" : "3. Contact direct",
              body:
                lang === "ar"
                  ? "البائع المدفوع يوصل لرقم واتساب التاجر ولا يفتح محادثة داخل التطبيق."
                  : "L'acheteur abonné accède au WhatsApp du grossiste et peut discuter dans l'application.",
            },
          ].map((step) => (
            <li key={step.title} className="rounded-lg border border-[#e3e8e5] bg-white p-4">
              <step.icon className="size-5 text-[#006233]" aria-hidden />
              <h3 className="mt-2 text-sm font-semibold text-black">{step.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* --------------------------------------------------------------- Trust */}
      <section>
        <h2 className="text-base font-bold text-black">
          {lang === "ar" ? "علاش TajirDz" : "Pourquoi TajirDz"}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            {
              icon: BadgeCheck,
              title: lang === "ar" ? "تجار موثّقون" : "Vendeurs vérifiés",
              body:
                lang === "ar"
                  ? "الشارة الخضراء كتعني بلي التاجر رفع وثائقو والإدارة أكّدوها."
                  : "Le badge vert signifie que le vendeur a fourni ses documents, validés par l'administration.",
            },
            {
              icon: TrendingUp,
              title: lang === "ar" ? "منتجات رابحة" : "Produits gagnants",
              body:
                lang === "ar"
                  ? "الشارة البرتقالية محسوبة بطريقة Wilson: على الأقل 5 تقييمات ومعدل فوق 4.5."
                  : "Le badge est calculé par score de Wilson : au moins 5 avis et une moyenne au-dessus de 4,5.",
            },
            {
              icon: ShieldCheck,
              title: lang === "ar" ? "أرقام ديال التاجر مخبية" : "Numéros protégés",
              body:
                lang === "ar"
                  ? "رقم واتساب ديال التاجر ما يبانش إلا للبائع اللي عندو اشتراك."
                  : "Le WhatsApp du grossiste n'apparaît que pour un acheteur abonné.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-[#e3e8e5] p-4">
              <item.icon className="size-5 text-[#006233]" aria-hidden />
              <h3 className="mt-2 text-sm font-semibold text-black">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- VIP */}
      <section className="overflow-hidden rounded-lg border border-amber-300/60 bg-black px-5 py-6 sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 px-3 py-1 text-xs font-bold text-amber-400">
          <Crown className="size-3.5" aria-hidden />
          {t.vipBadge}
        </span>
        <h2 className="mt-3 text-lg font-bold text-white">{t.vipSectionTitle}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-300">
          {t.vipSectionSubtitle}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { icon: Lock, text: t.vipPoint1 },
            { icon: MessageCircle, text: t.vipPoint2 },
            { icon: ShieldCheck, text: t.vipPoint3 },
            { icon: Store, text: t.vipPoint4 },
          ].map((point) => (
            <li
              key={point.text}
              className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-4"
            >
              <point.icon className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden />
              <p className="text-sm leading-relaxed text-neutral-200">{point.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            to="/vip"
            className="tap-target inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 text-sm font-bold text-black"
          >
            {t.vipSectionCta}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            to="/search?vip=1"
            className="tap-target inline-flex items-center justify-center gap-2 rounded-lg border border-white/25 px-5 text-sm font-semibold text-white"
          >
            {t.vipOnlyFilter}
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------------ CTA */}
      {/* ------------------------------------------------------ Pricing */}
      <section className="rounded-lg border border-border bg-brand-green-tint/50 p-4 sm:p-5">
        <PricingSection />
      </section>

      <section className="rounded-lg bg-black px-5 py-8 text-center">
        <h2 className="text-lg font-bold text-white">
          {lang === "ar" ? "ابدأ اليوم، أول شهر مجاني" : "Commencez aujourd'hui, un mois offert"}
        </h2>
        <Link
          to="/auth"
          className="tap-target mx-auto mt-4 inline-flex min-h-16 w-fit flex-col items-center justify-center gap-1 rounded-lg bg-[#006233] px-6 py-3 text-sm font-semibold text-white"
        >
          <ArrowRight className="size-4 shrink-0" aria-hidden />
          <span className="text-center leading-tight">{t.navLogin}</span>
        </Link>
      </section>
    </div>
  );
}