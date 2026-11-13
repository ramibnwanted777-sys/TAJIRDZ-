/**
 * Image that resolves a Convex storage id to a signed URL.
 *
 * Centralised so every place that shows an uploaded image uses the same
 * signed-URL lookup and the same graceful fallback.
 */

import { useQuery } from "convex/react";
import { Package } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { placeholderFor } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export function StorageImage({
  storageId,
  alt,
  className,
  seed,
}: {
  storageId: string;
  alt: string;
  className?: string;
  seed?: string;
}) {
  const url = useQuery(api.storage.getUrl, { storageId });
  const { bg, fg } = placeholderFor(seed ?? storageId);

  if (url === undefined) {
    // Signed URL still loading.
    return <div className={cn("skeleton", className)} style={{ backgroundColor: bg }} />;
  }

  if (url === null) {
    return (
      <div
        className={cn("flex items-center justify-center", className)}
        style={{ backgroundColor: bg }}
        role="img"
        aria-label={alt}
      >
        <Package className="size-8" style={{ color: fg }} aria-hidden />
      </div>
    );
  }

  return <img src={url} alt={alt} loading="lazy" decoding="async" className={className} />;
}