/**
 * The pricing block, shared by the landing page and the Billing page so a
 * visitor never sees two different numbers for the same plan.
 *
 * Structure, in reading order:
 *  1. a cycle toggle with the saving stated on the discounted option;
 *  2. one card per plan: price, then "what you get" as a check list;
 *  3. a feature-by-feature comparison built as a grid of blocks rather than a
 *     table, so it cannot overflow horizontally at 320px.
 *
 * Prices come from `api.pricing.get`, which falls back to the constants in
 * `src/lib/pricing.ts` when an admin has not overridden them.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { Check, Minus, Tag, Zap } from "lucide-react";

import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { interpolate } from "@/lib/i18n";
import { DEFAULT_PRICING } from "@/lib/pricing";
import {
  CYCLES_FOR,
  cycleLabelKey,
  formatPlanPrice,
  savingPercent,
  totalForCycle,
  type BillingCycle,
  type PricingConfig,
} from "@/lib/pricing";

type PlanRow = {
  key: string;
  label: string;
  /** Total paid for this cycle. `0` for a genuinely free plan. */
  total: number;
  cycle: BillingCycle;
  features: string[];
  highlight?: boolean;
  badge?: string;
};

/** Resolve a feature key to display text, keeping dynamic counts live. */
function featureText(
  t: Record<string, string>,
  key: string,
  pricing: PricingConfig,
): string {
  if (key === "upToProducts") return interpolate(t.upToProducts, { n: 20 });
  if (key === "freeContactsNote")
    return interpolate(t.freeContactsNote, {
      n: pricing.retailer.freeContactsPerMonth,
    });
  return t[key] ?? key;
}

function Price({ amount, cycle }: { amount: number; cycle: BillingCycle }) {
  const { lang } = useLang();
  const text = formatPlanPrice(amount, cycle, lang);
  return (
    <p className="text-3xl font-extrabold tracking-tight text-brand-green">
      {/* `<bdi>` isolates the digits from the surrounding RTL sentence. */}
      <bdi dir="ltr">{text}</bdi>
    </p>
  );
}

export function PricingSection({
  audience = "both",
  selectedPlan,
  onSelectPlan,
}: {
  audience?: "wholesaler" | "retailer" | "both";
  selectedPlan?: "basic" | "pro" | "plus";
  onSelectPlan?: (plan: "basic" | "pro" | "plus", cycle: BillingCycle) => void;
}) {
  const { t, lang } = useLang();
  const override = useQuery(api.pricing.get);
  const pricing = override?.pricing ?? DEFAULT_PRICING;

  const [retailerCycle, setRetailerCycle] = useState<BillingCycle>("monthly");
  const [wholesalerCycle, setWholesalerCycle] = useState<BillingCycle>("monthly");

  const showWholesaler = audience === "wholesaler" || audience === "both";
  const showRetailer = audience === "retailer" || audience === "both";

  const retailerTotal = totalForCycle(pricing, "retailer", "plus", retailerCycle);
  const retailerSaving = savingPercent(
    pricing.retailer.plus.monthly,
    retailerCycle,
    retailerTotal,
  );
  const wholesalerTotal = totalForCycle(pricing, "wholesaler", "basic", wholesalerCycle);
  const wholesalerSaving = savingPercent(
    pricing.wholesaler.basic.monthly,
    wholesalerCycle,
    wholesalerTotal,
  );

  const rows: PlanRow[] = [
    ...(showRetailer
      ? ([
          {
            key: "retailer-free",
            label: t.planFree,
            total: 0,
            cycle: "monthly" as const,
            features: ["freeContactsNote", "compareFeature"],
          },
          {
            key: "retailer-plus",
            label: t.planRetailerPlus,
            total: retailerTotal,
            cycle: retailerCycle,
            features: pricing.retailer.plus.features,
            highlight: true,
          },
        ] satisfies PlanRow[])
      : []),
    ...(showWholesaler
      ? ([
          {
            key: "wholesaler-basic",
            label: t.planBasic,
            total: wholesalerTotal,
            cycle: wholesalerCycle,
            features: pricing.wholesaler.basic.features,
            badge: t.firstMonthFreeNote,
          },
          {
            key: "wholesaler-pro",
            label: t.planPro,
            total: totalForCycle(pricing, "wholesaler", "pro", wholesalerCycle),
            cycle: wholesalerCycle,
            features: pricing.wholesaler.pro.features,
            highlight: true,
          },
        ] satisfies PlanRow[])
      : []),
  ];

  // Union of every feature, in first-seen order, for the comparison grid.
  const featureKeys: string[] = [];
  for (const row of rows) {
    for (const key of row.features) {
      if (!featureKeys.includes(key)) featureKeys.push(key);
    }
  }

  return (
    <section aria-labelledby="pricing-heading" className="space-y-6">
      <div className="text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-green-tint px-3 py-1 text-[11px] font-bold text-brand-green-dark">
          <Tag className="size-3" aria-hidden />
          {t.comparePlans}
        </span>
        <h2 id="pricing-heading" className="mt-3 text-2xl font-extrabold text-foreground">
          {t.comparePlans}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.whatYouGet}</p>
      </div>

      {/* ---------------------------------------------------------- toggles */}
      <div className="flex flex-col items-center gap-2">
        {showRetailer && (
          <CycleToggle
            cycles={CYCLES_FOR.retailer}
            value={retailerCycle}
            onChange={setRetailerCycle}
            saving={retailerSaving}
            label={t.chooseCycle}
          />
        )}
        {showWholesaler && (
          <CycleToggle
            cycles={CYCLES_FOR.wholesaler}
            value={wholesalerCycle}
            onChange={setWholesalerCycle}
            saving={wholesalerSaving}
            label={t.chooseCycle}
          />
        )}
      </div>

      {/* ----------------------------------------------------------- plans */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rows.map((row) => {
          const planKey =
            row.key === "wholesaler-basic"
              ? "basic"
              : row.key === "wholesaler-pro"
                ? "pro"
                : row.key === "retailer-plus"
                  ? "plus"
                  : null;
          const isSelected = Boolean(planKey && selectedPlan === planKey);
          const canSelect = Boolean(planKey && onSelectPlan);
          return (
            <article
              key={row.key}
              onClick={() => {
                if (canSelect && planKey) onSelectPlan?.(planKey, row.cycle);
              }}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border-2 p-5 shadow-sm transition-all",
                isSelected || (!selectedPlan && row.highlight)
                  ? "border-brand-green bg-gradient-to-b from-brand-green-tint to-background shadow-md ring-1 ring-brand-green/30"
                  : "border-border bg-card",
                canSelect &&
                  "cursor-pointer hover:-translate-y-0.5 hover:border-brand-green hover:shadow-lg",
              )}
            >
              {(isSelected || (!selectedPlan && row.highlight)) && (
                <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-brand-green to-brand-green-dark" aria-hidden />
              )}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-base font-bold text-foreground">{row.label}</h3>
                {row.badge && (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-green bg-background px-2.5 py-1 text-[11px] font-semibold leading-snug text-brand-green">
                    <Zap className="size-3 shrink-0" aria-hidden />
                    <span>{row.badge}</span>
                  </span>
                )}
              </div>

              <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2">
                <Price amount={row.total} cycle={row.cycle} />
              </div>

              {row.cycle === "yearly" && (
                <p className="mt-2 inline-flex w-fit rounded-full bg-brand-green-tint-strong px-2 py-0.5 text-xs font-semibold text-brand-green-dark">
                  {t.payTenGetTwelve}
                </p>
              )}

              <ul className="mt-4 flex-1 space-y-2.5">
                {row.features.map((key) => (
                  <li
                    key={key}
                    className="flex items-start gap-2 text-sm text-foreground"
                  >
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-green/15">
                      <Check className="size-3 text-brand-green" aria-hidden />
                    </span>
                    <span>{featureText(t, key, pricing)}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      {/* ------------------------------------------------- comparison grid */}
      <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
        <p className="border-b border-border bg-gradient-to-l from-brand-green-tint to-background px-4 py-3 text-sm font-bold text-foreground">
          {t.comparePlans}
        </p>
        <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
          {featureKeys.map((key) => (
            <li key={key} className="bg-background p-3">
              <p className="text-sm text-foreground">
                {featureText(t, key, pricing)}
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {rows.map((row) => {
                  const included =
                    row.features.includes(key) ||
                    (row.key === "retailer-free" && key === "freeContactsNote");
                  return (
                    <li
                      key={`${row.key}-${key}`}
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-medium",
                        included ? "text-brand-green" : "text-muted-foreground",
                      )}
                    >
                      {included ? (
                        <Check className="size-3" aria-hidden />
                      ) : (
                        <Minus className="size-3" aria-hidden />
                      )}
                      <span>{row.label}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-center text-xs text-muted-foreground">{t.firstMonthFreeNote}</p>
      <p className="flex flex-wrap items-center justify-center gap-1 text-center text-xs text-muted-foreground">
        <Tag className="size-3" aria-hidden />
        {t.boostFeature}:
        <bdi dir="ltr">
          {formatPlanPrice(pricing.boost.perWeek, "weekly", lang)}
        </bdi>
      </p>
    </section>
  );
}

function CycleToggle({
  cycles,
  value,
  onChange,
  saving,
  label,
}: {
  cycles: readonly BillingCycle[];
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  saving: number;
  label: string;
}) {
  const { t } = useLang();
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-wrap justify-center gap-1 rounded-lg bg-muted p-1"
    >
      {cycles.map((cycle) => {
        const active = value === cycle;
        return (
          <button
            key={cycle}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(cycle)}
            className={cn(
              "tap-target inline-flex items-center gap-1 rounded-md px-3 text-xs font-semibold",
              active ? "bg-background text-brand-green" : "text-muted-foreground",
            )}
          >
            {t[cycleLabelKey(cycle) as keyof typeof t] as string}
            {cycle !== "monthly" && saving > 0 && (
              <span className="rounded bg-brand-green-tint-strong px-1 py-0.5 text-[10px] font-bold text-brand-green-dark">
                -{saving}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}