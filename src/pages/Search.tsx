/**
 * Search and filtering.
 *
 * Every filter lives in the URL query string, so a filtered view is shareable,
 * bookmarkable and survives a refresh — and the server receives exactly what
 * the user sees.
 */

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { WILAYAS, formatNumber } from "@/lib/catalog";
import { useCategories } from "@/hooks/use-categories";
import {
  EmptyState,
  ProductCard,
  ProductGridSkeleton,
} from "@/components/marketplace";

const SORTS = [
  { key: "newest", ar: "الأحدث", fr: "Plus récents" },
  { key: "top_rated", ar: "الأعلى تقييماً", fr: "Mieux notés" },
  { key: "price_asc", ar: "الأرخص", fr: "Prix croissant" },
  { key: "price_desc", ar: "الأغلى", fr: "Prix décroissant" },
  { key: "trending", ar: "الأكثر رواجاً", fr: "Tendance" },
] as const;

export function Search() {
  const { t, lang } = useLang();
  // Types come from the admin-managed table, so a type added in the panel
  // appears in this filter without a deploy.
  const categories = useCategories();
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? undefined;
  const wilaya = params.get("wilaya") ? Number(params.get("wilaya")) : undefined;
  const minPrice = params.get("minPrice") ? Number(params.get("minPrice")) : undefined;
  const maxPrice = params.get("maxPrice") ? Number(params.get("maxPrice")) : undefined;
  const maxMinQty = params.get("maxMinQty") ? Number(params.get("maxMinQty")) : undefined;
  const minRating = params.get("minRating") ? Number(params.get("minRating")) : undefined;
  const winningOnly = params.get("winning") === "1";
  const verifiedOnly = params.get("verified") === "1";
  const inStockOnly = params.get("inStock") === "1";
  const vipOnly = params.get("vip") === "1";
  const sort = params.get("sort") ?? "newest";

  const results = useQuery(api.catalog.search, {
    q: q || undefined,
    category,
    wilaya,
    minPrice,
    maxPrice,
    maxMinQty,
    minRating,
    winningOnly: winningOnly || undefined,
    verifiedOnly: verifiedOnly || undefined,
    inStockOnly: inStockOnly || undefined,
    vipOnly: vipOnly || undefined,
    sort,
  });

  /** Write a filter into the URL; `null` removes it. */
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const activeCount = [
    category,
    wilaya,
    minPrice,
    maxPrice,
    maxMinQty,
    minRating,
    winningOnly,
    verifiedOnly,
    inStockOnly,
    vipOnly,
  ].filter(Boolean).length;

  const clearAll = () => {
    const next = new URLSearchParams();
    const query = params.get("q");
    if (query) next.set("q", query);
    setParams(next, { replace: true });
  };

  const fieldClass =
    "tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]";
  const checkboxClass =
    "tap-target flex items-center gap-2 rounded-lg border border-[#e3e8e5] px-3 py-2 text-sm";

  const title = useMemo(() => {
    if (q) return q;
    if (category) {
      const found = categories.find((c) => c.key === category);
      return found ? (lang === "ar" ? found.ar : found.fr) : category;
    }
    return t.feedAll;
  }, [q, category, lang, categories, t.feedAll]);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* ------------------------------------------------------------ Filters */}
      <aside className="lg:sticky lg:top-[calc(var(--header-height)+16px)] lg:self-start">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className="tap-target flex items-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm font-bold text-black lg:border-0 lg:px-0 lg:pointer-events-none"
          >
            <Filter className="size-4" aria-hidden />
            <span>{t.filters}</span>
            {activeCount > 0 && (
              <span className="rounded-full bg-[#006233] px-2 py-0.5 text-[10px] text-white">
                <bdi>{activeCount}</bdi>
              </span>
            )}
            <span className="lg:hidden">
              {filtersOpen ? (
                <ChevronUp className="size-4 text-neutral-500" aria-hidden />
              ) : (
                <ChevronDown className="size-4 text-neutral-500" aria-hidden />
              )}
            </span>
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="tap-target inline-flex items-center text-xs font-medium text-[#006233] underline"
            >
              {t.clearFilters}
            </button>
          )}
        </div>

        <div className={`mt-3 space-y-4 ${filtersOpen ? "block" : "hidden lg:block"}`}>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700" htmlFor="f-cat">
              {t.filterCategory}
            </label>
            <select
              id="f-cat"
              className={fieldClass}
              value={category ?? ""}
              onChange={(e) => setParam("category", e.target.value || null)}
            >
              <option value="">{t.allCategories}</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {lang === "ar" ? c.ar : c.fr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700" htmlFor="f-wil">
              {t.filterWilaya}
            </label>
            <select
              id="f-wil"
              className={fieldClass}
              value={wilaya ?? ""}
              onChange={(e) => setParam("wilaya", e.target.value || null)}
            >
              <option value="">{t.allWilayas}</option>
              {WILAYAS.map((w) => (
                <option key={w.code} value={w.code}>
                  {lang === "ar" ? w.ar : w.fr}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="mb-1 text-xs font-medium text-neutral-700">{t.filterPrice}</legend>
            <div className="flex items-center gap-2">
              <input
                key={`min-${minPrice ?? ""}`}
                type="number"
                inputMode="numeric"
                autoComplete="off"
                min={0}
                placeholder={t.filterMinPrice}
                aria-label={t.filterMinPrice}
                className={fieldClass}
                defaultValue={minPrice ?? ""}
                onBlur={(e) => setParam("minPrice", e.target.value || null)}
              />
              <input
                key={`max-${maxPrice ?? ""}`}
                type="number"
                inputMode="numeric"
                autoComplete="off"
                min={0}
                placeholder={t.filterMaxPrice}
                aria-label={t.filterMaxPrice}
                className={fieldClass}
                defaultValue={maxPrice ?? ""}
                onBlur={(e) => setParam("maxPrice", e.target.value || null)}
              />
            </div>
          </fieldset>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700" htmlFor="f-qty">
              {t.filterMinQty}
            </label>
            <select
              id="f-qty"
              className={fieldClass}
              value={maxMinQty ?? ""}
              onChange={(e) => setParam("maxMinQty", e.target.value || null)}
            >
              <option value="">{lang === "ar" ? "الكل" : "Toutes"}</option>
              <option value="10">≤ 10</option>
              <option value="50">≤ 50</option>
              <option value="100">≤ 100</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700" htmlFor="f-rating">
              {t.filterRating}
            </label>
            <select
              id="f-rating"
              className={fieldClass}
              value={minRating ?? ""}
              onChange={(e) => setParam("minRating", e.target.value || null)}
            >
              <option value="">{lang === "ar" ? "الكل" : "Toutes"}</option>
              <option value="4">4+</option>
              <option value="4.5">4.5+</option>
              <option value="4.8">4.8+</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={winningOnly}
                onChange={(e) => setParam("winning", e.target.checked ? "1" : null)}
              />
              <span>{t.filterWinningOnly}</span>
            </label>
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setParam("verified", e.target.checked ? "1" : null)}
              />
              <span>{t.filterVerifiedOnly}</span>
            </label>
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setParam("inStock", e.target.checked ? "1" : null)}
              />
              <span>{t.filterInStockOnly}</span>
            </label>
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={vipOnly}
                onChange={(e) => setParam("vip", e.target.checked ? "1" : null)}
              />
              <span>{t.vipOnlyFilter}</span>
            </label>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------ Results */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-black">{title}</h1>
            {results !== undefined && (
              <p className="text-xs text-neutral-600">
                <bdi>{formatNumber(results.total, lang)}</bdi> {t.resultsCount}
              </p>
            )}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label htmlFor="sort" className="shrink-0 text-xs font-medium text-neutral-700">
              {t.sortBy}
            </label>
            <select
              id="sort"
              className="tap-target flex-1 rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233] sm:flex-initial"
              value={sort}
              onChange={(e) => setParam("sort", e.target.value)}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {lang === "ar" ? s.ar : s.fr}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active filter chips, each individually removable. */}
        {activeCount > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {category && (
              <FilterChip
                label={categories.find((c) => c.key === category)?.[lang] ?? category}
                onClear={() => setParam("category", null)}
              />
            )}
            {wilaya && (
              <FilterChip
                label={WILAYAS.find((w) => w.code === wilaya)?.[lang] ?? String(wilaya)}
                onClear={() => setParam("wilaya", null)}
              />
            )}
            {(minPrice || maxPrice) && (
              <FilterChip
                label={`${minPrice ?? 0} – ${maxPrice ?? "∞"} DA`}
                onClear={() => {
                  setParam("minPrice", null);
                  setParam("maxPrice", null);
                }}
              />
            )}
            {winningOnly && (
              <FilterChip label={t.winningBadge} onClear={() => setParam("winning", null)} />
            )}
            {verifiedOnly && (
              <FilterChip
                label={t.filterVerifiedOnly}
                onClear={() => setParam("verified", null)}
              />
            )}
            {inStockOnly && (
              <FilterChip label={t.filterInStockOnly} onClear={() => setParam("inStock", null)} />
            )}
            {vipOnly && (
              <FilterChip label={t.vipOnlyFilter} onClear={() => setParam("vip", null)} />
            )}
          </div>
        )}

        {results === undefined ? (
          <ProductGridSkeleton count={12} />
        ) : results.results.length === 0 ? (
          <EmptyState
            title={t.feedEmpty}
            hint={t.feedEmptyHint}
            action={
              activeCount > 0 ? (
                <button
                  onClick={clearAll}
                  className="tap-target mt-2 rounded-lg border border-black px-4 py-2 text-xs font-semibold text-black"
                >
                  {t.clearFilters}
                </button>
              ) : (
                <Link to="/" className="mt-2 text-xs font-semibold text-[#006233] underline">
                  {t.navHome}
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {results.results.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#006233] px-2.5 py-1 text-xs text-[#006233]">
      {label}
      <button
        onClick={onClear}
        aria-label="remove filter"
        className="-my-2 -me-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-[#006233]"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}