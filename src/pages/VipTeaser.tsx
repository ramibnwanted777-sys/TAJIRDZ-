/**
 * VIP teaser page — `/vip/:slug`.
 *
 * The row behind this page carries no real name, no price and no photos: the
 * public half is only ever the generic teaser. Everything private (showcase
 * images, price hint, WhatsApp number) arrives in the same payload but is
 * gated server-side by an approved request, so a mistake here can only hide
 * data, never leak it.
 *
 * The route is deliberately unlinked from the sitemap and marked noindex:
 * discovery happens through feed/search cards, and the page itself shows
 * nothing a stranger should not already see.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Crown,
  Eye,
  Inbox,
  Lock,
  MessageCircle,
  Send,
  Star,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/lang";
import { WILAYAS, formatNumber } from "@/lib/catalog";
import {
  vipStatusKey,
  vipWhatsappMessage,
  watermarkText,
} from "@/lib/vip";
import { ReportDialog } from "@/components/ReportDialog";
import { StorageImage } from "@/components/StorageImage";
import { VipBadge } from "@/components/marketplace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";


/** Server error keys are dictionary keys; anything else falls back to generic. */
function useErrorText() {
  const { t } = useLang();
  return (error: unknown): string => {
    const msg = error instanceof Error ? error.message : "";
    if (
      (msg.startsWith("errVip") || msg.startsWith("vipErr")) &&
      msg in t
    ) {
      return t[msg as keyof typeof t];
    }
    if (msg.includes("RateLimit") || msg.includes("rate")) {
      return t.errRateLimitedShort;
    }
    return t.errGeneric;
  };
}

export function VipTeaser() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useLang();
  const { user } = useAuth();
  const errorText = useErrorText();

  const data = useQuery(api.vip.teaser, slug ? { slug } : "skip");
  const reviews = useQuery(
    api.vip.productReviews,
    data?.product && data.canSeeShowcase
      ? { productId: data.product.id }
      : "skip",
  );
  const logView = useMutation(api.vip.logView);
  const requestAccess = useMutation(api.vip.requestAccess);

  // Unlinked page: never index it, in either language or direction.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // One view per teaser per page mount — the counter is a stat, not a ticker.
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (data?.product && logged.current !== data.product.slug) {
      logged.current = data.product.slug;
      void logView({ productId: data.product.id }).catch(() => undefined);
    }
  }, [data?.product, logView]);

  // -------------------------------------------------------------- request form
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [wilaya, setWilaya] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowedWilayas = data?.product.vip.allowedWilayas ?? [];
  const wilayaOptions =
    allowedWilayas.length > 0
      ? WILAYAS.filter((w) => allowedWilayas.includes(w.code))
      : WILAYAS;

  const submitRequest = async () => {
    if (!data?.product) return;
    if (!acked) {
      toast.error(t.errVipAckRequired);
      return;
    }
    setBusy(true);
    try {
      await requestAccess({
        productId: data.product.id,
        quantity: Math.max(1, Math.round(quantity)),
        wilaya: wilaya || wilayaOptions[0]?.code || 1,
        message: message.trim(),
        acknowledged: true,
      });
      setOpen(false);
      setMessage("");
      toast.success(t.vipRequestSent);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (data === null) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Crown className="mx-auto size-10 text-amber-400" aria-hidden />
        <h1 className="mt-4 text-lg font-bold text-black">{t.notFoundTitle}</h1>
        <p className="mt-2 text-sm text-neutral-600">{t.notFoundBody}</p>
        <Link
          to="/feed"
          className="tap-target mt-5 inline-flex rounded-lg bg-[#006233] px-5 text-sm font-semibold text-white"
        >
          {t.navHome}
        </Link>
      </div>
    );
  }

  if (data === undefined || !slug) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-40 rounded-lg bg-neutral-100" />
        <div className="skeleton h-64 rounded-lg bg-neutral-100" />
      </div>
    );
  }

  const { product, shop, my, stats } = data;
  const catLabel = lang === "ar" ? product.categoryLabelAr : product.categoryLabelFr;
  const approved = Boolean(data.whatsappE164);
  const daysLeft = my?.expiresInDays ?? 0;
  const statusKey = my ? vipStatusKey(my.status) : null;

  const waHref = data.whatsappE164
    ? `https://wa.me/${data.whatsappE164.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
        vipWhatsappMessage(shop.name, lang),
      )}`
    : null;

  const viewerName = user?.name ?? "";
  const viewerId = user ? String(user._id) : "";
  const watermark = watermarkText({
    name: viewerName,
    userId: viewerId,
    date: new Date().toISOString().slice(0, 10),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* ------------------------------------------------------------- Header */}
      <section className="overflow-hidden rounded-lg border border-[#e3e8e5] bg-white">
        <div className="flex items-start justify-between gap-3 border-b border-amber-200 bg-black px-4 py-3">
          <div className="flex items-center gap-2">
            <Crown className="size-5 text-amber-400" aria-hidden />
            <span className="text-sm font-bold text-amber-400">{t.vipBadge}</span>
          </div>
          <ReportDialog targetType="product" targetId={product.id} />
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <VipBadge label={t.vipBadge} />
            <span className="rounded-full border border-[#e3e8e5] px-2 py-0.5 text-[11px] text-neutral-600">
              {catLabel}
            </span>
            {!product.vip.requestsOpen || product.isPaused ? (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                {t.vipErrNotOpen}
              </span>
            ) : null}
          </div>

          <h1 className="text-xl font-extrabold leading-snug text-black">
            {product.name}
          </h1>
          <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">
            {product.description}
          </p>

          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            <Link
              to={`/shop/${shop.slug}`}
              className="inline-flex items-center gap-1 font-semibold text-[#006233] hover:underline"
            >
              <BadgeCheck className="size-3.5" aria-hidden />
              {shop.name}
            </Link>
            <span aria-hidden>·</span>
            <span>{WILAYAS.find((w) => w.code === shop.wilaya)?.[lang] ?? ""}</span>
            {shop.verification === "approved" && (
              <span className="rounded-full bg-[#006233] px-2 py-0.5 text-[11px] text-white">
                {t.sellerVerified}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: Eye, value: stats.views, label: lang === "ar" ? "مشاهدة" : "vues" },
              {
                icon: Users,
                value: stats.approved,
                label: lang === "ar" ? "مقبول" : "acceptés",
              },
              {
                icon: Inbox,
                value: stats.requests,
                label: lang === "ar" ? "طلب" : "demandes",
              },
              {
                icon: Star,
                value: stats.avgRating ?? 0,
                label: lang === "ar" ? "تقييم" : "note",
                decimal: true,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-[#e3e8e5] bg-[#eef6f1]/50 px-3 py-2"
              >
                <stat.icon className="size-4 text-[#006233]" aria-hidden />
                <p className="mt-1 text-sm font-bold text-black">
                  <bdi>
                    {stat.decimal
                      ? stat.value.toFixed(1)
                      : formatNumber(stat.value, lang)}
                  </bdi>
                </p>
                <p className="text-[11px] text-neutral-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Request / status */}
      <section className="rounded-lg border border-[#e3e8e5] bg-white p-4">
        {my && statusKey ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  my.status === "approved"
                    ? "bg-[#006233] text-white"
                    : my.status === "pending"
                      ? "bg-amber-100 text-amber-800"
                      : my.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-neutral-100 text-neutral-600"
                }`}
              >
                {t[statusKey as keyof typeof t]}
              </span>
              {my.status === "pending" && daysLeft > 0 && (
                <span className="text-xs text-neutral-500">
                  {t.vipExpiresIn.replace("{n}", String(daysLeft))}
                </span>
              )}
            </div>

            {my.status === "pending" && <p className="text-sm text-neutral-600">{t.vipRequestSent}</p>}
            {my.status === "expired" && <p className="text-sm text-neutral-600">{t.vipExpiredNote}</p>}
            {my.status === "rejected" && my.decisionReason && (
              <p className="text-sm text-neutral-600">{my.decisionReason}</p>
            )}
            {my.status === "rejected" && !my.decisionReason && (
              <p className="text-sm text-neutral-600">{t.vipRejectReason}</p>
            )}

            {approved && waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#006233] px-5 text-sm font-semibold text-white sm:w-auto"
              >
                <MessageCircle className="size-4" aria-hidden />
                {t.vipContactCta}
              </a>
            )}
          </div>
        ) : data.eligibilityReason === "vipErrSignedIn" ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-neutral-600">{t.vipErrSignedIn}</p>
            <Link
              to={`/auth?returnTo=${encodeURIComponent(`/vip/${slug}`)}`}
              className="tap-target rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
            >
              {t.navLogin}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-bold text-black">{t.vipHowAccess}</h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                {t.vipHowAccessBody}
              </p>
            </div>

            {data.eligibilityReason ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t[data.eligibilityReason as keyof typeof t]}
              </p>
            ) : null}

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button
                  disabled={Boolean(data.eligibilityReason)}
                  className="w-full bg-[#006233] text-white hover:bg-[#00512b] sm:w-auto"
                >
                  <Send className="size-4" aria-hidden />
                  {t.vipRequestCta}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t.vipRequestCta}</DialogTitle>
                  <DialogDescription>{t.vipHowAccessBody}</DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-700">
                      {t.vipQuantity} ({product.minQty}+)
                    </span>
                    <input
                      type="number"
                      min={Math.max(1, product.minQty)}
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-700">
                      {t.vipWilayaLabel}
                    </span>
                    <select
                      value={wilaya || wilayaOptions[0]?.code || 1}
                      onChange={(e) => setWilaya(Number(e.target.value))}
                      className="tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]"
                    >
                      {wilayaOptions.map((w) => (
                        <option key={w.code} value={w.code}>
                          {w[lang]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-700">
                      {t.vipMessage}
                    </span>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      maxLength={400}
                      rows={3}
                      placeholder={lang === "ar" ? "الكمية، الولاية، وقت التوصيل..." : "Quantité, wilaya, délai..."}
                      className="w-full rounded-lg border border-[#e3e8e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#006233]"
                    />
                  </label>

                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="text-xs font-bold text-amber-900">{t.vipAckTitle}</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800">
                      {t.vipAckBody}
                    </p>
                    <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-amber-900">
                      <input
                        type="checkbox"
                        checked={acked}
                        onChange={(e) => setAcked(e.target.checked)}
                        className="accent-[#006233]"
                      />
                      {t.vipAckAccept}
                    </label>
                  </div>
                </div>

                <DialogFooter>
                  <button
                    type="button"
                    onClick={() => void submitRequest()}
                    disabled={busy || !acked}
                    className="tap-target w-full rounded-lg bg-[#006233] px-5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {t.vipSubmit}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- Showcase */}
      {data.canSeeShowcase && (
        <section className="space-y-3 rounded-lg border border-[#e3e8e5] bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-black">
            <Lock className="size-4 text-amber-500" aria-hidden />
            {t.vipShowcaseTitle}
          </h2>

          {data.showcase && data.showcase.imageStorageIds.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {data.showcase.imageStorageIds.map((id) => (
                <div
                  key={id}
                  className="relative aspect-square overflow-hidden rounded-lg border border-[#e3e8e5]"
                >
                  <StorageImage
                    storageId={id}
                    alt={product.name}
                    seed={product.slug}
                    className="size-full object-cover"
                  />
                  {/* Honest watermark: identifies the viewer, states that
                      screenshots cannot be blocked. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  >
                    <span className="-rotate-12 bg-black/55 px-2 py-1 text-[10px] font-semibold text-white/90">
                      {watermark}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-600">{t.vipShowcaseEmpty}</p>
          )}

          {data.showcase?.priceHint && (
            <p className="rounded-lg bg-[#eef6f1] px-3 py-2 text-sm font-semibold text-[#006233]">
              {data.showcase.priceHint}
            </p>
          )}
          {data.showcase?.notes && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">
              {data.showcase.notes}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-neutral-500">
            {t.vipWatermark} {t.vipScreenshotNote}
          </p>
        </section>
      )}

      {/* -------------------------------------------------------- Reviews */}
      {data.canSeeShowcase && reviews !== undefined && (
        <section className="space-y-3 rounded-lg border border-[#e3e8e5] bg-white p-4">
          <h2 className="text-sm font-bold text-black">{t.vipReviewTitle}</h2>
          {reviews.length === 0 ? (
            <p className="text-xs text-neutral-600">{t.vipReviewsEmpty}</p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className="rounded-lg border border-[#e3e8e5] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-black">{review.authorName}</span>
                    <span className="flex items-center gap-0.5 text-amber-500">
                      <Star className="size-3.5 fill-amber-400" aria-hidden />
                      <bdi>{review.rating}/5</bdi>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">{review.comment}</p>
                  {review.reply && (
                    <div className="mt-2 rounded bg-[#eef6f1] p-2 text-xs">
                      <span className="font-semibold text-[#006233]">{t.vipReply}</span>
                      <p className="mt-0.5 text-neutral-700">{review.reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-neutral-500">
        {t.vipLegalLine}
      </p>
    </div>
  );
}
