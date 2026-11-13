/**
 * Retailer quote requests (RFQ): post a request and review offers received.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, WILAYAS, formatDinar, formatDate } from "@/lib/catalog";
import { EmptyState } from "@/components/marketplace";
import { useAuth } from "@/hooks/use-auth";

export function Quotes() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const requests = useAuthQuery(
    api.contact.myQuoteRequests, {});
  const create = useMutation(api.contact.createQuoteRequest);
  const close = useMutation(api.contact.closeQuoteRequest);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    productName: "",
    category: CATEGORIES[0].key,
    quantity: 100,
    targetPriceDa: "",
    wilaya: user?.wilaya ?? WILAYAS[15].code,
    note: "",
  });

  const inputClass =
    "tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await create({
        productName: form.productName,
        category: form.category,
        quantity: form.quantity,
        targetPriceDa: form.targetPriceDa ? Number(form.targetPriceDa) : undefined,
        wilaya: form.wilaya,
        note: form.note || undefined,
      });
      toast.success(t.quoteSubmit);
      setOpen(false);
      setForm({ ...form, productName: "", note: "" });
      if (result.notified === 0) {
        toast.info(
          lang === "ar"
            ? "ما لقينا حتى تاجر في هاد الفئة والولاية بحد."
            : "Aucun grossiste ne correspond à cette catégorie et wilaya.",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message.includes("errNoLinks") ? t.errNoLinksInPublicText : t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-black">{t.quotesTitle}</h1>
        <button
          onClick={() => setOpen((v) => !v)}
          className="tap-target flex items-center gap-1 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
        >
          {open ? <X className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {t.quoteSubmit}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-[#e3e8e5] p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">
              {t.quoteProduct}
            </span>
            <input
              required
              value={form.productName}
              onChange={(e) => setForm({ ...form, productName: e.target.value })}
              className={inputClass}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.productCategory}
              </span>
              <select
                className={inputClass}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {lang === "ar" ? c.ar : c.fr}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.quoteWilaya}
              </span>
              <select
                className={inputClass}
                value={form.wilaya}
                onChange={(e) => setForm({ ...form, wilaya: Number(e.target.value) })}
              >
                {WILAYAS.map((w) => (
                  <option key={w.code} value={w.code}>
                    {lang === "ar" ? w.ar : w.fr}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.quoteQuantity}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.quoteTargetPrice}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.targetPriceDa}
                onChange={(e) => setForm({ ...form, targetPriceDa: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">{t.quoteNote}</span>
            <textarea
              rows={3}
              maxLength={600}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full rounded-lg border border-[#e3e8e5] px-3 py-2 text-sm outline-none focus:border-[#006233]"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="tap-target inline-flex items-center justify-center w-full rounded-lg bg-[#006233] text-sm font-semibold text-white disabled:opacity-60"
          >
            {t.quoteSubmit}
          </button>
        </form>
      )}

      {requests === undefined ? (
        <div className="skeleton h-32 rounded-lg bg-neutral-100" />
      ) : requests.length === 0 ? (
        <EmptyState title={t.noQuotes} hint={t.quoteSubmit} />
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => (
            <li key={request.id} className="rounded-lg border border-[#e3e8e5] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-black">{request.productName}</h2>
                <span className="text-xs text-neutral-600">
                  {t.quoteExpiresIn} <bdi>{formatDate(request.expiresAt, lang)}</bdi>
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                {t.quoteQuantity}: <bdi>{request.quantity}</bdi>
                {request.targetPriceDa ? ` · ${t.quoteTargetPrice}: ${formatDinar(request.targetPriceDa, lang)}` : ""}
              </p>

              {request.offers.length === 0 ? (
                <p className="mt-2 text-xs text-neutral-500">
                  {lang === "ar" ? "ما وصل حتى عرض بعد." : "Aucune offre reçue pour le moment."}
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {request.offers.map((offer) => (
                    <li
                      key={offer.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-[#eef6f1] px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-black">{offer.shopName}</span>
                      <bdi className="font-bold text-[#006233]">
                        {formatDinar(offer.priceDa, lang)}
                      </bdi>
                    </li>
                  ))}
                </ul>
              )}

              {request.status === "open" && (
                <button
                  onClick={() => close({ requestId: request.id })}
                  className="tap-target mt-3 rounded-lg border border-[#e3e8e5] px-3 text-xs"
                >
                  {lang === "ar" ? "أغلق الطلب" : "Clôturer"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}