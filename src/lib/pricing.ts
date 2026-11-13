import { formatNumber } from "./catalog";

/**
 * Pricing — the single source of truth for what TajirDz charges.
 *
 * Everything about money lives here as *defaults*: the constants below are the
 * only place a price is written down. `src/convex/pricing.ts` overrides them at
 * runtime from the `appConfig` table, so an admin can change a price without a
 * deploy, but a missing or corrupt override always falls back to this file
 * rather than to a blank screen.
 *
 * Cycle maths is explicit rather than implied by `price * months`: the yearly
 * wholesaler plan is "pay 10 months, get 12", so the discount has to be stated
 * as a total, not derived from a monthly figure.
 *
 * Grandfathering lives in `subscriptions`, not here. A subscription row stores
 * the plan and `expiresAt` at purchase time; nothing on the live subscription
 * reads this config again until renewal, so changing a price can never disturb
 * somebody who has already paid.
 */

export type BillingCycle = "monthly" | "quarterly" | "yearly" | "weekly";

export type AudiencePlans = {
  /** Headline price per month, before any cycle discount. */
  monthly: number;
  /** Total for a year (10 months of payment for 12 months of service). */
  yearly: number;
  /** Feature list keys, rendered with a check icon. */
  features: string[];
};

export type PricingConfig = {
  /** Bumped when the shape changes so old stored blobs are discarded. */
  version: number;
  wholesaler: {
    basic: AudiencePlans;
    pro: AudiencePlans;
  };
  retailer: {
    /** Contacts a free retailer gets per calendar month. */
    freeContactsPerMonth: number;
    plus: {
      monthly: number;
      quarterly: number;
      yearly: number;
      features: string[];
    };
  };
  boost: {
    perWeek: number;
    durationDays: number;
  };
  /**
   * VIP product slots per plan: how many protected products a wholesaler may
   * run at once. Edited from the admin Pricing tab like every other number
   * here, so a launch promotion does not need a deploy.
   */
  vip: {
    basicSlots: number;
    proSlots: number;
  };
  promo: {
    code: string;
    /** How many users may redeem it. */
    maxUsers: number;
    /** Months granted per redemption (1 == one free month). */
    freeMonths: number;
  };
};

export const PRICING_VERSION = 1;

/**
 * Launch pricing for the Algerian market, in dinars.
 *
 * Deliberately rounded figures: the local market prices monthly subscriptions
 * in hundreds of dinars, and a figure like 800 reads as a deliberate price
 * rather than a conversion from another currency.
 */
export const DEFAULT_PRICING: PricingConfig = {
  version: PRICING_VERSION,
  wholesaler: {
    basic: {
      monthly: 800,
      yearly: 8000, // 10 months paid, 12 months served
      features: ["upToProducts", "freeContactsNote"],
    },
    pro: {
      monthly: 1800,
      yearly: 18000, // 10 months paid, 12 months served
      features: [
        "unlimitedProducts",
        "verifiedPriority",
        "statsFeature",
        "featuredSlots",
        "boostFeature",
      ],
    },
  },
  retailer: {
    freeContactsPerMonth: 3,
    plus: {
      monthly: 300,
      quarterly: 800, // 900 bought as 800
      yearly: 2500, // 3600 bought as 2500
      features: [
        "unlimitedContacts",
        "priceDropAlerts",
        "quoteRequests",
        "compareFeature",
      ],
    },
  },
  boost: {
    perWeek: 200,
    durationDays: 7,
  },
  vip: {
    basicSlots: 1,
    proSlots: 5,
  },
  promo: {
    code: "TAJIR-FREE",
    maxUsers: 10,
    freeMonths: 1,
  },
};

// ---------------------------------------------------------------------------
// Normalisation: a stored config is untrusted, so it is rebuilt field by field
// ---------------------------------------------------------------------------

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function plan(value: unknown, fallback: AudiencePlans): AudiencePlans {
  const v = (value ?? {}) as Partial<AudiencePlans>;
  return {
    monthly: num(v.monthly, fallback.monthly),
    yearly: num(v.yearly, fallback.yearly),
    features: Array.isArray(v.features) ? v.features.map(String) : fallback.features,
  };
}

function audiencePlans(
  value: unknown,
  fallback: AudiencePlans,
): AudiencePlans {
  return plan(value, fallback);
}

/**
 * Turn whatever is in storage (or nothing at all) into a complete config.
 *
 * Every field falls back individually, so an admin who edits one price cannot
 * accidentally wipe the others.
 */
export function pricingFromRaw(raw: unknown): PricingConfig {
  const d = DEFAULT_PRICING;
  if (!raw || typeof raw !== "object") return d;
  const v = raw as Partial<PricingConfig>;

  const wholesaler = (v.wholesaler ?? {}) as Partial<
    PricingConfig["wholesaler"]
  >;
  const retailer = (v.retailer ?? {}) as Partial<PricingConfig["retailer"]>;
  const boost = (v.boost ?? {}) as Partial<PricingConfig["boost"]>;
  const vip = v.vip as Partial<PricingConfig["vip"]> | undefined;
  const promo = (v.promo ?? {}) as Partial<PricingConfig["promo"]>;

  return {
    version: PRICING_VERSION,
    wholesaler: {
      basic: audiencePlans(wholesaler.basic, d.wholesaler.basic),
      pro: audiencePlans(wholesaler.pro, d.wholesaler.pro),
    },
    retailer: {
      freeContactsPerMonth: num(
        retailer.freeContactsPerMonth,
        d.retailer.freeContactsPerMonth,
      ),
      plus: {
        monthly: num(retailer.plus?.monthly, d.retailer.plus.monthly),
        quarterly: num(retailer.plus?.quarterly, d.retailer.plus.quarterly),
        yearly: num(retailer.plus?.yearly, d.retailer.plus.yearly),
        features: Array.isArray(retailer.plus?.features)
          ? retailer.plus.features.map(String)
          : d.retailer.plus.features,
      },
    },
    boost: {
      perWeek: num(boost.perWeek, d.boost.perWeek),
      durationDays: num(boost.durationDays, d.boost.durationDays),
    },
    vip: {
      basicSlots: num(vip?.basicSlots, d.vip.basicSlots),
      proSlots: num(vip?.proSlots, d.vip.proSlots),
    },
    promo: {
      code: typeof promo.code === "string" && promo.code.trim()
        ? promo.code.trim().toUpperCase()
        : d.promo.code,
      maxUsers: num(promo.maxUsers, d.promo.maxUsers),
      freeMonths: num(promo.freeMonths, d.promo.freeMonths),
    },
  };
}

// ---------------------------------------------------------------------------
// Cycle maths
// ---------------------------------------------------------------------------

/** The total a cycle actually costs, before any saving is mentioned. */
export function totalForCycle(
  pricing: PricingConfig,
  audience: "wholesaler" | "retailer",
  planKey: "basic" | "pro" | "plus",
  cycle: BillingCycle,
): number {
  if (audience === "retailer") {
    const p = pricing.retailer.plus;
    if (cycle === "quarterly") return p.quarterly;
    if (cycle === "yearly") return p.yearly;
    return p.monthly;
  }
  const p = planKey === "pro" ? pricing.wholesaler.pro : pricing.wholesaler.basic;
  if (cycle === "yearly") return p.yearly;
  return p.monthly;
}

/** How many months a cycle buys (yearly buys 12 for the price of 10). */
export function monthsForCycle(cycle: BillingCycle): number {
  if (cycle === "yearly") return 12;
  if (cycle === "quarterly") return 3;
  if (cycle === "weekly") return 0;
  return 1;
}

/**
 * Saving as a whole percentage against paying monthly.
 *
 * Rounded down: 11.1% never gets advertised as 12%.
 */
export function savingPercent(
  monthly: number,
  cycle: BillingCycle,
  total: number,
): number {
  const months = monthsForCycle(cycle);
  if (months === 0 || monthly <= 0 || total <= 0) return 0;
  const full = monthly * months;
  if (full <= total) return 0;
  return Math.floor(((full - total) / full) * 100);
}

/** Which cycles an audience can actually pick. */
export const CYCLES_FOR = {
  wholesaler: ["monthly", "yearly"],
  retailer: ["monthly", "quarterly", "yearly"],
} as const satisfies Record<string, readonly BillingCycle[]>;

export function cycleLabelKey(cycle: BillingCycle): string {
  if (cycle === "yearly") return "billingYearly";
  if (cycle === "quarterly") return "billingQuarterly";
  if (cycle === "weekly") return "pricePerWeek";
  return "billingMonthly";
}

/**
 * "800 دج / شهر" (ar) and "800 DA / mois" (fr).
 *
 * The amount is rendered as its own `<bdi>` by callers, so this returns plain
 * text and the layout decides the bidi isolation.
 */
export function formatPlanPrice(
  amount: number,
  cycle: BillingCycle,
  lang: "ar" | "fr",
): string {
  const suffix = lang === "ar"
    ? { monthly: "شهر", quarterly: "3 أشهر", yearly: "سنة", weekly: "أسبوع" }[cycle]
    : { monthly: "mois", quarterly: "3 mois", yearly: "an", weekly: "semaine" }[cycle];
  const unit = lang === "ar" ? "دج" : "DA";
  const total = lang === "ar" ? formatNumber(amount, lang) : formatNumber(amount, lang);
  return `${total} ${unit} / ${suffix}`;
}

export function cycleSuffixKey(cycle: BillingCycle): string {
  if (cycle === "yearly") return "pricePerYear";
  if (cycle === "quarterly") return "pricePerQuarter";
  if (cycle === "weekly") return "pricePerWeek";
  return "pricePerMonth";
}
