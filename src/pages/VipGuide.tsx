/**
 * `/vip` — the public explainer for the VIP offer.
 *
 * Written for both audiences in one scroll: what a retailer gets (private
 * details, direct negotiation) and what a wholesaler gets (a teaser that
 * never shows the real product until they approve a buyer). The teaser pages
 * themselves are unlinked and noindex; this is the only VIP URL meant to be
 * found.
 */

import { Link } from "react-router";
import {
  ArrowRight,
  Crown,
  Eye,
  Lock,
  MessageCircle,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";

import { useLang } from "@/lib/lang";

export function VipGuide() {
  const { t, lang } = useLang();

  const steps = [t.vipStep1, t.vipStep2, t.vipStep3];
  const points = [
    { icon: Lock, text: t.vipPoint1 },
    { icon: MessageCircle, text: t.vipPoint2 },
    { icon: ShieldCheck, text: t.vipPoint3 },
    { icon: Store, text: t.vipPoint4 },
  ];

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="-mx-4 border-b border-amber-200 bg-black px-4 py-12 text-center">
        <div className="mx-auto max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 px-3 py-1 text-xs font-bold text-amber-400">
            <Crown className="size-3.5" aria-hidden />
            {t.vipBadge}
          </span>
          <h1 className="mt-4 text-balance text-2xl font-extrabold leading-tight text-white sm:text-4xl">
            {t.vipHeroTitle}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-neutral-300 sm:text-base">
            {t.vipHeroSubtitle}
          </p>
          <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-stretch">
            <Link
              to="/search?vip=1"
              className="tap-target inline-flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-6 py-3 text-sm font-bold text-black"
            >
              <Eye className="size-5 shrink-0" aria-hidden />
              <span className="text-balance text-center leading-tight line-clamp-2">
                {lang === "ar" ? "شوف المنتوجات VIP" : "Voir les produits VIP"}
              </span>
            </Link>
            <Link
              to="/dashboard/vip"
              className="tap-target inline-flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-white/25 px-6 py-3 text-sm font-semibold text-white"
            >
              <Store className="size-5 shrink-0" aria-hidden />
              <span className="text-balance text-center leading-tight line-clamp-2">
                {lang === "ar" ? "الموزعين: فعّل VIP" : "Grossistes : activez VIP"}
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- Steps */}
      <section>
        <h2 className="text-base font-bold text-black">{t.vipExplainerTitle}</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step}
              className="rounded-lg border border-[#e3e8e5] bg-white p-4"
            >
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-black text-xs font-bold text-amber-400">
                {index + 1}
              </span>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-black">
                {step}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* -------------------------------------------------------------- Points */}
      <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-black">
          <Users className="size-5 text-amber-600" aria-hidden />
          {t.vipSectionTitle}
        </h2>
        <p className="mt-1 text-sm text-neutral-600">{t.vipSectionSubtitle}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {points.map((point) => (
            <li
              key={point.text}
              className="flex items-start gap-3 rounded-lg border border-[#e3e8e5] bg-white p-4"
            >
              <point.icon className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden />
              <p className="text-sm leading-relaxed text-neutral-700">{point.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* --------------------------------------------------------------- Legal */}
      <section className="rounded-lg border border-[#e3e8e5] bg-white p-5">
        <h2 className="text-sm font-bold text-black">{t.vipTermsTitle}</h2>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">
          {t.vipTermsBody}
        </p>
        <Link
          to="/terms"
          className="mt-3 inline-block text-xs font-medium text-[#006233] hover:underline"
        >
          {lang === "ar" ? "اقرا شروط الاستعمال" : "Lire les conditions"}
        </Link>
      </section>

      {/* ----------------------------------------------------------------- CTA */}
      <section className="rounded-lg bg-black px-5 py-8 text-center">
        <h2 className="text-lg font-bold text-white">{t.vipSectionTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-neutral-300">
          {t.vipLegalLine}
        </p>
        <Link
          to="/search?vip=1"
          className="tap-target mx-auto mt-4 inline-flex min-h-16 w-fit flex-col items-center justify-center gap-1 rounded-lg bg-amber-400 px-6 py-3 text-sm font-bold text-black"
        >
          <ArrowRight className="size-4 shrink-0" aria-hidden />
          <span className="text-center leading-tight">{t.vipRequestCta}</span>
        </Link>
      </section>
    </div>
  );
}
