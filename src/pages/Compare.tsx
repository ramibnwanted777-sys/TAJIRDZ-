/**
 * Side-by-side comparison of 2-3 products. Selection travels in the URL so a
 * comparison can be shared.
 */

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { DELIVERY_OPTIONS, formatDinar, formatNumber } from "@/lib/catalog";
import { EmptyState, ProductImage } from "@/components/marketplace";

export function Compare() {
  const { t, lang } = useLang();
  const [params] = useSearchParams();
  const ids = useMemo(
    () => (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 3),
    [params],
  );

  const rows = useAuthQuery(
    api.notifications.compareProducts,
    ids.length ? { productIds: ids as never } : "skip",
  );

  if (ids.length === 0 || rows === undefined) {
    return (
      <EmptyState
        title={t.navCompare}
        hint={lang === "ar"
          ? "زيد منتجين باش تقارن بيناتهم."
          : "Ajoutez des produits à comparer."}
        action={
          <Link to="/search" className="mt-2 text-xs font-semibold text-[#006233] underline">
            {t.navSearch}
          </Link>
        }
      />
    );
  }

  const cheapest = rows.reduce(
    (best, row) => (row.effectivePriceDa < best.effectivePriceDa ? row : best),
    rows[0],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-black">{t.navCompare}</h1>

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
        {rows.map((row) => (
          <Link
            key={row.productId}
            to={`/product/${row.slug}`}
            className="w-48 shrink-0 snap-start rounded-lg border border-[#e3e8e5] p-3 hover:border-[#006233] md:w-auto"
          >
            <div className="aspect-square overflow-hidden rounded bg-[#eef6f1]">
              <ProductImage
                storageIds={row.imageStorageIds}
                seed={row.slug}
                alt={row.name}
              />
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-medium text-black">{row.name}</p>
            <p className="mt-1 text-sm font-bold text-[#006233]">
              <bdi>{formatDinar(row.effectivePriceDa, lang)}</bdi>
            </p>
            {row.productId === cheapest.productId && (
              <span className="mt-1 inline-block rounded-full bg-[#006233] px-2 py-0.5 text-[10px] text-white">
                {lang === "ar" ? "الأرخص" : "Le moins cher"}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Attribute table */}
      <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
        <table className="w-full text-sm">
          <tbody>
            {[
              {
                label: t.productWholesalePrice,
                render: (r: (typeof rows)[number]) => (
                  <bdi className="font-bold text-[#006233]">
                    {formatDinar(r.effectivePriceDa, lang)}
                  </bdi>
                ),
              },
              {
                label: t.productMinQty,
                render: (r: (typeof rows)[number]) => <bdi>{formatNumber(r.minQty, lang)}</bdi>,
              },
              {
                label: t.filterRating,
                render: (r: (typeof rows)[number]) => (
                  <bdi>
                    {r.avgProductRating.toFixed(1)}/5 ({r.reviewCount})
                  </bdi>
                ),
              },
              {
                label: t.filterWilaya,
                render: (r: (typeof rows)[number]) => r.wilayaLabel,
              },
              {
                label: t.sellerResponseRate,
                render: (r: (typeof rows)[number]) => (
                  <span className="inline-flex items-center gap-1">
                    {r.shopVerified && (
                      <span className="rounded-full bg-[#006233] px-1.5 text-[10px] text-white">
                        {t.sellerVerified}
                      </span>
                    )}
                    {r.shopName}
                  </span>
                ),
              },
              {
                label: t.deliveryOptions,
                render: (r: (typeof rows)[number]) =>
                  r.deliveryOptions
                    .map((key) => DELIVERY_OPTIONS.find((d) => d.key === key)?.[lang] ?? key)
                    .join(", "),
              },
              {
                label: t.productStock,
                render: (r: (typeof rows)[number]) =>
                  r.stockStatus === "in_stock"
                    ? t.inStock
                    : r.stockStatus === "low"
                      ? t.lowStock
                      : t.outOfStock,
              },
            ].map((row) => (
              <tr key={row.label} className="border-b border-[#e3e8e5] last:border-0">
                <th scope="row" className="p-2 text-start text-xs font-medium text-neutral-600">
                  {row.label}
                </th>
                {rows.map((r) => (
                  <td key={r.productId} className="p-2 text-sm text-black">
                    {row.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}