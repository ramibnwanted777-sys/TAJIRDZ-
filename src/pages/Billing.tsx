/**
 * Billing: subscription status, promo redemption, plan selection, payment
 * receipt upload and payment history.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Tag, Upload, Check } from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { formatDinar, formatDate } from "@/lib/catalog";
import { useAuth } from "@/hooks/use-auth";
import { PricingSection } from "@/components/PricingSection";
import { localUploadFetch } from "@/lib/localConvexClient";
import {
  CYCLES_FOR,
  DEFAULT_PRICING,
  cycleSuffixKey,
  totalForCycle,
  type BillingCycle,
} from "@/lib/pricing";

export function Billing() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const sub = useAuthQuery(api.billing.mySubscription, {});
  const payments = useAuthQuery(api.billing.myPayments, {});
  const providers = useAuthQuery(api.billing.paymentProviders, {});
  const pricingQuery = useQuery(api.pricing.get);

  const redeem = useMutation(api.billing.redeemPromoCode);
  const submitPayment = useMutation(api.billing.submitPayment);
  const createUpload = useMutation(api.storage.createDocumentUpload);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro">("basic");
  const [customAmount, setCustomAmount] = useState<string | null>(null);
  const [method, setMethod] = useState<"bank" | "ccp" | "baridi">("ccp");
  const [reference, setReference] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [receiptId, setReceiptId] = useState<string | undefined>();

  const isWholesaler = user?.role === "wholesaler";
  const audience = isWholesaler ? "wholesaler" : "retailer";
  const pricing = pricingQuery?.pricing ?? DEFAULT_PRICING;

  const expectedAmount = totalForCycle(
    pricing,
    isWholesaler ? "wholesaler" : "retailer",
    isWholesaler ? selectedPlan : "plus",
    cycle,
  );
  const amountValue = customAmount ?? String(expectedAmount);

  const planLabel = (plan: string | null | undefined, rowAudience?: string) => {
    if (plan === "trial") return t.planTrial;
    if (plan === "basic") return t.planBasic;
    if (plan === "pro") return t.planPro;
    if (plan === "free") {
      return (rowAudience ?? audience) === "retailer" ? t.planRetailerPlus : t.planFree;
    }
    return plan ?? t.planFree;
  };

  const statusLabel = (status: string) => {
    if (status === "approved") return lang === "ar" ? "مقبول" : "Approuvé";
    if (status === "rejected") return lang === "ar" ? "مرفوض" : "Refusé";
    return lang === "ar" ? "قيد المراجعة" : "En attente";
  };

  const onRedeem = async () => {
    setBusy(true);
    try {
      await redeem({ code: code.trim() });
      toast.success(t.promoApplied);
      setCode("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("promoUsed")) toast.error(t.promoUsed);
      else if (message.includes("promoAlreadyUsed")) {
        toast.error(lang === "ar" ? "استعملتي هاد الكود من قبل" : "Code déjà utilisé");
      } else if (message.includes("promoWrongAudience")) {
        toast.error(lang === "ar" ? "هاد الكود ماشي لهاد النوع" : "Code non valide pour ce type");
      } else {
        toast.error(t.promoInvalid);
      }
    } finally {
      setBusy(false);
    }
  };

  const onReceipt = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await new Blob([await file.arrayBuffer()], { type: file.type });
      const { uploadUrl } = await createUpload({
        contentType: file.type,
        sizeBytes: blob.size,
      });
      const response = await localUploadFetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: blob,
      });
      if (!response.ok) throw new Error("upload failed");
      const { storageId } = (await response.json()) as { storageId: string };
      setReceiptId(storageId);
      toast.success(t.uploadReceipt);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const onSubmitPayment = async () => {
    const parsedAmount = Number(amountValue);
    if (!reference.trim() || !parsedAmount || parsedAmount <= 0) {
      toast.error(t.errRequired);
      return;
    }
    setBusy(true);
    try {
      await submitPayment({
        audience,
        plan: isWholesaler ? selectedPlan : "free",
        amountDa: parsedAmount,
        method,
        reference: reference.trim(),
        receiptStorageId: receiptId,
      });
      toast.success(lang === "ar" ? "تم إرسال وصل الدفع" : "Reçu envoyé");
      setReference("");
      setCustomAmount(null);
      setReceiptId(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message.includes("errDuplicatePayment") ? t.errDuplicatePayment : t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]";

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-black">{t.billingTitle}</h1>

      {/* Status */}
      <section className="rounded-lg border border-[#e3e8e5] p-4">
        {sub?.isActive ? (
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 size-5 shrink-0 text-[#006233]" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-black">{t.subscriptionActive}</p>
              <p className="text-xs text-neutral-600">
                {planLabel(sub.plan)} · {t.expiresOn}{" "}
                <bdi>{formatDate(sub.expiresAt ?? 0, lang)}</bdi>
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-black">{t.subscriptionInactive}</p>
            <p className="mt-1 text-xs text-neutral-600">{t.subscriptionHiddenNote}</p>
          </div>
        )}
        {sub?.isActive && sub.inGrace && (
          <p className="mt-2 text-xs text-amber-700">{t.graceNote}</p>
        )}
      </section>

      {/* Promo code */}
      <section className="rounded-lg border border-[#e3e8e5] p-4">
        <h2 className="text-sm font-bold text-black">{t.promoCode}</h2>
        <p className="mt-1 text-xs text-neutral-600">
          {lang === "ar"
            ? `كود ${pricing.promo.code} يعطيك ${pricing.promo.freeMonths === 1 ? "شهراً واحداً مجاناً" : `${pricing.promo.freeMonths} شهور مجاناً`} (أول ${pricing.promo.maxUsers} مستخدمين).`
            : `Le code ${pricing.promo.code} offre ${pricing.promo.freeMonths} mois gratuits (${pricing.promo.maxUsers} premiers utilisateurs).`}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t.promoPlaceholder}
            dir="ltr"
            className={`${inputClass} flex-1 text-start`}
          />
          <button
            type="button"
            onClick={onRedeem}
            disabled={busy || !code.trim()}
            className="tap-target inline-flex items-center justify-center gap-1 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Tag className="size-4" aria-hidden />
            {t.redeem}
          </button>
        </div>
      </section>

      {/* Plans: one shared block, so the landing page and this page cannot
          quote different prices for the same plan. */}
      <section aria-labelledby="billing-plans">
        <h2 id="billing-plans" className="mb-3 text-sm font-bold text-foreground">
          {t.whatYouGet}
        </h2>
        <PricingSection
          audience={audience}
          selectedPlan={isWholesaler ? selectedPlan : "plus"}
          onSelectPlan={(plan, pickedCycle) => {
            if (isWholesaler && (plan === "basic" || plan === "pro")) {
              setSelectedPlan(plan);
            }
            setCycle(pickedCycle);
            setCustomAmount(null);
          }}
        />

        {/* The amount to pay is derived from the active plan and cycle selector */}
        <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
          {isWholesaler && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t.comparePlans}
              </span>
              <div
                role="tablist"
                aria-label={t.comparePlans}
                className="flex gap-1 rounded-lg bg-muted p-1"
              >
                {(["basic", "pro"] as const).map((planKey) => (
                  <button
                    key={planKey}
                    type="button"
                    role="tab"
                    aria-selected={selectedPlan === planKey}
                    onClick={() => {
                      setSelectedPlan(planKey);
                      setCustomAmount(null);
                    }}
                    className={`tap-target rounded-md px-3 text-xs font-semibold ${
                      selectedPlan === planKey
                        ? "bg-background text-brand-green"
                        : "text-muted-foreground"
                    }`}
                  >
                    {planKey === "basic" ? t.planBasic : t.planPro}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t.amountToPay}
              </p>
              <p className="text-xl font-bold text-brand-green">
                <bdi dir="ltr">
                  {formatDinar(expectedAmount, lang)}{" "}
                  {t[cycleSuffixKey(cycle) as keyof typeof t] as string}
                </bdi>
              </p>
            </div>
            <div
              role="tablist"
              aria-label={t.chooseCycle}
              className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
            >
              {(isWholesaler ? CYCLES_FOR.wholesaler : CYCLES_FOR.retailer).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={cycle === option}
                    onClick={() => {
                      setCycle(option as BillingCycle);
                      setCustomAmount(null);
                    }}
                    className={`tap-target rounded-md px-3 text-xs font-semibold ${
                      cycle === option
                        ? "bg-background text-brand-green"
                        : "text-muted-foreground"
                    }`}
                  >
                    {t[option as keyof typeof t] as string}
                  </button>
                ),
              )}
            </div>
          </div>
          {sub?.isActive && (
            <p className="text-xs text-muted-foreground">{t.grandfatherNote}</p>
          )}
        </div>
      </section>

      {/* Payment */}
      <section className="rounded-lg border border-[#e3e8e5] p-4">
        <h2 className="text-sm font-bold text-black">{t.payViaTransfer}</h2>
        {providers?.map((provider) => (
          <p key={provider.slug} className="mt-1 text-xs leading-relaxed text-neutral-600">
            {lang === "ar" ? provider.instructionsAr : provider.instructionsFr}
          </p>
        ))}

        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {t.filterPrice}
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={amountValue}
                onChange={(e) => setCustomAmount(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                {lang === "ar" ? "طريقة الدفع" : "Méthode"}
              </span>
              <select
                className={inputClass}
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
              >
                <option value="ccp">CCP</option>
                <option value="bank">{lang === "ar" ? "بنك" : "Banque"}</option>
                <option value="baridi">BaridiMob</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">
              {lang === "ar" ? "رقم العملية" : "Référence"}
            </span>
            <input
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={`${inputClass} text-start`}
            />
          </label>

          <label className="tap-target flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#006233] px-4 text-sm text-[#006233]">
            <Upload className="size-4" aria-hidden />
            {t.uploadReceipt}
            <input
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={(e) => void onReceipt(e.target.files?.[0])}
            />
          </label>
          {receiptId && (
            <p className="text-xs text-[#006233]">
              <Check className="inline size-3" aria-hidden />{" "}
              {lang === "ar" ? "الوصل مرفوع" : "Reçu téléversé"}
            </p>
          )}

          <button
            type="button"
            onClick={onSubmitPayment}
            disabled={busy || !reference.trim() || !amountValue || Number(amountValue) <= 0}
            className="tap-target inline-flex w-full items-center justify-center rounded-lg bg-[#006233] text-sm font-semibold text-white disabled:opacity-60"
          >
            {t.save}
          </button>
        </div>
      </section>

      {/* History */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-black">{t.paymentHistory}</h2>
        <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e3e8e5] text-xs text-neutral-600">
              <tr>
                <th className="p-2 text-start">{lang === "ar" ? "المرجع" : "Référence"}</th>
                <th className="p-2 text-end">{t.filterPrice}</th>
                <th className="p-2 text-end">{lang === "ar" ? "الحالة" : "Statut"}</th>
              </tr>
            </thead>
            <tbody>
              {(payments?.payments ?? []).map((row) => (
                <tr key={row.id} className="border-b border-[#e3e8e5] last:border-0">
                  <td className="p-2">
                    <bdi dir="ltr">{row.reference}</bdi>
                    <span className="mt-0.5 block text-[11px] text-neutral-500">
                      {planLabel(row.plan, row.audience)}
                    </span>
                  </td>
                  <td className="p-2 text-end">
                    <bdi>{formatDinar(row.amountDa, lang)}</bdi>
                  </td>
                  <td className="p-2 text-end">
                    <span
                      className={
                        row.status === "approved"
                          ? "text-[#006233]"
                          : row.status === "rejected"
                            ? "text-red-600"
                            : "text-neutral-600"
                      }
                    >
                      {statusLabel(row.status)}
                    </span>
                    {row.rejectReason && (
                      <span className="mt-0.5 block text-[11px] text-red-600">
                        {row.rejectReason}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(payments?.invoices.length ?? 0) > 0 && (
          <p className="mt-2 text-xs text-neutral-600">
            {lang === "ar" ? "الفواتير" : "Factures"}:{" "}
            {payments?.invoices.map((i) => i.number).join(", ")}
          </p>
        )}
      </section>
    </div>
  );
}