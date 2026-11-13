/**
 * Retailer favourites: saved products with price-drop and restock indicators.
 */

import { useMutation } from "convex/react";
import { TrendingDown, PackageCheck } from "lucide-react";
import { Link } from "react-router";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { formatDinar, formatNumber } from "@/lib/catalog";
import { EmptyState, ProductCardSkeleton } from "@/components/marketplace";
import { StorageImage } from "@/components/StorageImage";

export function Favorites() {
  const { t, lang } = useLang();
  const favorites = useAuthQuery(
    api.notifications.myFavorites, {});
  const toggle = useMutation(api.wholesaler.toggleFavorite);

  if (favorites === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <EmptyState
        title={t.navFavorites}
        hint={lang === "ar"
          ? "أضف المنتجات اللي تهتمك باش توصلك إشعار عند انخفاض الثمن."
          : "Ajoutez des produits pour être notifié d'une baisse de prix."}
        action={
          <Link to="/search" className="mt-2 text-xs font-semibold text-[#006233] underline">
            {t.navSearch}
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-black">{t.navFavorites}</h1>
      <ul className="space-y-2">
        {favorites.map((fav) => (
          <li
            key={fav.favoriteId}
            className="flex items-center gap-3 rounded-lg border border-[#e3e8e5] p-3"
          >
            <Link to={`/product/${fav.slug}`} className="size-16 shrink-0 overflow-hidden rounded">
              <StorageImage
                storageId={fav.imageStorageIds[0] ?? ""}
                alt={fav.name}
                seed={fav.slug}
                className="size-full object-cover"
              />
            </Link>

            <div className="min-w-0 flex-1">
              <Link to={`/product/${fav.slug}`} className="block truncate text-sm font-medium text-black hover:underline">
                {fav.name}
              </Link>
              <p className="mt-0.5 text-xs text-neutral-600">
                {fav.shopName} · <bdi>{fav.wilayaLabel}</bdi>
              </p>
              <p className="mt-1 text-sm">
                <bdi className="font-bold text-[#006233]">
                  {formatDinar(fav.currentPriceDa, lang)}
                </bdi>
                {fav.priceDropped && (
                  <>
                    {" "}
                    <bdi className="text-xs text-neutral-500 line-through">
                      {formatDinar(fav.priceAtFavoriteDa, lang)}
                    </bdi>
                    <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-[#006233] px-2 py-0.5 text-[10px] font-semibold text-white">
                      <TrendingDown className="size-3" aria-hidden />
                      {lang === "ar" ? "انخفض" : "Baisse"}
                    </span>
                  </>
                )}
              </p>
              {fav.stockStatus === "in_stock" && fav.priceDropped && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#eef6f1] px-2 py-0.5 text-[10px] text-[#006233]">
                  <PackageCheck className="size-3" aria-hidden />
                  {t.inStock}
                </span>
              )}
            </div>

            <button
              onClick={() => toggle({ productId: fav.productId })}
              aria-label={t.removeFavorite}
              className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs"
            >
              {t.cancel}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">
        <bdi>{formatNumber(favorites.length, lang)}</bdi>{" "}
        {lang === "ar" ? "منتج محفوظ" : "produits enregistrés"}
      </p>
    </div>
  );
}