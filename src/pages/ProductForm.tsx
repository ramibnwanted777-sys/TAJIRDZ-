/**
 * Product create/edit form with client-side image compression and upload to
 * Convex storage.
 */

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "convex/react";
import { Crown, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  MIN_QTY_OPTIONS,
} from "@/lib/catalog";
import { useCategories, useSelectableCategories } from "@/hooks/use-categories";
import { StorageImage } from "@/components/StorageImage";
import { localUploadFetch } from "@/lib/localConvexClient";

const inputClass =
  "tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]";

/** The subset of a product row the form seeds itself from. */
type EditableProduct = Pick<
  Doc<"products">,
  | "name"
  | "category"
  | "wholesalePriceDa"
  | "minQty"
  | "stockStatus"
  | "prepDays"
  | "tags"
  | "priceTiers"
  | "imageStorageIds"
> & { description?: string };

/**
 * Downscale to at most 1600px and re-encode as JPEG. This shrinks the upload
 * and, importantly, drops EXIF metadata including GPS coordinates before the
 * image ever leaves the device.
 */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("encode failed");
  return blob;
}

export function ProductForm({
  productId,
  onClose,
}: {
  productId?: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const existing = useAuthQuery(
    api.wholesaler.myProducts, {});
  const current = existing?.products.find((p) => p._id === productId);

  // Editing waits for the row so the form can be seeded from it in a lazy
  // state initializer instead of being written back from an effect.
  if (productId && !current) {
    return (
      <div className="rounded-lg border border-[#e3e8e5] p-4 text-sm text-neutral-500">
        {t.loading}
      </div>
    );
  }

  return (
    <ProductFormFields
      key={productId ?? "new"}
      productId={productId}
      current={current}
      onClose={onClose}
    />
  );
}

function ProductFormFields({
  productId,
  current,
  onClose,
}: {
  productId?: string;
  current: EditableProduct | undefined;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const createProduct = useMutation(api.wholesaler.createProduct);
  const updateProduct = useMutation(api.wholesaler.updateProduct);
  const createUpload = useMutation(api.storage.createImageUpload);

  const categories = useCategories();
  const selectable = useSelectableCategories();

  // A product that already exists keeps the type it was filed under, even if
  // that type has since been deactivated — its label must not vanish. A new
  // product may only start on a type that can still be chosen.
  const options = useMemo(() => {
    if (!current) return selectable;
    const filed = categories.find((c) => c.key === current.category);
    if (!filed || selectable.some((c) => c.key === filed.key)) return selectable;
    return [filed, ...selectable];
  }, [current, categories, selectable]);


  const [form, setForm] = useState(() => ({
    name: current?.name ?? "",
    category: current?.category ?? "",
    description: current?.description ?? "",
    wholesalePriceDa: current ? String(current.wholesalePriceDa) : "",
    minQty: current?.minQty ?? (MIN_QTY_OPTIONS[0] as number),
    stockStatus: current?.stockStatus ?? ("in_stock" as const),
    prepDays: current?.prepDays ?? 2,
  }));

  // Keep a *new* product on a type that can still be chosen once the list
  // loads. The state starts empty rather than guessing a default from the
  // compiled-in list, which may not match what the admin has since edited, and
  // the fallback is derived rather than written back by an effect: the very
  // first selectable type wins until the operator picks something else.
  const effectiveCategory = useMemo(() => {
    if (current || options.length === 0) return form.category;
    if (options.some((c) => c.key === form.category)) return form.category;
    return options[0].key;
  }, [current, options, form.category]);
  const [tags, setTags] = useState(() => current?.tags.join(", ") ?? "");
  const [tiers, setTiers] = useState<{ minQty: string; priceDa: string }[]>(
    () =>
      current?.priceTiers.map((tier) => ({
        minQty: String(tier.minQty),
        priceDa: String(tier.priceDa),
      })) ?? [],
  );
  const [images, setImages] = useState<string[]>(
    () => current?.imageStorageIds ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImages = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const remaining = MAX_PRODUCT_IMAGES - images.length;
    const selected = Array.from(files).slice(0, remaining);

    for (const file of selected) {
      if (!file.type.startsWith("image/")) {
        setError(t.errImageType);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t.errImageSize);
        continue;
      }
      try {
        const blob = await compressImage(file);
        if (blob.size > MAX_IMAGE_BYTES) {
          setError(t.errImageSize);
          continue;
        }
        const { uploadUrl } = await createUpload({
          kind: "product",
          contentType: "image/jpeg",
          sizeBytes: blob.size,
        });
        const response = await localUploadFetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (!response.ok) throw new Error("upload failed");
        const { storageId } = (await response.json()) as { storageId: string };
        setImages((prev) => [...prev, storageId]);
      } catch {
        setError(t.errGeneric);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const price = Number(form.wholesalePriceDa);
    const trimmedName = form.name.trim();
    const categoryToSubmit = effectiveCategory || options[0]?.key || "other";
    if (!trimmedName || !price || price <= 0) {
      setError(t.errRequired);
      setBusy(false);
      return;
    }

    const parsedTiers = tiers
      .filter((tier) => tier.minQty && tier.priceDa)
      .map((tier) => ({ minQty: Number(tier.minQty), priceDa: Number(tier.priceDa) }));

    if (parsedTiers.some((tier) => tier.priceDa >= price || tier.priceDa <= 0 || tier.minQty <= 0)) {
      setError(t.errTierNotCheaper);
      setBusy(false);
      return;
    }

    try {
      if (productId) {
        await updateProduct({
          productId: productId as never,
          name: trimmedName,
          category: categoryToSubmit,
          description: form.description || undefined,
          wholesalePriceDa: price,
          minQty: form.minQty,
          priceTiers: parsedTiers,
          stockStatus: form.stockStatus,
          prepDays: form.prepDays,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          imageStorageIds: images,
        });
      } else {
        await createProduct({
          name: trimmedName,
          category: categoryToSubmit,
          description: form.description || undefined,
          wholesalePriceDa: price,
          minQty: form.minQty,
          priceTiers: parsedTiers,
          stockStatus: form.stockStatus,
          prepDays: form.prepDays,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          imageStorageIds: images,
        });
      }
      toast.success(t.save);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("errPlanProductLimit")) setError(t.errPlanProductLimit);
      else if (message.includes("errTierNotCheaper")) setError(t.errTierNotCheaper);
      else if (message.includes("errTooManyImages")) setError(t.errTooManyImages);
      else if (message.includes("errRequired")) setError(t.errRequired);
      else if (message.includes("errNotAuthorized")) setError(t.errNotAuthorized);
      else setError(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-[#e3e8e5] p-4">
      <h2 className="mb-4 text-base font-bold text-black">
        {productId ? t.dashEditProduct : t.dashAddProduct}
      </h2>

      {/* VIP entry: a teaser is a separate row with its own privacy rules,
          so the switch leads to the dedicated flow instead of faking one. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <Crown className="size-3.5" aria-hidden />
            {t.vipCreateSwitch}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
            {t.vipCreateHint}
          </p>
        </div>
        <Link
          to="/dashboard/vip"
          className="tap-target inline-flex shrink-0 items-center rounded-lg bg-black px-3 text-xs font-semibold text-amber-400"
        >
          {t.vipOfferTitle}
        </Link>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.productName}
          </span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.productCategory}
          </span>
          <select
            className={inputClass}
            value={effectiveCategory}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {options.map((c) => (
              <option key={c.key} value={c.key}>
                {lang === "ar" ? c.ar : c.fr}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.productDescriptionLabel}
          </span>
          <textarea
            rows={3}
            maxLength={1200}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-[#e3e8e5] px-3 py-2 text-sm outline-none focus:border-[#006233]"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">
              {t.productPrice}
            </span>
            <input
              required
              type="number"
              inputMode="numeric"
              min={1}
              value={form.wholesalePriceDa}
              onChange={(e) => setForm({ ...form, wholesalePriceDa: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">
              {t.productMinQty}
            </span>
            <select
              className={inputClass}
              value={form.minQty}
              onChange={(e) => setForm({ ...form, minQty: Number(e.target.value) })}
            >
              {MIN_QTY_OPTIONS.map((qty) => (
                <option key={qty} value={qty}>
                  {qty}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Quantity price tiers */}
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.productTiers}
          </span>
          {tiers.map((tier, index) => (
            <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder={t.productQuantity}
                value={tier.minQty}
                onChange={(e) => {
                  const next = [...tiers];
                  next[index] = { ...tier, minQty: e.target.value };
                  setTiers(next);
                }}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="numeric"
                placeholder="DA"
                value={tier.priceDa}
                onChange={(e) => {
                  const next = [...tiers];
                  next[index] = { ...tier, priceDa: e.target.value };
                  setTiers(next);
                }}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setTiers(tiers.filter((_, i) => i !== index))}
                aria-label={t.cancel}
                className="tap-target rounded-lg border border-[#e3e8e5] px-3"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
          {tiers.length < 3 && (
            <button
              type="button"
              onClick={() => setTiers([...tiers, { minQty: "", priceDa: "" }])}
              className="tap-target rounded-lg border border-[#e3e8e5] px-4 text-xs"
            >
              +
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">
              {t.productStock}
            </span>
            <select
              className={inputClass}
              value={form.stockStatus}
              onChange={(e) =>
                setForm({ ...form, stockStatus: e.target.value as typeof form.stockStatus })
              }
            >
              <option value="in_stock">{t.inStock}</option>
              <option value="low">{t.lowStock}</option>
              <option value="out">{t.outOfStock}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">
              {t.productPrepTime}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={form.prepDays}
              onChange={(e) => setForm({ ...form, prepDays: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.productTagsLabel}
          </span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={lang === "ar" ? "مفصولة بفاصلة" : "séparés par des virgules"}
            className={inputClass}
          />
        </label>

        {/* Images */}
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.productImages}
          </span>
          <div className="flex flex-wrap gap-2">
            {images.map((storageId) => (
              <div key={storageId} className="relative size-20 overflow-hidden rounded border border-[#e3e8e5]">
                <StorageImage storageId={storageId} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages(images.filter((id) => id !== storageId))}
                  aria-label={t.cancel}
                  className="absolute top-0 end-0 rounded-full bg-black/70 p-0.5 text-white"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            ))}
            {images.length < MAX_PRODUCT_IMAGES && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="tap-target flex size-20 flex-col items-center justify-center gap-1 rounded border border-dashed border-[#006233] text-[#006233]"
              >
                <Upload className="size-4" aria-hidden />
                <span className="text-[10px]">
                  <bdi>
                    {images.length}/{MAX_PRODUCT_IMAGES}
                  </bdi>
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => void onPickImages(e.target.files)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="tap-target flex-1 rounded-lg bg-[#006233] text-sm font-semibold text-white disabled:opacity-60"
        >
          {t.save}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="tap-target rounded-lg border border-[#e3e8e5] px-4 text-sm"
        >
          {t.cancel}
        </button>
      </div>
    </form>
  );
}