/**
 * Product detail page.
 *
 * The contact CTA is intentionally gated in the UI *and* enforced by the
 * server: `revealWhatsapp` refuses to return the number without an active
 * retailer subscription, so hiding the button here is presentation, not
 * security.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import {
  Star,
  Heart,
  Share2,
  MessageCircle,
  Store,
  Package,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { ReportDialog } from "@/components/ReportDialog";
import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import {
  formatDinar,
  formatNumber,
  formatRelativeTime,
  whatsappPrefill,
  whatsappUrl,
} from "@/lib/catalog";
import {
  BoostedBadge,
  EmptyState,
  ProductCard,
  ProductImage,
  RatingLine,
  SectionHeader,
  StockBadge,
  VerifiedBadge,
  WinningBadge,
} from "@/components/marketplace";

export function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useLang();

  const data = useQuery(api.catalog.productBySlug, slug ? { slug } : "skip");
  const entitlement = useAuthQuery(
    api.contact.contactEntitlement, {});
  const favoriteToggle = useMutation(api.wholesaler.toggleFavorite);
  const recordView = useMutation(api.wholesaler.recordView);
  const reveal = useMutation(api.contact.revealWhatsapp);
  const startChat = useMutation(api.contact.startChat);
  const submitReview = useMutation(api.reviews.submitReview);
  const navigate = useNavigate();

  const [imageIndex, setImageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    productRating: 5,
    sellerRating: 5,
    comment: "",
    claimedPurchase: false,
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const viewTracked = useRef(false);

  // Count one view per mount, once the product is confirmed to exist.
  useEffect(() => {
    if (data?.product && !viewTracked.current) {
      viewTracked.current = true;
      void recordView({ productId: data.product._id });
    }
  }, [data, recordView]);

  // A VIP teaser has its own privacy-gated page: /product/:slug would render
  // it as a normal product with a zero price, so redirect to the teaser.
  useEffect(() => {
    if (data?.product.visibility === "vip") {
      navigate(`/vip/${data.product.slug}`, { replace: true });
    }
  }, [data?.product.visibility, data?.product.slug, navigate]);

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <div className="skeleton aspect-square w-full rounded-lg bg-[#eef6f1]" />
        <div className="skeleton h-5 w-2/3 rounded bg-neutral-200" />
        <div className="skeleton h-4 w-1/3 rounded bg-neutral-200" />
      </div>
    );
  }

  if (data === null) {
    return (
      <EmptyState
        title={lang === "ar" ? "المنتج ما كاينش" : "Produit introuvable"}
        hint={t.feedEmptyHint}
      />
    );
  }

  const { product, shop, reviews, breakdown, related, canReview, canSeeWhatsapp } = data;
  const images = product.imageStorageIds;

  const onContact = async () => {
    setBusy(true);
    try {
      const link = `${window.location.origin}/product/${product.slug}`;
      const result = await reveal({
        shopId: shop._id,
        productId: product._id,
        productName: product.name,
        productSlug: product.slug,
        productUrl: link,
      });
      const message = whatsappPrefill(product.name, result.productUrl ?? link);
      const popup = window.open(
        whatsappUrl(result.whatsappE164, message),
        "_blank",
        "noopener,noreferrer",
      );
      if (!popup) {
        await navigator.clipboard?.writeText(result.whatsappE164).catch(() => undefined);
        toast.info(
          lang === "ar"
            ? `رقم واتساب التاجر: ${result.whatsappE164}`
            : `WhatsApp du vendeur : ${result.whatsappE164}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t.errGeneric;
      if (message.includes("errSubscriptionRequired")) {
        toast.error(t.contactLockedTitle, { description: t.contactLockedBody });
      } else {
        toast.error(t.errGeneric);
      }
    } finally {
      setBusy(false);
    }
  };

  const onChat = async () => {
    setBusy(true);
    try {
      await startChat({
        shopId: shop._id,
        productId: product._id,
        firstMessage:
          lang === "ar"
            ? `السلام عليكم، بغيت نستفسر على «${product.name}».`
            : `Bonjour, je souhaite des informations sur « ${product.name} ».`,
      });
      toast.success(t.openChat);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("errSubscriptionRequired")) {
        toast.error(t.contactLockedTitle, { description: t.contactLockedBody });
      } else {
        toast.error(t.errGeneric);
      }
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    const url = `${window.location.origin}/product/${product.slug}`;
    const shareText =
      lang === "ar"
        ? `${product.name} — ${formatDinar(product.wholesalePriceDa, lang)}`
        : `${product.name} — ${formatDinar(product.wholesalePriceDa, lang)}`;
    if (navigator.share) {
      await navigator.share({ title: product.name, text: shareText, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast.success(t.linkCopied);
  };

  const onReview = async () => {
    setBusy(true);
    try {
      await submitReview({
        productId: product._id,
        productRating: reviewForm.productRating,
        sellerRating: reviewForm.sellerRating,
        comment: reviewForm.comment || undefined,
        claimedPurchase: reviewForm.claimedPurchase || undefined,
      });
      setReviewOpen(false);
      toast.success(t.reviewSubmitted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("errReview:")) {
        toast.error(t.reviewNotEligible, { description: t.reviewNotEligibleReason });
      } else if (message.includes("errNoLinks")) {
        toast.error(t.errNoLinksInPublicText);
      } else {
        toast.error(t.errGeneric);
      }
    } finally {
      setBusy(false);
    }
  };

  const subscribed = entitlement?.subscribed ?? false;
  const signedIn = entitlement?.signedIn ?? false;

  return (
    <div className="space-y-8">
      <nav className="text-xs text-neutral-600" aria-label="breadcrumb">
        <Link to="/" className="hover:underline">
          {t.navHome}
        </Link>
        <span className="mx-1">/</span>
        <Link to={`/search?category=${product.category}`} className="hover:underline">
          {lang === "ar" ? product.categoryLabelAr : product.categoryLabelFr}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-black">{product.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------- Gallery */}
        <div>
          <div className="aspect-square overflow-hidden rounded-lg border border-[#e3e8e5] bg-[#eef6f1]">
            <ProductImage
              storageIds={images.length ? [images[imageIndex]] : []}
              seed={product.slug}
              alt={product.name}
            />
          </div>
          {images.length > 1 && (
            <div className="mt-2 flex gap-2">
              {images.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setImageIndex(index)}
                  aria-label={`image ${index + 1}`}
                  className={`size-16 overflow-hidden rounded border-2 ${
                    index === imageIndex ? "border-[#006233]" : "border-transparent"
                  }`}
                >
                  <ProductImage
                    storageIds={[images[index]]}
                    seed={`${product.slug}-${index}`}
                    alt=""
                  />
                </button>
              ))}
            </div>
          )}

          {/* ------------------------------------------------- Price tiers */}
          {/* `overflow-x-auto` is the phone fix: `html { overflow-x: hidden }`
              would clip the two columns instead of letting them scroll. */}
          <div className="mt-4 overflow-x-auto rounded-lg border border-[#e3e8e5] p-4">
            <h2 className="text-sm font-bold text-black">{t.productPriceTiers}</h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-xs text-neutral-600">
                  <th className="py-1 text-start">{t.productQuantity}</th>
                  <th className="py-1 text-end">{t.productWholesalePrice}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[#e3e8e5]">
                  <td className="py-2">
                    <bdi>{formatNumber(product.minQty, lang)}</bdi>+
                  </td>
                  <td className="py-2 text-end font-semibold">
                    <bdi>{formatDinar(product.wholesalePriceDa, lang)}</bdi>
                  </td>
                </tr>
                {product.priceTiers.map((tier) => (
                  <tr key={tier.minQty} className="border-t border-[#e3e8e5]">
                    <td className="py-2">
                      <bdi>{formatNumber(tier.minQty, lang)}</bdi>+
                    </td>
                    <td className="py-2 text-end font-semibold text-[#006233]">
                      <bdi>{formatDinar(tier.priceDa, lang)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* --------------------------------------------------------- Detail */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {product.isWinning && <WinningBadge label={t.winningBadge} />}
            {data.isBoosted && (
              <BoostedBadge label={t.boostedBadge} />
            )}
            <StockBadge status={product.stockStatus} labels={t} />
          </div>

          <h1 className="text-xl font-bold text-black sm:text-2xl">{product.name}</h1>

          <div className="flex flex-wrap items-center gap-3">
            <RatingLine
              rating={product.avgProductRating}
              count={product.reviewCount}
              lang={lang}
              suffix={t.productReviews}
            />
            <span className="text-xs text-neutral-600">
              {t.productMinQty}:{" "}
              <bdi>{formatNumber(product.minQty, lang)}</bdi> {t.productUnits}
            </span>
            <span className="text-xs text-neutral-600">
              {lang === "ar" ? "التحضير" : "Préparation"}:{" "}
              <bdi>{formatNumber(product.prepDays, lang)}</bdi> {t.days}
            </span>
          </div>

          <div className="rounded-lg bg-[#eef6f1] p-4">
            <span className="text-xs text-neutral-700">{t.productWholesalePrice}</span>
            <p className="text-3xl font-extrabold text-[#006233]">
              <bdi>{formatDinar(product.wholesalePriceDa, lang)}</bdi>
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              {t.productFrom} <bdi>{formatNumber(product.minQty, lang)}</bdi> {t.productUnits}
            </p>
          </div>

          {/* -------------------------------------------------- Wholesaler */}
          <Link
            to={`/shop/${shop.slug}`}
            className="block rounded-lg border border-[#e3e8e5] p-4 transition-colors hover:border-[#006233]"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Store className="size-5 shrink-0 text-[#006233]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-black">
                  <span className="truncate">{shop.name}</span>
                  {shop.verification === "approved" && (
                    <VerifiedBadge label={t.sellerVerified} />
                  )}
                </p>
                <p className="text-xs text-neutral-600">
                  {lang === "ar" ? shop.wilayaAr : shop.wilayaFr}
                </p>
              </div>
              <RatingLine
                rating={shop.ratingSummary?.overall ?? 0}
                count={shop.ratingSummary?.count ?? 0}
                lang={lang}
                suffix={t.productReviews}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-700">
              <span>
                {t.sellerResponseRate}:{" "}
                <bdi>{Math.round(shop.responseRate * 100)}%</bdi>
              </span>
              <span>
                {t.sellerResponseTime}:{" "}
                <bdi>
                  {shop.medianResponseMinutes ?? "—"}
                </bdi>{" "}
                {lang === "ar" ? "دقيقة" : "min"}
              </span>
            </div>
          </Link>

          {/* ------------------------------------------------------ Actions */}
          <div className="space-y-2">
            {!signedIn ? (
              <Link
                to={`/auth?returnTo=/product/${product.slug}`}
                className="tap-target flex w-full items-center justify-center rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
              >
                {t.contactLoggedInCta}
              </Link>
            ) : subscribed ? (
              <>
                <button
                  onClick={onContact}
                  disabled={busy}
                  className="tap-target flex w-full items-center justify-center gap-2 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {t.openWhatsapp}
                </button>
                <button
                  onClick={onChat}
                  disabled={busy}
                  className="tap-target flex w-full items-center justify-center gap-2 rounded-lg border border-black px-4 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {t.openChat}
                </button>
              </>
            ) : (
              <div className="rounded-lg border border-[#006233] bg-[#eef6f1] p-4">
                <p className="text-sm font-semibold text-black">{t.contactLockedTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-700">
                  {t.contactLockedBody}
                </p>
                <Link
                  to="/billing"
                  className="tap-target mt-3 flex w-full items-center justify-center rounded-lg bg-[#006233] px-4 text-center text-sm font-semibold text-white"
                >
                  {t.contactLockedCta}
                </Link>
              </div>
            )}
            {canSeeWhatsapp && shop.whatsappE164 && (
              <p className="text-center text-[11px] text-neutral-500">
                <bdi dir="ltr">{shop.whatsappE164}</bdi>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => favoriteToggle({ productId: product._id })}
                className="tap-target flex min-w-[120px] flex-1 items-center justify-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm"
              >
                <Heart
                  className={`size-4 ${data.isFavorite ? "fill-[#006233] text-[#006233]" : ""}`}
                  aria-hidden
                />
                {data.isFavorite ? t.removeFavorite : t.addFavorite}
              </button>
              <button
                onClick={onShare}
                className="tap-target flex min-w-[110px] flex-1 items-center justify-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm"
              >
                <Share2 className="size-4" aria-hidden />
                {t.shareProduct}
              </button>
              <ReportDialog targetType="product" targetId={product._id} />
            </div>
          </div>

          {product.description && (
            <div>
              <h2 className="text-sm font-bold text-black">{t.productDescription}</h2>
              <p className="mt-1 text-sm leading-relaxed text-neutral-700">
                {product.description}
              </p>
            </div>
          )}

          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <Link
                  key={tag}
                  to={`/search?q=${encodeURIComponent(tag)}`}
                  className="rounded-full border border-[#e3e8e5] px-3 py-1 text-xs text-neutral-700 hover:border-[#006233]"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ Reviews */}
      <section>
        <SectionHeader title={`${t.productReviews} (${reviews.length})`} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            {canReview ? (
              reviewOpen ? (
                <ReviewForm
                  form={reviewForm}
                  setForm={setReviewForm}
                  onSubmit={onReview}
                  onCancel={() => setReviewOpen(false)}
                  busy={busy}
                  lang={lang}
                  t={t}
                />
              ) : (
                <button
                  onClick={() => setReviewOpen(true)}
                  className="tap-target w-full rounded-lg bg-[#006233] text-sm font-semibold text-white"
                >
                  {t.reviewWrite}
                </button>
              )
            ) : (
              <p className="rounded-lg border border-[#e3e8e5] bg-[#eef6f1]/50 px-4 py-3 text-xs text-neutral-700">
                {t.reviewNotEligibleReason}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {reviews.length === 0 ? (
                <EmptyState title={t.productNoReviews} hint={t.productNoReviewsHint} />
              ) : (
                reviews.map((review) => (
                  <article
                    key={review.id}
                    className="rounded-lg border border-[#e3e8e5] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-black">
                        {review.authorName}
                      </span>
                      {review.verifiedContact && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#eef6f1] px-2 py-0.5 text-[10px] font-medium text-[#006233]">
                          <CheckCircle2 className="size-3" aria-hidden />
                          {lang === "ar" ? "تواصل موثّق" : "Contact vérifié"}
                        </span>
                      )}
                      {review.claimedPurchase && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#e3e8e5] px-2 py-0.5 text-[10px] text-neutral-700">
                          <Package className="size-3" aria-hidden />
                          {t.reviewPurchased}
                        </span>
                      )}
                      <span className="ms-auto text-[11px] text-neutral-500">
                        {formatRelativeTime(review.createdAt, lang)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-700">
                      <span className="inline-flex items-center gap-1">
                        {t.reviewProductRating}
                        <Stars value={review.productRating} />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {t.reviewSellerRating}
                        <Stars value={review.sellerRating} />
                      </span>
                    </div>

                    {review.comment && (
                      <p className="mt-2 text-sm leading-relaxed text-neutral-800">
                        {review.comment}
                      </p>
                    )}

                    {review.reply && (
                      <div className="mt-3 border-s-2 border-[#006233] ps-3">
                        <p className="text-xs font-semibold text-[#006233]">
                          {shop.name}
                        </p>
                        <p className="mt-0.5 text-sm text-neutral-700">{review.reply}</p>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </div>

          {/* Rating breakdown */}
          <aside className="rounded-lg border border-[#e3e8e5] p-4">
            <h3 className="text-sm font-bold text-black">{t.productReviews}</h3>
            <div className="mt-3 space-y-1.5">
              {breakdown.map((row) => (
                <div key={row.star} className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-neutral-700">
                    <bdi>{row.star}</bdi> <Star className="inline size-3.5 text-[#006233]" aria-hidden />
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full bg-[#006233]"
                      style={{
                        width: `${
                          reviews.length
                            ? (row.product / Math.max(1, reviews.length)) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="w-5 text-end text-neutral-600">
                    <bdi>{row.product}</bdi>
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {/* ------------------------------------------------------------ Related */}
      {related.length > 0 && (
        <section>
          <SectionHeader title={t.productRelated} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3 ${n <= value ? "fill-[#006233] text-[#006233]" : "text-neutral-300"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

function ReviewForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  busy,
  lang,
  t,
}: {
  form: { productRating: number; sellerRating: number; comment: string; claimedPurchase: boolean };
  setForm: (f: { productRating: number; sellerRating: number; comment: string; claimedPurchase: boolean }) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  lang: "ar" | "fr";
  t: ReturnType<typeof useLang>["t"];
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-3 rounded-lg border border-[#e3e8e5] p-4"
    >
      <div>
        <span className="text-xs font-medium text-neutral-700">{t.reviewProductRating}</span>
        <div className="mt-1">
          <Stars
            value={form.productRating}
          />
          <input
            type="range"
            min={1}
            max={5}
            value={form.productRating}
            onChange={(e) =>
              setForm({ ...form, productRating: Number(e.target.value) })
            }
            aria-label={t.reviewProductRating}
            className="w-full"
          />
        </div>
      </div>
      <div>
        <span className="text-xs font-medium text-neutral-700">{t.reviewSellerRating}</span>
        <input
          type="range"
          min={1}
          max={5}
          value={form.sellerRating}
          onChange={(e) => setForm({ ...form, sellerRating: Number(e.target.value) })}
          aria-label={t.reviewSellerRating}
          className="w-full"
        />
      </div>
      <textarea
        value={form.comment}
        onChange={(e) => setForm({ ...form, comment: e.target.value })}
        placeholder={t.reviewComment}
        rows={3}
        maxLength={800}
        className="w-full rounded-lg border border-[#e3e8e5] px-3 py-2 text-sm outline-none focus:border-[#006233]"
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.claimedPurchase}
          onChange={(e) => setForm({ ...form, claimedPurchase: e.target.checked })}
        />
        {t.reviewPurchased}
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="tap-target flex-1 rounded-lg bg-[#006233] text-sm font-semibold text-white disabled:opacity-60"
        >
          {t.reviewSubmit}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="tap-target rounded-lg border border-[#e3e8e5] px-4 text-sm"
        >
          {t.cancel}
        </button>
      </div>
      <p className="text-[11px] text-neutral-500">
        {lang === "ar"
          ? "ما يمكن تكتب روابط ولا أرقام هواتف في التعليق."
          : "Les liens et numéros de téléphone sont interdits dans les commentaires."}
      </p>
    </form>
  );
}