/**
 * Category icon.
 *
 * Resolves the string `icon` key carried on a `CATEGORIES` entry to the matching
 * lucide-react component, inside a soft green circle. Replaces the pictograph
 * the category list used to carry, so categories now scale with the icon tokens
 * and inherit colour from the theme instead of rendering an OS-dependent glyph.
 */

import { createElement } from "react";
import {
  Baby,
  Car,
  CookingPot,
  Package,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { type CategoryIconKey } from "@/lib/catalog";
import { useCategories } from "@/hooks/use-categories";
import { cn } from "@/lib/utils";

const ICONS: Record<CategoryIconKey, LucideIcon> = {
  Shirt,
  Smartphone,
  Sparkles,
  CookingPot,
  ShoppingBasket,
  Baby,
  Car,
  Package,
};

/** Icon for a stored icon name, or a neutral package icon when unknown. */
export function iconForKey(name: string): LucideIcon {
  return ICONS[name as CategoryIconKey] ?? Package;
}

export function CategoryIcon({
  categoryKey,
  size = 16,
  className,
}: {
  categoryKey: string;
  /** Stroke size in px; keep to the 16/20/24 icon tokens. */
  size?: number;
  className?: string;
}) {
  // Resolved and instantiated with createElement rather than `<Icon />`: using
  // the component as JSX makes it look like a component defined during render,
  // which would remount it on every render.
  //
  // The icon name comes from the admin-managed table, so a type added in the
  // panel picks up its icon everywhere a card is rendered without a deploy.
  const categories = useCategories();
  const name =
    categories.find((category) => category.key === categoryKey)?.icon ?? "Package";
  return createElement(iconForKey(name), {
    width: size,
    height: size,
    strokeWidth: 1.75,
    "aria-hidden": true,
    className: cn("shrink-0", className),
  });
}

/** Icon pre-wrapped in the soft green circle used on cards and chips. */
export function CategoryBadge({
  categoryKey,
  className,
  tile = true,
}: {
  categoryKey: string;
  className?: string;
  tile?: boolean;
}) {
  if (!tile) return <CategoryIcon categoryKey={categoryKey} className={className} />;
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef6f1]",
        className,
      )}
    >
      <CategoryIcon categoryKey={categoryKey} size={16} />
    </span>
  );
}
