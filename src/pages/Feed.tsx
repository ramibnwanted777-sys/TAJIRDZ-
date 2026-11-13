/**
 * Home feed: trending, winning and new-arrival rails above the full grid.
 */

import { useQuery } from "convex/react";
import { useState } from "react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { formatNumber } from "@/lib/catalog";
import {
  EmptyState,
  ProductCard,
  ProductGridSkeleton,
  SectionHeader,
  TrendingIcon,
  type ProductCardData,
} from "@/components/marketplace";

export function Feed() {
  const { t, lang } = useLang();
  const feed = useQuery(api.catalog.feed, {});
  const [showAll, setShowAll] = useState(false);

  if (feed === undefined) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-6 w-40 rounded bg-neutral-200" />
        <ProductGridSkeleton count={8} />
      </div>
    );
  }

  const toCard = (row: NonNullable<typeof feed>["all"][number]): ProductCardData => row;
  const visible = showAll ? feed.all : feed.all.slice(0, 12);

  // Every rail, not just two: a page whose only content is an empty
  // "new arrivals" heading is worse than the empty state itself.
  if (
    feed.all.length === 0 &&
    feed.winning.length === 0 &&
    feed.trending.length === 0 &&
    feed.newArrivals.length === 0
  ) {
    return (
      <EmptyState
        title={t.feedEmpty}
        hint={t.feedEmptyHint}
        action={
          <a href="/auth?role=wholesaler" className="mt-2 text-xs font-semibold text-[#006233] underline">
            {t.heroCtaWholesaler}
          </a>
        }
      />
    );
  }

  return (
    <div className="space-y-10">
      {/* Trending this week: views + contact clicks over the last 7 days. */}
      {feed.trending.length > 0 && (
        <section>
          <SectionHeader title={t.feedTrending} action={t.navSearch} to="/search?sort=trending" />
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {feed.trending.map((product) => (
              <div key={product.id} className="w-44 shrink-0 snap-start sm:w-48">
                <ProductCard product={toCard(product)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Winning products, ranked by the Wilson lower bound. */}
      {feed.winning.length > 0 && (
        <section>
          <SectionHeader title={t.feedWinning} action={t.navSearch} to="/search?winning=1" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {feed.winning.map((product) => (
              <ProductCard key={product.id} product={toCard(product)} />
            ))}
          </div>
        </section>
      )}

      {feed.newArrivals.length > 0 && (
        <section>
          <SectionHeader title={t.feedNewArrivals} action={t.navSearch} to="/search?sort=newest" />
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {feed.newArrivals.map((product) => (
              <div key={product.id} className="w-44 shrink-0 snap-start sm:w-48">
                <ProductCard product={toCard(product)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Full catalogue */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-black">
            <TrendingIcon />
            {t.feedAll}
            <span className="text-xs font-normal text-neutral-500">
              (<bdi>{formatNumber(feed.counts.products, lang)}</bdi>)
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((product) => (
            <ProductCard key={product.id} product={toCard(product)} />
          ))}
        </div>
        {feed.all.length > 12 && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="tap-target rounded-lg border border-black px-6 text-sm font-semibold text-black"
            >
              {showAll
                ? lang === "ar"
                  ? "عرض أقل"
                  : "Réduire"
                : lang === "ar"
                  ? "عرض المزيد"
                  : "Voir plus"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}