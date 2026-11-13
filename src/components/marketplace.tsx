/**
 * Shared marketplace building blocks.
 *
 * Everything here is presentational and direction-agnostic: spacing and
 * alignment use logical properties so the same component reads correctly in
 * RTL and LTR.
 */

import { Link } from "react-router";
import { Star, TrendingUp, BadgeCheck, Flame, Package, Crown, Lock } from "lucide-react";

import { StorageImage } from "@/components/StorageImage";

import { useLang } from "@/lib/lang";
import { formatDinar, formatNumber, placeholderFor } from "@/lib/catalog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export function VerifiedBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[#006233] px-2 py-0.5 text-[11px] font-medium text-white"
      title={label}
    >
      <BadgeCheck className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function WinningBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#006233] px-2 py-0.5 text-[11px] font-semibold text-white">
      <Flame className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function BoostedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#006233] px-2 py-0.5 text-[11px] font-medium text-[#006233]">
      {label}
    </span>
  );
}

/** Gold-on-black VIP chip: the teaser is private until the request is approved. */
export function VipBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black px-2 py-0.5 text-[11px] font-semibold text-amber-400">
      <Crown className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function StockBadge({
  status,
  labels,
}: {
  status: "in_stock" | "low" | "out";
  labels: { inStock: string; lowStock: string; outOfStock: string };
}) {
  if (status === "in_stock") return null;
  const isOut = status === "out";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        isOut
          ? "bg-black text-white"
          : "border border-black/20 bg-white text-black",
      )}
    >
      <Package className="size-3" aria-hidden />
      {isOut ? labels.outOfStock : labels.lowStock}
    </span>
  );
}

/** "4.8/5 · 32 تقييم" — the trust line under a card title. */
export function RatingLine({
  rating,
  count,
  lang,
  suffix,
}: {
  rating: number;
  count: number;
  lang: "ar" | "fr";
  suffix: string;
}) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
      <Star className="size-3 fill-[#006233] text-[#006233]" aria-hidden />
      <bdi>
        {rating.toFixed(1)}/5
      </bdi>
      <span aria-hidden>·</span>
      <bdi>
        {formatNumber(count, lang)} {suffix}
      </bdi>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  wholesalePriceDa: number;
  minQty: number;
  priceTiers: { minQty: number; priceDa: number }[];
  stockStatus: "in_stock" | "low" | "out";
  imageStorageIds: string[];
  isWinning: boolean;
  isBoosted: boolean;
  avgProductRating: number;
  reviewCount: number;
  shopName: string;
  shopVerified: boolean;
  wilayaAr: string;
  wilayaFr: string;
  trendingScore?: number;
  /** VIP teaser: link goes to /vip/:slug and the price stays masked. */
  isVip?: boolean;
};

export function ProductCard({
  product,
  className,
}: {
  product: ProductCardData;
  className?: string;
}) {
  const { t, lang } = useLang();
  const wilaya = lang === "ar" ? product.wilayaAr : product.wilayaFr;
  const bestTier = product.priceTiers.reduce<
    { minQty: number; priceDa: number } | null
  >((best, tier) => (best === null || tier.priceDa < best.priceDa ? tier : best), null);

  return (
    <Link
      to={product.isVip ? `/vip/${product.slug}` : `/product/${product.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-[#e3e8e5] bg-white transition-colors hover:border-[#006233]",
        className,
      )}
      aria-label={product.name}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-[#eef6f1]">
        <ProductImage
          storageIds={product.imageStorageIds}
          seed={product.slug}
          alt={product.name}
        />
        <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
          {product.isVip && <VipBadge label={t.vipBadge} />}
          {product.isWinning && <WinningBadge label={t.winningBadge} />}
          {product.isBoosted && <BoostedBadge label={t.boostedBadge} />}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-black">
          {product.name}
        </h3>

        {product.isVip ? (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-black px-2 py-1 text-xs font-semibold text-amber-400">
            <Lock className="size-3.5" aria-hidden />
            {t.vipPrivate}
          </span>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <bdi className="text-sm font-bold text-[#006233] sm:text-base">
                {formatDinar(product.wholesalePriceDa, lang)}
              </bdi>
              <span className="text-[11px] text-neutral-500">
                /{" "}
                {t.productFrom} <bdi>{formatNumber(product.minQty, lang)}</bdi>
              </span>
            </div>

            {bestTier !== null && (
              <p className="text-[11px] text-neutral-600">
                {t.productFrom} <bdi>{formatDinar(bestTier.priceDa, lang)}</bdi>{" "}
                {t.productQuantity} <bdi>{formatNumber(bestTier.minQty, lang)}</bdi>
              </p>
            )}
          </>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-1.5 pt-1">
          <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-600">
            {product.shopName}
          </span>
          {product.shopVerified && <VerifiedBadge label={t.sellerVerified} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <RatingLine
            rating={product.avgProductRating}
            count={product.reviewCount}
            lang={lang}
            suffix={t.productReviews}
          />
          <bdi className="max-w-full truncate text-[11px] text-neutral-500">{wilaya}</bdi>
        </div>

        {product.stockStatus !== "in_stock" && (
          <div>
            <StockBadge status={product.stockStatus} labels={t} />
          </div>
        )}
      </div>
    </Link>
  );
}

/**
 * Product imagery. Uploaded photos resolve through Convex storage; products
 * without a photo fall back to a deterministic tinted tile so the grid never
 * shows a broken image.
 */
export function ProductImage({
  storageIds,
  seed,
  alt,
  className,
}: {
  storageIds: string[];
  seed: string;
  alt: string;
  className?: string;
}) {
  const { bg, fg } = placeholderFor(seed);
  const first = storageIds[0];

  if (!first) {
    return (
      <div
        className={cn("flex size-full items-center justify-center", className)}
        style={{ backgroundColor: bg }}
        role="img"
        aria-label={alt}
      >
        <Package className="size-10" style={{ color: fg }} aria-hidden />
      </div>
    );
  }

  return (
    <StorageImage
      storageId={first}
      alt={alt}
      seed={seed}
      className={cn("size-full object-cover", className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

export function SectionHeader({
  title,
  action,
  to,
}: {
  title: string;
  action?: string;
  to?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-bold text-black">{title}</h2>
      {action && to && (
        <Link to={to} className="text-xs font-medium text-[#006233] hover:underline">
          {action}
        </Link>
      )}
    </div>
  );
}

export function TrendingIcon() {
  return <TrendingUp className="size-4 text-[#006233]" aria-hidden />;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#e3e8e5] bg-[#eef6f1]/40 px-6 py-12 text-center">
      <Package className="size-8 text-[#006233]" aria-hidden />
      <p className="text-sm font-semibold text-black">{title}</p>
      {hint && <p className="max-w-sm text-xs text-neutral-600">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center"
    >
      <p className="text-sm font-semibold text-red-900">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md border border-black px-3 py-1.5 text-xs font-medium text-black"
        >
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

/** Feed skeleton that matches the real card's geometry to avoid layout shift. */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-[#e3e8e5] bg-white">
      <div className="skeleton aspect-square w-full bg-[#eef6f1]" />
      <div className="space-y-2 p-3">
        <div className="skeleton h-3 w-4/5 rounded bg-neutral-200" />
        <div className="skeleton h-4 w-1/2 rounded bg-neutral-200" />
        <div className="skeleton h-3 w-3/5 rounded bg-neutral-200" />
        <div className="skeleton h-3 w-2/5 rounded bg-neutral-200" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}