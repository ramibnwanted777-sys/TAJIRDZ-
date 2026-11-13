/**
 * Shared domain constants and pure helpers for TajirDz.
 * No React, no Convex imports: this module is safe on client and server.
 */

// ---------------------------------------------------------------------------
// Roles and plans
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMIN: "admin",
  WHOLESALER: "wholesaler",
  RETAILER: "retailer",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PLAN_LIMITS = {
  trial: { products: 15, label: "تجربة" },
  free: { products: 3, label: "مجاني" },
  basic: { products: 30, label: "أساسي" },
  pro: { products: Number.POSITIVE_INFINITY, label: "احترافي" },
} as const;

export type PlanKey = keyof typeof PLAN_LIMITS;

// Prices deliberately do not live here any more. `src/lib/pricing.ts` holds the
// single price list, and `src/convex/pricing.ts` lets an admin override it at
// run time. This file only knows what a *plan* allows (products per plan),
// which is a policy number rather than a price. A second copy of the numbers
// here is exactly how a page ends up advertising a price the checkout does not
// charge.

/** How long a product boost runs. Not a price. */
export const BOOST_DURATION_DAYS = 7;
export const REVIEW_DELAY_HOURS = 48;
export const QUOTE_EXPIRY_DAYS = 7;
export const GRACE_PERIOD_DAYS = 3;
export const PROMO_FIRST_N_USERS = 10;
export const MAX_PRODUCT_IMAGES = 5;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Quantity tiers wholesalers can pick from when adding a product. */
export const MIN_QTY_OPTIONS = [10, 50, 100] as const;

// ---------------------------------------------------------------------------
// Wilayas (58) with their Arabic names and codes.
// ---------------------------------------------------------------------------

export const WILAYAS: { code: number; ar: string; fr: string }[] = [
  { code: 1, ar: "أدرار", fr: "Adrar" },
  { code: 2, ar: "الشلف", fr: "Chlef" },
  { code: 3, ar: "الأغواط", fr: "Laghouat" },
  { code: 4, ar: "أم البواقي", fr: "Oum El Bouaghi" },
  { code: 5, ar: "باتنة", fr: "Batna" },
  { code: 6, ar: "بجاية", fr: "Bejaia" },
  { code: 7, ar: "بسكرة", fr: "Biskra" },
  { code: 8, ar: "بشار", fr: "Bechar" },
  { code: 9, ar: "البليدة", fr: "Blida" },
  { code: 10, ar: "البويرة", fr: "Bouira" },
  { code: 11, ar: "تمنراست", fr: "Tamanrasset" },
  { code: 12, ar: "تبسة", fr: "Tbessa" },
  { code: 13, ar: "تلمسان", fr: "Tlemcen" },
  { code: 14, ar: "تيارت", fr: "Tiaret" },
  { code: 15, ar: "تيزي وزو", fr: "Tizi Ouzou" },
  { code: 16, ar: "الجزائر", fr: "Alger" },
  { code: 17, ar: "الجلفة", fr: "Djelfa" },
  { code: 18, ar: "جيجل", fr: "Jijel" },
  { code: 19, ar: "سطيف", fr: "Setif" },
  { code: 20, ar: "سعيدة", fr: "Saida" },
  { code: 21, ar: "سكيكدة", fr: "Skikda" },
  { code: 22, ar: "سيدي بلعباس", fr: "Sidi Bel Abbes" },
  { code: 23, ar: "عنابة", fr: "Annaba" },
  { code: 24, ar: "قالمة", fr: "Guelma" },
  { code: 25, ar: "قسنطينة", fr: "Constantine" },
  { code: 26, ar: "المدية", fr: "Medea" },
  { code: 27, ar: "مستغانم", fr: "Mostaganem" },
  { code: 28, ar: "المسيلة", fr: "M'Sila" },
  { code: 29, ar: "معسكر", fr: "Mascara" },
  { code: 30, ar: "ورقلة", fr: "Ouargla" },
  { code: 31, ar: "وهران", fr: "Oran" },
  { code: 32, ar: "البيض", fr: "El Bayadh" },
  { code: 33, ar: "إليزي", fr: "Illizi" },
  { code: 34, ar: "برج بوعريريج", fr: "Bordj Bou Arreridj" },
  { code: 35, ar: "بومرداس", fr: "Boumerdes" },
  { code: 36, ar: "الطارف", fr: "El Tarf" },
  { code: 37, ar: "تندوف", fr: "Tindouf" },
  { code: 38, ar: "تيسمسيلت", fr: "Tissemsilt" },
  { code: 39, ar: "الوادي", fr: "El Oued" },
  { code: 40, ar: "خنشلة", fr: "Khenchela" },
  { code: 41, ar: "سوق أهراس", fr: "Souk Ahras" },
  { code: 42, ar: "تيبازة", fr: "Tipaza" },
  { code: 43, ar: "ميلة", fr: "Mila" },
  { code: 44, ar: "عين الدفلى", fr: "Ain Defla" },
  { code: 45, ar: "النعامة", fr: "Naama" },
  { code: 46, ar: "عين تموشنت", fr: "Ain Témouchent" },
  { code: 47, ar: "غرداية", fr: "Ghardaia" },
  { code: 48, ar: "غليزان", fr: "Relizane" },
  { code: 49, ar: "تيميمون", fr: "Timimoun" },
  { code: 50, ar: "برج باجي مختار", fr: "Bordj Badji Mokhtar" },
  { code: 51, ar: "أولاد جلال", fr: "Ouled Djellal" },
  { code: 52, ar: "بني عباس", fr: "Beni Abbes" },
  { code: 53, ar: "عين صالح", fr: "In Salah" },
  { code: 54, ar: "عين قزام", fr: "In Guezzam" },
  { code: 55, ar: "تقرت", fr: "Touggourt" },
  { code: 56, ar: "جانت", fr: "Djanet" },
  { code: 57, ar: "المغير", fr: "El M'Ghair" },
  { code: 58, ar: "المنيعة", fr: "El Meniaa" },
];

export const WILAYA_BY_CODE = new Map(WILAYAS.map((w) => [w.code, w]));

export function wilayaName(code: number, lang: "ar" | "fr"): string {
  const w = WILAYA_BY_CODE.get(code);
  if (!w) return String(code);
  return lang === "ar" ? w.ar : w.fr;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Lucide icon names used for a category.
 *
 * A string key rather than a component reference, so this module stays free of
 * React imports and can be used from Convex server code as well as the client.
 * `CategoryIcon` in components/marketplace.tsx resolves it to the component.
 */
export const CATEGORY_ICON_KEYS = [
  "Shirt",
  "Smartphone",
  "Sparkles",
  "CookingPot",
  "ShoppingBasket",
  "Baby",
  "Car",
  "Package",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

/** Server-side check: an icon outside this list is rejected, not coerced. */
export function isCategoryIconKey(value: unknown): value is CategoryIconKey {
  return (
    typeof value === "string" &&
    (CATEGORY_ICON_KEYS as readonly string[]).includes(value)
  );
}

export type ProductCategory = {
  key: string;
  ar: string;
  fr: string;
  icon: CategoryIconKey;
  order?: number;
  active?: boolean;
  parent?: string;
};

/**
 * The default list, and the source of truth for the first migration.
 *
 * Once `productCategories` has rows the Convex query wins; this stays here so
 * a fresh deployment, the sitemap generator and the Convex seed all agree on
 * what the starting categories are.
 */
export const CATEGORIES: ProductCategory[] = [
  { key: "fashion", ar: "أزياء وموضة", fr: "Mode et vêtements", icon: "Shirt" },
  { key: "electronics", ar: "إلكترونيات", fr: "Électronique", icon: "Smartphone" },
  { key: "beauty", ar: "تجميل وعطور", fr: "Beauté et parfums", icon: "Sparkles" },
  { key: "home", ar: "المنزل والمطبخ", fr: "Maison et cuisine", icon: "CookingPot" },
  { key: "groceries", ar: "مواد غذائية", fr: "Alimentation", icon: "ShoppingBasket" },
  { key: "kids", ar: "أطفال وأم", fr: "Enfants et maman", icon: "Baby" },
  { key: "auto", ar: "سيارات وقطع", fr: "Auto et pièces", icon: "Car" },
  { key: "other", ar: "أخرى", fr: "Autres", icon: "Package" },
];

export const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function categoryLabel(key: string, lang: "ar" | "fr"): string {
  const c = CATEGORY_BY_KEY.get(key);
  if (!c) return key;
  return lang === "ar" ? c.ar : c.fr;
}

// ---------------------------------------------------------------------------
// Store types (retailer onboarding)
// ---------------------------------------------------------------------------

export const STORE_TYPES: { key: string; ar: string; fr: string }[] = [
  { key: "facebook", ar: "صفحة فيسبوك", fr: "Page Facebook" },
  { key: "instagram", ar: "إنستغرام", fr: "Instagram" },
  { key: "tiktok", ar: "تيك توك", fr: "TikTok" },
  { key: "website", ar: "موقع إلكتروني", fr: "Site web" },
  { key: "other", ar: "أخرى", fr: "Autre" },
];

// ---------------------------------------------------------------------------
// Delivery options
// ---------------------------------------------------------------------------

export const DELIVERY_OPTIONS: { key: string; ar: string; fr: string }[] = [
  { key: "pickup", ar: "استلام من المحل", fr: "Retrait en boutique" },
  { key: "yalidine", ar: "ياليدين", fr: "Yalidine" },
  { key: "zr_express", ar: "ZR Express", fr: "ZR Express" },
  { key: "maystro", ar: "مايسترو", fr: "Maystro Delivery" },
  { key: "own", ar: "توصيل خاص", fr: "Livraison propre" },
];

// ---------------------------------------------------------------------------
// WhatsApp validation: Algerian numbers are 10 digits starting 05/06/07.
// ---------------------------------------------------------------------------

/**
 * Normalizes an Algerian phone input into `213XXXXXXXXX` form.
 * Accepts local (05/06/07 + 9 digits), national (0X...), or +213 / 00213 forms.
 * Returns null when the input cannot be a valid Algerian mobile number.
 */
export function normalizeAlgerianPhone(input: string): string | null {
  if (!input) return null;
  // Keep digits and a single leading plus.
  const cleaned = input.replace(/[\s\-().]/g, "");
  let digits = cleaned.replace(/^\+/, "");
  if (digits.startsWith("00213")) digits = digits.slice(5);
  else if (digits.startsWith("213")) digits = digits.slice(3);
  if (!/^\d+$/.test(digits)) return null;
  // Local form 05xxxxxxxx -> add the country code.
  if (digits.length === 10 && (digits[0] === "0")) digits = `213${digits.slice(1)}`;
  if (!/^213(5|6|7)\d{8}$/.test(digits)) return null;
  return digits;
}

/** Display form used in the UI: `+213 555 12 34 56`. */
export function formatPhoneInternational(e164: string): string {
  if (!e164.startsWith("213")) return e164;
  const rest = e164.slice(3);
  return `+213 ${rest.slice(0, 3)} ${rest.slice(3, 5)} ${rest.slice(5, 7)} ${rest.slice(7, 9)}`;
}

/** Prefilled Arabic WhatsApp message for the "contact wholesaler" action. */
export function whatsappPrefill(productName: string, link: string): string {
  return `السلام عليكم، شفت منتج «${productName}» في TajirDz وبغيت نعرف التفاصيل (الثمن، الكمية والتوصيل).\n${link}`;
}

export function whatsappUrl(phoneE164: string, message: string): string {
  return `https://wa.me/${phoneE164}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Arabic text normalization for search
// ---------------------------------------------------------------------------

// Arabic presentation forms -> base letters.
const ARABIC_PRESENTATION: Record<string, string> = {
  "آ": "ا", "أ": "ا", "إ": "ا", "ٱ": "ا",
  "ؤ": "و", "ئ": "ي",
  "ى": "ي",
  "ة": "ه",
  "پ": "ب",
  "ڤ": "ف",
  "ݣ": "غ",
};

// Harakat, tanween, shadda, sukun, dagger alef, and Quranic marks.
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * Folds Arabic text into a comparable base form so that searches match across
 * hamza/alef variants, ta marbuta vs haa, yaa/alef maqsura, and diacritics.
 * Latin text is lower-cased and stripped of accents.
 */
export function normalizeArabic(input: string): string {
  if (!input) return "";
  let out = input.toLowerCase().normalize("NFKC");
  out = out.replace(DIACRITICS, "");
  out = out.replace(/[آأإٱ]/g, "ا");
  out = out.replace(/ؤ/g, "و");
  out = out.replace(/ئ/g, "ي");
  out = out.replace(/ى/g, "ي");
  out = out.replace(/ة/g, "ه");
  out = out.replace(/[پڤݣ]/g, (ch) => ARABIC_PRESENTATION[ch] ?? ch);
  out = out.normalize("NFKC");
  // Latin accents (é -> e).
  out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * True when `haystack` contains every token of the `query`, using the same
 * folding as `normalizeArabic`. Gives typo-free prefix/substring matching
 * across Arabic orthography variants.
 */
export function matchesQuery(haystackParts: (string | undefined | null)[], query: string): boolean {
  const q = normalizeArabic(query);
  if (!q) return true;
  const hay = normalizeArabic(haystackParts.filter(Boolean).join(" "));
  if (!hay) return false;
  return q.split(" ").every((token) => hay.includes(token));
}

/**
 * Bounded Levenshtein distance, used for typo tolerance. Returns early once
 * the best possible score already exceeds `max`, so long strings stay cheap.
 */
export function levenshteinWithin(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return false;
  if (al === 0 || bl === 0) return false;

  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return false;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl] <= max;
}

/**
 * Typo-tolerant token match. Exact substring hits win outright; otherwise we
 * accept a token whose edit distance to some word in the text is within a
 * length-scaled budget (1 edit for 4-6 chars, 2 for 7+).
 */
export function fuzzyMatches(normalizedText: string, query: string): boolean {
  const q = normalizeArabic(query);
  if (!q) return true;
  const text = normalizeArabic(normalizedText);
  if (!text) return false;

  const words = text.split(" ");
  for (const token of q.split(" ")) {
    if (words.some((w) => w.includes(token) || token.includes(w))) continue;
    const budget = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
    if (budget === 0) return false;
    const ok = words.some((w) => {
      if (Math.abs(w.length - token.length) > budget) return false;
      return levenshteinWithin(token, w, budget);
    });
    if (!ok) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Wilson score lower bound — the "winning product" ranking
// ---------------------------------------------------------------------------

/**
 * Wilson score lower bound at 95% confidence. Rewards products with both a
 * strong average and a proven sample size, which a plain average cannot do:
 * a single 5-star review would otherwise outrank a product with 40 reviews.
 */
export function wilsonLowerBound(positiveCount: number, totalCount: number, z = 1.96): number {
  if (totalCount <= 0) return 0;
  const p = positiveCount / totalCount;
  const z2 = z * z;
  const numerator = p + z2 / (2 * totalCount);
  const denominator = 1 + z2 / totalCount;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * totalCount)) / totalCount);
  return Math.max(0, (numerator - margin) / denominator);
}

/** A product rating of 4 or 5 counts as a "positive" outcome for scoring. */
export function isPositiveRating(rating: number): boolean {
  return rating >= 4;
}

/** Minimum evidence before a product may be labelled a winning product. */
export const WINNING_MIN_REVIEWS = 5;
export const WINNING_MIN_AVG = 4.5;

/**
 * The single source of truth for the "منتج رابح" badge. Kept pure so the feed
 * ranking, the product page badge, and the seed data all agree.
 */
export function computeWinning(
  productRatings: number[],
): { isWinning: boolean; score: number; count: number; avg: number } {
  const count = productRatings.length;
  if (count === 0) return { isWinning: false, score: 0, count: 0, avg: 0 };
  const avg = productRatings.reduce((a, b) => a + b, 0) / count;
  const positive = productRatings.filter(isPositiveRating).length;
  const score = wilsonLowerBound(positive, count);
  return {
    isWinning: count >= WINNING_MIN_REVIEWS && avg >= WINNING_MIN_AVG && score > 0,
    score,
    count,
    avg,
  };
}

// ---------------------------------------------------------------------------
// Shared formatters (latn numbering, DA currency)
// ---------------------------------------------------------------------------

const LOCALE: Record<"ar" | "fr", string> = { ar: "ar-DZ", fr: "fr-DZ" };

/** Thousands-separated integer, latin digits in both languages. */
export function formatNumber(value: number, lang: "ar" | "fr" = "ar"): string {
  return new Intl.NumberFormat(`${LOCALE[lang]}-u-nu-latn`, {
    maximumFractionDigits: 0,
  }).format(value);
}

/** Wholesale price in Algerian dinars, e.g. `1 200 DA`. */
export function formatDinar(value: number, lang: "ar" | "fr" = "ar"): string {
  return `${formatNumber(Math.round(value), lang)} DA`;
}

/** Short relative time, Arabic or French. */
export function formatRelativeTime(
  timestamp: number,
  lang: "ar" | "fr" = "ar",
  now: number = Date.now(),
): string {
  const diffMs = now - timestamp;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return lang === "ar" ? "الآن" : "à l'instant";
  if (minutes < 60) return lang === "ar" ? `قبل ${formatNumber(minutes, lang)} د` : `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === "ar" ? `قبل ${formatNumber(hours, lang)} سا` : `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return lang === "ar" ? `قبل ${formatNumber(days, lang)} يوم` : `il y a ${days} j`;
  const months = Math.round(days / 30);
  if (months < 12) return lang === "ar" ? `قبل ${formatNumber(months, lang)} شهر` : `il y a ${months} mois`;
  return lang === "ar"
    ? `قبل ${formatNumber(Math.round(months / 12), lang)} سنة`
    : `il y a ${Math.round(months / 12)} an(s)`;
}

export function formatDate(timestamp: number, lang: "ar" | "fr" = "ar"): string {
  return new Intl.DateTimeFormat(`${LOCALE[lang]}-u-nu-latn-ca-gregory`, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

/** Subscription expiry shown in the shop profile, e.g. "12 مارس 2026". */
export function formatExpiry(expiresAt: number, lang: "ar" | "fr" = "ar"): string {
  return formatDate(expiresAt, lang);
}

// ---------------------------------------------------------------------------
// Text hygiene for public content
// ---------------------------------------------------------------------------

const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|dz|fr|io|shop|store|ma|xyz)\b)/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{8,}\d)|(?:\b0[567]\d{8}\b)/;
const AT_HANDLE = /@[a-z0-9_]{3,}/i;

/**
 * Public comments must not smuggle links or phone numbers — that is how
 * Facebook-group scams escape a marketplace. Applied to review comments,
 * quote descriptions, and chat previews.
 */
export function containsLinkOrPhone(text: string): boolean {
  return URL_PATTERN.test(text) || PHONE_PATTERN.test(text) || AT_HANDLE.test(text);
}

/** Strips control characters and collapses whitespace for display. */
export function cleanText(input: string, maxLength: number): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Deterministic pastel-on-white block used when a product has no photo yet. */
export function placeholderFor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  const hue = hash;
  return { bg: `hsl(${hue} 45% 94%)`, fg: `hsl(${hue} 40% 32%)` };
}

export function slugify(input: string): string {
  return normalizeArabic(input)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}