/**
 * Admin → Tarifs.
 *
 * The whole price list in one form, written as a single `pricing.set` call so
 * an interrupted edit can never leave half a config behind. Reading is public
 * (`api.pricing.get`), writing is admin-only and audited.
 *
 * The form works on strings: a number input that is allowed to be empty is the
 * only way to type "800" without the browser turning "" into 0 mid-keystroke.
 *
 * Grandfathering note for whoever edits this: changing a price here never
 * touches an existing subscription. A subscription row stores the plan and its
 * own `expiresAt`; the renewal is what reads this config.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { DEFAULT_PRICING, type PricingConfig } from "@/lib/pricing";
import { cn } from "@/lib/utils";

type Fields = {
  basicMonthly: string;
  basicYearly: string;
  proMonthly: string;
  proYearly: string;
  plusMonthly: string;
  plusQuarterly: string;
  plusYearly: string;
  freeContacts: string;
  boostWeek: string;
  vipBasicSlots: string;
  vipProSlots: string;
  promoCode: string;
  promoUsers: string;
  promoMonths: string;
};

const inputClass =
  "tap-target w-full rounded-lg border border-border bg-background px-2 text-sm text-start outline-none focus:border-brand-green";

function toFields(pricing: PricingConfig): Fields {
  return {
    basicMonthly: String(pricing.wholesaler.basic.monthly),
    basicYearly: String(pricing.wholesaler.basic.yearly),
    proMonthly: String(pricing.wholesaler.pro.monthly),
    proYearly: String(pricing.wholesaler.pro.yearly),
    plusMonthly: String(pricing.retailer.plus.monthly),
    plusQuarterly: String(pricing.retailer.plus.quarterly),
    plusYearly: String(pricing.retailer.plus.yearly),
    freeContacts: String(pricing.retailer.freeContactsPerMonth),
    boostWeek: String(pricing.boost.perWeek),
    vipBasicSlots: String(pricing.vip.basicSlots),
    vipProSlots: String(pricing.vip.proSlots),
    promoCode: pricing.promo.code,
    promoUsers: String(pricing.promo.maxUsers),
    promoMonths: String(pricing.promo.freeMonths),
  };
}

const number = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
};

export function AdminPricing() {
  const { t } = useLang();
  const stored = useQuery(api.pricing.get);
  const setPricing = useMutation(api.pricing.set);
  const resetPricing = useMutation(api.pricing.reset);

  const pricing = stored?.pricing ?? DEFAULT_PRICING;
  const [fields, setFields] = useState<Fields | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed from the stored config once it has loaded; a re-render must not wipe
  // whatever the admin has typed.
  const current = fields ?? toFields(pricing);

  const update = (patch: Partial<Fields>) => setFields({ ...current, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      await setPricing({
        pricing: {
          version: DEFAULT_PRICING.version,
          wholesaler: {
            basic: {
              monthly: number(current.basicMonthly, pricing.wholesaler.basic.monthly),
              yearly: number(current.basicYearly, pricing.wholesaler.basic.yearly),
              // Feature lists stay as configured: this form edits money only.
              features: pricing.wholesaler.basic.features,
            },
            pro: {
              monthly: number(current.proMonthly, pricing.wholesaler.pro.monthly),
              yearly: number(current.proYearly, pricing.wholesaler.pro.yearly),
              features: pricing.wholesaler.pro.features,
            },
          },
          retailer: {
            freeContactsPerMonth: number(
              current.freeContacts,
              pricing.retailer.freeContactsPerMonth,
            ),
            plus: {
              monthly: number(current.plusMonthly, pricing.retailer.plus.monthly),
              quarterly: number(current.plusQuarterly, pricing.retailer.plus.quarterly),
              yearly: number(current.plusYearly, pricing.retailer.plus.yearly),
              features: pricing.retailer.plus.features,
            },
          },
          boost: {
            perWeek: number(current.boostWeek, pricing.boost.perWeek),
            durationDays: pricing.boost.durationDays,
          },
          vip: {
            basicSlots: number(current.vipBasicSlots, pricing.vip.basicSlots),
            proSlots: number(current.vipProSlots, pricing.vip.proSlots),
          },
          promo: {
            code: current.promoCode.trim().toUpperCase() || pricing.promo.code,
            maxUsers: number(current.promoUsers, pricing.promo.maxUsers),
            freeMonths: number(current.promoMonths, pricing.promo.freeMonths),
          },
        },
      });
      setFields(null);
      toast.success(t.pricingSaved);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await resetPricing({});
      setFields(null);
      toast.success(t.resetDefaults);
    } catch {
      toast.error(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  if (stored === undefined) return <div className="skeleton h-40 w-full rounded-lg" />;

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        {stored.isDefault ? t.pricingUsingDefaults : t.grandfatherNote}
      </p>

      <Group title={t.planBasic}>
        <Money
          label={`${t.planBasic} · ${t.billingMonthly}`}
          value={current.basicMonthly}
          onChange={(value) => update({ basicMonthly: value })}
        />
        <Money
          label={`${t.planBasic} · ${t.billingYearly}`}
          value={current.basicYearly}
          onChange={(value) => update({ basicYearly: value })}
        />
      </Group>

      <Group title={t.planPro}>
        <Money
          label={`${t.planPro} · ${t.billingMonthly}`}
          value={current.proMonthly}
          onChange={(value) => update({ proMonthly: value })}
        />
        <Money
          label={`${t.planPro} · ${t.billingYearly}`}
          value={current.proYearly}
          onChange={(value) => update({ proYearly: value })}
        />
      </Group>

      <Group title={t.planRetailerPlus}>
        <Money
          label={`${t.planRetailerPlus} · ${t.billingMonthly}`}
          value={current.plusMonthly}
          onChange={(value) => update({ plusMonthly: value })}
        />
        <Money
          label={`${t.planRetailerPlus} · ${t.billingQuarterly}`}
          value={current.plusQuarterly}
          onChange={(value) => update({ plusQuarterly: value })}
        />
        <Money
          label={`${t.planRetailerPlus} · ${t.billingYearly}`}
          value={current.plusYearly}
          onChange={(value) => update({ plusYearly: value })}
        />
        <Money
          label={t.freeContactsPerMonthLabel}
          value={current.freeContacts}
          onChange={(value) => update({ freeContacts: value })}
        />
      </Group>

      <Group title={t.vipGroup}>
        <Money
          label={`${t.planBasic} · ${t.vipSlots}`}
          value={current.vipBasicSlots}
          onChange={(value) => update({ vipBasicSlots: value })}
        />
        <Money
          label={`${t.planPro} · ${t.vipSlots}`}
          value={current.vipProSlots}
          onChange={(value) => update({ vipProSlots: value })}
        />
      </Group>

      <Group title={t.boostFeature}>
        <Money
          label={t.boostFeature}
          value={current.boostWeek}
          onChange={(value) => update({ boostWeek: value })}
        />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            {t.promoCode}
          </span>
          <input
            dir="ltr"
            value={current.promoCode}
            onChange={(event) => update({ promoCode: event.target.value.toUpperCase() })}
            className={inputClass}
          />
        </label>
        <Money
          label={t.promoMaxUsersLabel}
          value={current.promoUsers}
          onChange={(value) => update({ promoUsers: value })}
        />
        <Money
          label={t.promoFreeMonthsLabel}
          value={current.promoMonths}
          onChange={(value) => update({ promoMonths: value })}
        />
      </Group>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="tap-target inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Save className="size-4" aria-hidden />
          {t.save}
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={busy}
          className="tap-target inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm disabled:opacity-60"
        >
          <RotateCcw className="size-4" aria-hidden />
          {t.resetDefaults}
        </button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass)}
      />
    </label>
  );
}
