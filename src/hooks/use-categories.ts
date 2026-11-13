/**
 * Product types as the admin manages them.
 *
 * `CATEGORIES` in `src/lib/catalog.ts` is only the *default* list (and the
 * fallback before the table has been migrated). Anything a person can choose
 * from — the product form, the home tiles, the search filter — reads this hook
 * so a type added in the admin panel appears without a deploy.
 *
 * The query returns every type, active or not: a product filed under a
 * deactivated type still has to show its label. Callers that offer a *choice*
 * filter with `selectableCategories`.
 *
 * While the query is still in flight the compiled-in defaults are returned,
 * which is the same list the server would fall back to — so the first paint is
 * correct instead of blank, and there is no flash of an empty select.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { CATEGORIES, type ProductCategory } from "@/lib/catalog";

/** Every product type, ordered, deactivated ones included. */
export function useCategories(): ProductCategory[] {
  const rows = useQuery(api.catalog.categories);
  return rows ?? CATEGORIES;
}

/** Types that may still be picked for a new product. */
export function useSelectableCategories(): ProductCategory[] {
  const rows = useCategories();
  return useMemo(
    () => rows.filter((category) => category.active !== false),
    [rows],
  );
}

/**
 * Key → type map for label lookups inside a render.
 *
 * A hook rather than a per-row hook so it is never called inside a `.map()`.
 */
export function useCategoryByKey(): Map<string, ProductCategory> {
  const rows = useCategories();
  return useMemo(
    () => new Map(rows.map((category) => [category.key, category])),
    [rows],
  );
}
