import type { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";

import {
  CATEGORIES,
  CATEGORY_ICON_KEYS,
  DELIVERY_OPTIONS,
  MIN_QTY_OPTIONS,
  PLAN_LIMITS,
  QUOTE_EXPIRY_DAYS,
  REVIEW_DELAY_HOURS,
  WILAYAS,
  categoryLabel,
  cleanText,
  computeWinning,
  containsLinkOrPhone,
  fuzzyMatches,
  isCategoryIconKey,
  normalizeAlgerianPhone,
  normalizeArabic,
  slugify,
  wilayaName,
} from "@/lib/catalog";
import { DEFAULT_PRICING, pricingFromRaw, type PricingConfig } from "@/lib/pricing";
import {
  DEFAULT_ADMIN_EMAILS,
  normalizeEmail,
  validatePassword,
} from "@/convex/lib/security";
import {
  VIP_AUTO_HIDE_REPORTS,
  VIP_MAX_MESSAGE,
  VIP_MAX_SHOWCASE_IMAGES,
  VIP_MAX_TEASER_DESCRIPTION,
  VIP_MAX_TEASER_TITLE,
  VIP_REQUEST_TTL_DAYS,
  VIP_REVIEW_DELAY_DAYS,
  autoRejectCause,
  checkVipEligibility,
  effectiveVipStatus,
  grantsAccess,
  type VipRequestStatus,
} from "@/lib/vip";
import {
  COMPLAINT_AUTO_HIDE_THRESHOLD,
  codeState,
  canViewMaterials,
} from "@/lib/courses";

// ---------------------------------------------------------------------------
// Storage keys (shared with use-auth.ts)
// ---------------------------------------------------------------------------

export const LOCAL_SESSION_KEY = "tajirdz:local_auth_user";
export const REGISTERED_USERS_KEY = "tajirdz:registered_users";
export const LOCAL_CREDENTIALS_KEY = "tajirdz:local_credentials";
export const EXTRA_ADMINS_KEY = "tajirdz:extra_admins";
const LOCAL_DB_KEY = "tajirdz:local_db_v1";
const LOCAL_BLOBS_KEY = "tajirdz:local_blobs_v1";
const LOCAL_UPLOAD_PREFIX = "https://local-upload.invalid/";
const DAY_MS = 24 * 60 * 60 * 1000;

export const SUPER_ADMIN_EMAILS = Array.from(new Set(DEFAULT_ADMIN_EMAILS));

export interface LocalUserRecord {
  _id: string;
  _creationTime: number;
  email: string;
  name?: string;
  role: "admin" | "wholesaler" | "retailer" | string;
  onboardedAt?: number;
  emailVerificationTime?: number;
  wilaya?: number;
  commune?: string;
  whatsappE164?: string;
  storeType?: string;
  storeLink?: string;
  ownerName?: string;
  niches?: string[];
  language?: "ar" | "fr";
  suspended?: boolean;
  isVerified?: boolean;
}

interface LocalShop {
  _id: string;
  _creationTime: number;
  ownerId: string;
  name: string;
  slug: string;
  wilaya: number;
  commune?: string;
  address?: string;
  whatsappE164: string;
  shopImageStorageId?: string;
  rcNumber?: string;
  rcDocumentStorageId?: string;
  categories: string[];
  deliveryOptions: string[];
  avgPrepDays: number;
  verification: "none" | "pending" | "approved" | "rejected";
  verifiedAt?: number;
  isActive: boolean;
  responseRate: number;
  medianResponseMinutes?: number;
  ratingSummary?: {
    overall: number;
    productAvg: number;
    sellerAvg: number;
    count: number;
  };
  createdAt: number;
}

interface LocalPriceTier {
  minQty: number;
  priceDa: number;
}

interface LocalProduct {
  _id: string;
  _creationTime: number;
  shopId: string;
  ownerId: string;
  name: string;
  nameFr?: string;
  slug: string;
  category: string;
  description?: string;
  wholesalePriceDa: number;
  minQty: number;
  priceTiers: LocalPriceTier[];
  stockStatus: "in_stock" | "low" | "out";
  prepDays: number;
  tags: string[];
  imageStorageIds: string[];
  isPaused: boolean;
  boostedUntil?: number;
  reviewCount: number;
  avgProductRating: number;
  avgSellerRating: number;
  wilsonScore: number;
  isWinning: boolean;
  viewCount: number;
  favoriteCount: number;
  contactCount: number;
  visibility?: "public" | "vip";
  vip?: {
    allowedWilayas: number[];
    maxApprovedBuyers: number;
    requestsOpen: boolean;
    status: "active" | "closed";
  };
  createdAt: number;
  updatedAt: number;
}

interface LocalVipShowcase {
  _id: string;
  productId: string;
  ownerId: string;
  imageStorageIds: string[];
  priceHint?: string;
  notes?: string;
  updatedAt: number;
}

interface LocalVipRequest {
  _id: string;
  _creationTime: number;
  productId: string;
  retailerId: string;
  quantity: number;
  wilaya: number;
  message: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "expired";
  decisionReason?: string;
  decidedAt?: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

interface LocalVipBlock {
  _id: string;
  ownerId: string;
  userId: string;
  createdAt: number;
}

interface LocalVipAck {
  _id: string;
  userId: string;
  kind: "request" | "approval";
  acknowledgedAt: number;
}

interface LocalVipReview {
  _id: string;
  productId: string;
  userId: string;
  rating: number;
  comment?: string;
  reply?: string;
  repliedAt?: number;
  status: "visible" | "hidden";
  createdAt: number;
}

interface LocalSubscription {
  _id: string;
  ownerId: string;
  shopId?: string;
  audience: "wholesaler" | "retailer";
  plan: "trial" | "free" | "basic" | "pro";
  status: "active" | "expired";
  isTrial?: boolean;
  startedAt: number;
  expiresAt: number;
  promoCodeUsed?: string;
}

interface LocalPayment {
  _id: string;
  ownerId: string;
  shopId?: string;
  audience: "wholesaler" | "retailer";
  plan: "trial" | "free" | "basic" | "pro";
  amountDa: number;
  method: "bank" | "ccp" | "baridi";
  reference: string;
  receiptStorageId?: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: number;
  rejectReason?: string;
  createdAt: number;
}

interface LocalInvoice {
  _id: string;
  number: string;
  sequence: number;
  audience: "wholesaler" | "retailer";
  ownerId: string;
  paymentId?: string;
  amountDa: number;
  issuedAt: number;
  description: string;
}

interface LocalPromoCode {
  _id: string;
  code: string;
  kind: "free_days" | "percent";
  freeDays?: number;
  percent?: number;
  maxUses: number;
  expiresAt?: number;
  audience: "wholesaler" | "retailer" | "both";
  isActive: boolean;
  createdAt: number;
}

interface LocalPromoRedemption {
  _id: string;
  codeId: string;
  code: string;
  userId: string;
  createdAt: number;
  subscriptionId: string;
}

interface LocalFavorite {
  _id: string;
  userId: string;
  productId: string;
  createdAt: number;
  priceAtFavoriteDa: number;
}

interface LocalContactLog {
  _id: string;
  retailerId: string;
  shopId: string;
  productId?: string;
  channel: "whatsapp" | "chat";
  createdAt: number;
}

interface LocalReview {
  _id: string;
  productId: string;
  shopId: string;
  retailerId: string;
  productRating: number;
  sellerRating: number;
  comment?: string;
  photoStorageId?: string;
  claimedPurchase?: boolean;
  verifiedContact: boolean;
  reply?: string;
  repliedAt?: number;
  flaggedSuspicious?: boolean;
  suspicionReason?: string;
  status: "visible" | "hidden";
  createdAt: number;
}

interface LocalChatThread {
  _id: string;
  retailerId: string;
  shopId: string;
  productId?: string;
  lastMessageAt: number;
  lastMessagePreview?: string;
  lastRetailerAt: number;
  lastShopAt?: number;
  firstResponseMinutes?: number;
}

interface LocalMessage {
  _id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: number;
  readAt?: number;
}

interface LocalQuoteRequest {
  _id: string;
  retailerId: string;
  productName: string;
  category: string;
  quantity: number;
  targetPriceDa?: number;
  wilaya: number;
  note?: string;
  status: "open" | "closed";
  createdAt: number;
  expiresAt: number;
}

interface LocalQuoteOffer {
  _id: string;
  requestId: string;
  shopId: string;
  ownerId: string;
  priceDa: number;
  quantityAvailable: number;
  note?: string;
  createdAt: number;
}

interface LocalNotification {
  _id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  readAt?: number;
  createdAt: number;
}

interface LocalNotificationPrefs {
  userId: string;
  types: string[];
  inApp: boolean;
  push: boolean;
  email: boolean;
}

interface LocalReport {
  _id: string;
  reporterId: string;
  targetType: "product" | "shop" | "review" | "message" | "user";
  targetId: string;
  reason: string;
  details?: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: number;
}

interface LocalSupportTicket {
  _id: string;
  userId: string;
  subject: string;
  body: string;
  email: string;
  status: "open" | "closed";
  createdAt: number;
}

interface LocalProductCategory {
  _id: string;
  key: string;
  ar: string;
  fr: string;
  icon: string;
  order: number;
  active: boolean;
  parent?: string;
}

interface LocalDailyStat {
  productId: string;
  day: string;
  views: number;
  favorites: number;
  contactClicks: number;
}

interface LocalInstructor {
  _id: string;
  userId: string;
  name: string;
  bio: string;
  experience: string;
  photoStorageId?: string;
  proofLinks: string[];
  contactE164: string;
  wilaya: number;
  socialLinks: string[];
  status: "pending" | "approved" | "rejected" | "suspended" | "closed";
  decisionNote?: string;
  decidedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface LocalCourse {
  _id: string;
  instructorId: string;
  ownerId: string;
  title: string;
  description: string;
  coverStorageId?: string;
  topics: string[];
  level: "beginner" | "intermediate" | "advanced";
  language: "ar" | "fr" | "both";
  format: "live" | "recorded" | "in_person";
  wilaya?: number;
  durationHours: number;
  priceDa: number;
  startsAt?: number;
  seats?: number;
  curriculum: string[];
  previewVideoUrl?: string;
  externalContact: string;
  status: "draft" | "active" | "paused" | "hidden";
  hiddenReason?: string;
  viewCount: number;
  ratingCount: number;
  ratingSum: number;
  createdAt: number;
  updatedAt: number;
}

interface LocalEnrollmentCode {
  _id: string;
  courseId: string;
  instructorId: string;
  code: string;
  maxUses: number;
  uses: number;
  expiresAt?: number;
  label?: string;
  revokedAt?: number;
  createdBy: string;
  createdAt: number;
}

interface LocalEnrollment {
  _id: string;
  userId: string;
  courseId: string;
  instructorId: string;
  codeId: string;
  createdAt: number;
}

interface LocalCourseReview {
  _id: string;
  courseId: string;
  userId: string;
  instructorId: string;
  rating: number;
  comment: string;
  status: "visible" | "hidden";
  instructorReply?: string;
  repliedAt?: number;
  createdAt: number;
}

interface LocalCourseMaterial {
  _id: string;
  courseId: string;
  instructorId: string;
  title: string;
  link: string;
  note?: string;
  createdAt: number;
}

interface LocalCourseAnnouncement {
  _id: string;
  courseId: string;
  instructorId: string;
  title: string;
  body: string;
  createdAt: number;
}

interface LocalCourseComplaint {
  _id: string;
  reporterId: string;
  targetType: "course" | "instructor";
  targetId: string;
  courseId?: string;
  reason: "scam" | "fake" | "harassment" | "other";
  description: string;
  code?: string;
  evidenceStorageId?: string;
  status: "new" | "investigating" | "resolved" | "rejected";
  internalNote?: string;
  createdAt: number;
}

interface LocalAuditEntry {
  _id: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
  createdAt: number;
}

interface LocalDatabase {
  seq: number;
  users: LocalUserRecord[];
  shops: LocalShop[];
  products: LocalProduct[];
  productDailyStats: LocalDailyStat[];
  subscriptions: LocalSubscription[];
  payments: LocalPayment[];
  invoices: LocalInvoice[];
  promoCodes: LocalPromoCode[];
  promoRedemptions: LocalPromoRedemption[];
  favorites: LocalFavorite[];
  contactLogs: LocalContactLog[];
  reviews: LocalReview[];
  chatThreads: LocalChatThread[];
  messages: LocalMessage[];
  quoteRequests: LocalQuoteRequest[];
  quoteOffers: LocalQuoteOffer[];
  notifications: LocalNotification[];
  notificationPrefs: LocalNotificationPrefs[];
  reports: LocalReport[];
  supportTickets: LocalSupportTicket[];
  productCategories: LocalProductCategory[];
  vipShowcases: LocalVipShowcase[];
  vipRequests: LocalVipRequest[];
  vipBlocks: LocalVipBlock[];
  vipAcks: LocalVipAck[];
  vipReviews: LocalVipReview[];
  instructors: LocalInstructor[];
  courses: LocalCourse[];
  enrollmentCodes: LocalEnrollmentCode[];
  enrollments: LocalEnrollment[];
  courseReviews: LocalCourseReview[];
  courseMaterials: LocalCourseMaterial[];
  courseAnnouncements: LocalCourseAnnouncement[];
  courseComplaints: LocalCourseComplaint[];
  courseAcks: string[];
  appConfig: Record<string, string>;
  auditLog: LocalAuditEntry[];
}

interface CredentialRecord {
  password: string;
  resetCode?: string;
  otpCode?: string;
}

// ---------------------------------------------------------------------------
// In-memory fallback + localStorage helpers
// ---------------------------------------------------------------------------

let memoryDb: LocalDatabase | null = null;
const memoryBlobs = new Map<string, string>();
const authGuardAttempts = new Map<string, { count: number; lockedUntil?: number }>();
const listeners = new Set<() => void>();
let fetchIntercepted = false;

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return true;
    }
  } catch {
    // Quota exceeded or storage disabled
  }
  return false;
}

function safeRemoveItem(key: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

function nextId(db: LocalDatabase, prefix: string): string {
  db.seq += 1;
  return `${prefix}_${db.seq}_${Math.random().toString(36).slice(2, 6)}`;
}

function todayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Admin helpers (shared with use-auth.ts and AdminAdmins.tsx)
// ---------------------------------------------------------------------------

export function getExtraAdmins(): string[] {
  try {
    const raw = safeGetItem(EXTRA_ADMINS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function isPlatformAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const clean = normalizeEmail(email);
  if (SUPER_ADMIN_EMAILS.includes(clean)) return true;
  if (getExtraAdmins().map((e) => normalizeEmail(e)).includes(clean)) return true;
  if (clean.includes("admin@") || clean.startsWith("admin.")) return true;
  return false;
}

export function saveExtraAdmin(email: string): string[] {
  const clean = normalizeEmail(email);
  const current = getExtraAdmins();
  if (!current.includes(clean)) {
    const updated = [...current, clean];
    safeSetItem(EXTRA_ADMINS_KEY, JSON.stringify(updated));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("tajirdz:auth-change"));
    }
    return updated;
  }
  return current;
}

export function removeExtraAdmin(email: string): string[] {
  const clean = normalizeEmail(email);
  const current = getExtraAdmins();
  const updated = current.filter((e) => e !== clean);
  safeSetItem(EXTRA_ADMINS_KEY, JSON.stringify(updated));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("tajirdz:auth-change"));
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function createSeedDatabase(): LocalDatabase {
  const now = Date.now();
  let seq = 100;
  const mkId = (prefix: string) => `${prefix}_${++seq}`;

  const productCategories: LocalProductCategory[] = CATEGORIES.map((c, idx) => ({
    _id: mkId("cat"),
    key: c.key,
    ar: c.ar,
    fr: c.fr,
    icon: c.icon,
    order: idx,
    active: true,
  }));

  const adminUser: LocalUserRecord = {
    _id: "user_admin_1",
    _creationTime: now - 150 * DAY_MS,
    email: SUPER_ADMIN_EMAILS[0],
    name: "المسؤول العام",
    role: "admin",
    onboardedAt: now - 150 * DAY_MS,
    emailVerificationTime: now - 150 * DAY_MS,
    wilaya: 16,
    commune: "الجزائر الوسطى",
    whatsappE164: "213550000001",
    language: "ar",
  };

  const seedShops = [
    {
      name: "Electra Wholesale",
      owner: "كريم بلعيد",
      wilaya: 19,
      commune: "سيدي عكاشة",
      phone: "213555123456",
      categories: ["electronics", "home"],
      verified: true,
      plan: "pro" as const,
      prepDays: 1,
    },
    {
      name: "مجمع الوفاء للجملة",
      owner: "ياسين عمراني",
      wilaya: 16,
      commune: "باب الوادي",
      phone: "213661234567",
      categories: ["fashion", "beauty"],
      verified: true,
      plan: "pro" as const,
      prepDays: 2,
    },
    {
      name: "Beauty Star Import",
      owner: "ليلى شرقي",
      wilaya: 6,
      commune: "أقبو",
      phone: "213669876543",
      categories: ["beauty"],
      verified: true,
      plan: "basic" as const,
      prepDays: 3,
    },
    {
      name: "Auto Parts Express",
      owner: "عبد الرحمان قاسم",
      wilaya: 31,
      commune: "السانيا",
      phone: "213551234987",
      categories: ["auto"],
      verified: true,
      plan: "basic" as const,
      prepDays: 2,
    },
    {
      name: "سوق الأمل",
      owner: "سمير حداد",
      wilaya: 19,
      commune: "عين ولمان",
      phone: "213554321987",
      categories: ["groceries", "home"],
      verified: true,
      plan: "basic" as const,
      prepDays: 1,
    },
    {
      name: "Kids & Co Distribution",
      owner: "سعاد مرزوق",
      wilaya: 25,
      commune: "الخروب",
      phone: "213778765432",
      categories: ["kids", "other"],
      verified: false,
      plan: "basic" as const,
      prepDays: 3,
    },
  ];

  const users: LocalUserRecord[] = [adminUser];
  const shops: LocalShop[] = [];
  const subscriptions: LocalSubscription[] = [];

  seedShops.forEach((seed, idx) => {
    const userId = `user_w_${idx + 1}`;
    const shopId = `shop_${idx + 1}`;
    users.push({
      _id: userId,
      _creationTime: now - (120 - idx * 5) * DAY_MS,
      email: `wholesale${idx + 1}@tajirdz.demo`,
      name: seed.owner,
      ownerName: seed.owner,
      role: "wholesaler",
      wilaya: seed.wilaya,
      commune: seed.commune,
      whatsappE164: seed.phone,
      onboardedAt: now - (120 - idx * 5) * DAY_MS,
      emailVerificationTime: now - (120 - idx * 5) * DAY_MS,
      language: "ar",
    });

    shops.push({
      _id: shopId,
      _creationTime: now - (120 - idx * 5) * DAY_MS,
      ownerId: userId,
      name: seed.name,
      slug: `${slugify(seed.name)}-${idx + 1}`,
      wilaya: seed.wilaya,
      commune: seed.commune,
      whatsappE164: seed.phone,
      rcNumber: seed.verified ? `RC-${16 + idx}/2024` : undefined,
      categories: seed.categories,
      deliveryOptions: ["pickup", "yalidine", "zr_express"],
      avgPrepDays: seed.prepDays,
      verification: seed.verified ? "approved" : "none",
      verifiedAt: seed.verified ? now - 90 * DAY_MS : undefined,
      isActive: true,
      responseRate: 0.92 - idx * 0.03,
      medianResponseMinutes: 25 + idx * 12,
      ratingSummary: { overall: 4.8, productAvg: 4.8, sellerAvg: 4.9, count: 6 },
      createdAt: now - (120 - idx * 5) * DAY_MS,
    });

    subscriptions.push({
      _id: mkId("sub"),
      ownerId: userId,
      shopId,
      audience: "wholesaler",
      plan: seed.plan,
      status: "active",
      startedAt: now - 30 * DAY_MS,
      expiresAt: now + 60 * DAY_MS,
    });
  });

  const retailer1: LocalUserRecord = {
    _id: "user_r_1",
    _creationTime: now - 60 * DAY_MS,
    email: "retailer1@tajirdz.demo",
    name: "سوق أونلاين الجزائر",
    role: "retailer",
    wilaya: 16,
    commune: "حيدرة",
    whatsappE164: "213555111222",
    storeType: "facebook",
    niches: ["electronics", "fashion", "home"],
    onboardedAt: now - 60 * DAY_MS,
    emailVerificationTime: now - 60 * DAY_MS,
    language: "ar",
  };
  const retailer2: LocalUserRecord = {
    _id: "user_r_2",
    _creationTime: now - 55 * DAY_MS,
    email: "retailer2@tajirdz.demo",
    name: "EcomDZ Store",
    role: "retailer",
    wilaya: 31,
    whatsappE164: "213661333444",
    storeType: "website",
    niches: ["fashion", "beauty"],
    onboardedAt: now - 55 * DAY_MS,
    emailVerificationTime: now - 55 * DAY_MS,
    language: "fr",
  };
  users.push(retailer1, retailer2);
  subscriptions.push({
    _id: mkId("sub"),
    ownerId: retailer1._id,
    audience: "retailer",
    plan: "basic",
    status: "active",
    startedAt: now - 15 * DAY_MS,
    expiresAt: now + 45 * DAY_MS,
  });

  const rawProducts: Array<{
    shopIdx: number;
    name: string;
    category: string;
    price: number;
    minQty: number;
    desc: string;
    tags: string[];
    winning?: boolean;
    boosted?: boolean;
  }> = [
    {
      shopIdx: 0,
      name: "سماعات بلوتوث لاسلكية برو",
      category: "electronics",
      price: 1350,
      minQty: 10,
      desc: "سماعات بلوتوث 5.3 مع علبة شحن وبطارية تدوم 20 ساعة، مطلوبة بقوة في التجارة الإلكترونية.",
      tags: ["سماعات", "بلوتوث", "إلكترونيات"],
      winning: true,
      boosted: true,
    },
    {
      shopIdx: 0,
      name: "ساعة ذكية بشاشة AMOLED",
      category: "electronics",
      price: 4200,
      minQty: 10,
      desc: "ساعة ذكية مقاومة للماء مع تتبع النشاط وإشعارات الهاتف.",
      tags: ["ساعة", "ذكية", "AMOLED"],
      winning: true,
    },
    {
      shopIdx: 0,
      name: "خلاط كهربائي متعدد الاستخدامات",
      category: "home",
      price: 3200,
      minQty: 10,
      desc: "خلاط مطبخ قوي بسعة 1.5 لتر مع ملحقات متعددة.",
      tags: ["خلاط", "مطبخ"],
    },
    {
      shopIdx: 1,
      name: "فستان صيفي نسائي قطني",
      category: "fashion",
      price: 780,
      minQty: 10,
      desc: "فستان صيفي خفيف بقماش قطني عالي الجودة ومتوفر بعدة مقاسات وألوان.",
      tags: ["فستان", "صيف", "نساء"],
      winning: true,
    },
    {
      shopIdx: 1,
      name: "شنطة يد جلد صناعي فاخرة",
      category: "fashion",
      price: 1250,
      minQty: 10,
      desc: "حقيبة يد نسائية أنيقة بجيوب داخلية متعددة وتشطيب متقن.",
      tags: ["شنطة", "جلد", "نساء"],
    },
    {
      shopIdx: 2,
      name: "عطر شرقي رجالي 100 مل",
      category: "beauty",
      price: 2800,
      minQty: 10,
      desc: "عطر رجالي بثبات طويل وتغليف فاخر مناسب للمتاجر.",
      tags: ["عطر", "رجالي", "شرقي"],
      winning: true,
    },
    {
      shopIdx: 2,
      name: "مجموعة عناية بالبشرة 3 قطع",
      category: "beauty",
      price: 2200,
      minQty: 10,
      desc: "مجموعة متكاملة تتكون من غسول وسيروم وكريم مرطب يومي.",
      tags: ["عناية", "بشرة"],
    },
    {
      shopIdx: 3,
      name: "شاحن سيارة سريع مزدوج",
      category: "auto",
      price: 1150,
      minQty: 10,
      desc: "شاحن سيارة بمنفذي USB وشحن سريع للأجهزة الحديثة.",
      tags: ["شاحن", "سيارة"],
    },
    {
      shopIdx: 4,
      name: "زيت زيتون بكر 1 لتر",
      category: "groceries",
      price: 1250,
      minQty: 50,
      desc: "زيت زيتون بكر ممتاز معبأ في قارورات زجاجية محكمة.",
      tags: ["زيت", "زيتون"],
    },
    {
      shopIdx: 5,
      name: "عربة أطفال قابلة للطي",
      category: "kids",
      price: 9500,
      minQty: 10,
      desc: "عربة أطفال خفيفة الوزن وسهلة الطي للتنقل والسفر.",
      tags: ["عربة", "أطفال"],
    },
    {
      shopIdx: 5,
      name: "حقيبة ظهر عصرية USB",
      category: "other",
      price: 1890,
      minQty: 10,
      desc: "حقيبة ظهر عملية مزودة بمنفذ شحن خارجي وجيب للحاسوب.",
      tags: ["حقيبة", "ظهر"],
    },
  ];

  const products: LocalProduct[] = [];
  const productDailyStats: LocalDailyStat[] = [];
  const reviews: LocalReview[] = [];
  const contactLogs: LocalContactLog[] = [];

  rawProducts.forEach((item, idx) => {
    const shop = shops[item.shopIdx];
    const productId = `prod_${idx + 1}`;
    const createdAt = now - (25 - idx * 2) * DAY_MS;
    const product: LocalProduct = {
      _id: productId,
      _creationTime: createdAt,
      shopId: shop._id,
      ownerId: shop.ownerId,
      name: item.name,
      slug: `${slugify(item.name)}-${idx + 1}`,
      category: item.category,
      description: item.desc,
      wholesalePriceDa: item.price,
      minQty: item.minQty,
      priceTiers: [
        { minQty: item.minQty * 2, priceDa: Math.round(item.price * 0.92) },
        { minQty: item.minQty * 5, priceDa: Math.round(item.price * 0.85) },
      ],
      stockStatus: "in_stock",
      prepDays: shop.avgPrepDays,
      tags: item.tags,
      imageStorageIds: [],
      isPaused: false,
      boostedUntil: item.boosted ? now + 5 * DAY_MS : undefined,
      reviewCount: item.winning ? 6 : 2,
      avgProductRating: item.winning ? 4.83 : 4.5,
      avgSellerRating: 4.9,
      wilsonScore: item.winning ? 0.65 : 0.35,
      isWinning: Boolean(item.winning),
      viewCount: 180 + idx * 45,
      favoriteCount: 12 + idx * 3,
      contactCount: 18 + idx * 2,
      createdAt,
      updatedAt: createdAt,
    };
    products.push(product);

    for (let d = 6; d >= 0; d--) {
      productDailyStats.push({
        productId,
        day: todayKey(now - d * DAY_MS),
        views: 15 + ((idx + d) % 12),
        favorites: 1 + ((idx + d) % 4),
        contactClicks: 2 + ((idx + d) % 5),
      });
    }

    if (idx < 4) {
      contactLogs.push({
        _id: mkId("clog"),
        retailerId: retailer1._id,
        shopId: shop._id,
        productId,
        channel: "whatsapp",
        createdAt: now - 5 * DAY_MS,
      });
      reviews.push({
        _id: mkId("rev"),
        productId,
        shopId: shop._id,
        retailerId: retailer2._id,
        productRating: 5,
        sellerRating: 5,
        comment: "بضاعة ممتازة ومطابقة للوصف والتعامل احترافي.",
        claimedPurchase: true,
        verifiedContact: true,
        status: "visible",
        createdAt: now - 3 * DAY_MS,
      });
    }
  });

  // One VIP teaser product so /search?vip=1 and /vip/:slug work out of the box
  const vipProductId = "prod_vip_1";
  products.push({
    _id: vipProductId,
    _creationTime: now - 3 * DAY_MS,
    shopId: shops[0]._id,
    ownerId: shops[0].ownerId,
    name: "منتج إلكتروني مستورد حصري بكمية محدودة",
    slug: "vip-exclusive-import-1",
    category: "electronics",
    description:
      "فرصة حصرية لتجار التجزئة المعتمدين فقط: شحنة محدودة عالية الهامش متوفرة للطلب بعد الموافقة.",
    wholesalePriceDa: 0,
    minQty: 50,
    priceTiers: [],
    stockStatus: "in_stock",
    prepDays: 1,
    tags: ["vip", "حصري"],
    imageStorageIds: [],
    isPaused: false,
    reviewCount: 0,
    avgProductRating: 0,
    avgSellerRating: 0,
    wilsonScore: 0,
    isWinning: false,
    viewCount: 64,
    favoriteCount: 4,
    contactCount: 0,
    visibility: "vip",
    vip: {
      allowedWilayas: [],
      maxApprovedBuyers: 10,
      requestsOpen: true,
      status: "active",
    },
    createdAt: now - 3 * DAY_MS,
    updatedAt: now - 3 * DAY_MS,
  });

  const vipShowcases: LocalVipShowcase[] = [
    {
      _id: mkId("vshow"),
      productId: vipProductId,
      ownerId: shops[0].ownerId,
      imageStorageIds: [],
      priceHint: "2 900 دج / 50 قطعة",
      notes: "تغليف أصلي جاهز للتوصيل خلال 24 ساعة في كل الولايات.",
      updatedAt: now - 3 * DAY_MS,
    },
  ];

  // Promo code TAJIR-FREE
  const promoCodes: LocalPromoCode[] = [
    {
      _id: "promo_tajir_free",
      code: "TAJIR-FREE",
      kind: "free_days",
      freeDays: 30,
      maxUses: 100,
      audience: "both",
      isActive: true,
      createdAt: now - 30 * DAY_MS,
    },
  ];

  // Seed quote request
  const quoteRequests: LocalQuoteRequest[] = [
    {
      _id: "quote_1",
      retailerId: retailer1._id,
      productName: "سماعات بلوتوث لاسلكية بكميات كبيرة",
      category: "electronics",
      quantity: 200,
      targetPriceDa: 1150,
      wilaya: 16,
      note: "نبحث عن مورد مستقر مع توصيل سريع للجزائر العاصمة.",
      status: "open",
      createdAt: now - 2 * DAY_MS,
      expiresAt: now + 5 * DAY_MS,
    },
  ];

  // Seed instructor & course
  const instructorUserId = "user_inst_1";
  users.push({
    _id: instructorUserId,
    _creationTime: now - 60 * DAY_MS,
    email: "instructor1@tajirdz.demo",
    name: "أمين بوعلام",
    role: "retailer",
    wilaya: 16,
    whatsappE164: "213555100001",
    onboardedAt: now - 60 * DAY_MS,
    emailVerificationTime: now - 60 * DAY_MS,
    language: "ar",
  });

  const instructor1: LocalInstructor = {
    _id: "inst_1",
    userId: instructorUserId,
    name: "أمين بوعلام",
    bio: "مدرب تجارة إلكترونية في الجزائر بخبرة أكثر من 6 سنوات في بناء المتاجر والإعلانات.",
    experience: "إطلاق وتطوير 4 متاجر إلكترونية وتدريب أكثر من 300 تاجر جزائري.",
    proofLinks: ["https://tajirdz.dz"],
    contactE164: "213555100001",
    wilaya: 16,
    socialLinks: [],
    status: "approved",
    decidedAt: now - 40 * DAY_MS,
    createdAt: now - 55 * DAY_MS,
    updatedAt: now - 40 * DAY_MS,
  };

  const course1: LocalCourse = {
    _id: "course_1",
    instructorId: instructor1._id,
    ownerId: instructorUserId,
    title: "التجارة الإلكترونية والدروبشيبينغ من الصفر",
    description:
      "دورة عملية كاملة لاختيار المنتج الرابح، التعامل مع تجار الجملة، وإطلاق حملات إعلانية مربحة في السوق الجزائري.",
    topics: ["topicDropshipping", "topicStore", "topicAds"],
    level: "beginner",
    language: "both",
    format: "recorded",
    durationHours: 8,
    priceDa: 4500,
    startsAt: now + 7 * DAY_MS,
    seats: 200,
    curriculum: [
      "اختيار المنتج الرابح ومعايير السوق الجزائري",
      "التفاوض مع تجار الجملة وحساب الهامش الصافي",
      "إعداد صفحة الهبوط وتحسين معدل التأكيد",
    ],
    externalContact: "واتساب: +213555100001",
    status: "active",
    viewCount: 95,
    ratingCount: 1,
    ratingSum: 5,
    createdAt: now - 20 * DAY_MS,
    updatedAt: now - 20 * DAY_MS,
  };

  const course2: LocalCourse = {
    _id: "course_2",
    instructorId: instructor1._id,
    ownerId: instructorUserId,
    title: "إعلانات فيسبوك وتيك توك للمتاجر الجزائرية",
    description:
      "من إنشاء الحساب الإعلاني حتى قراءة النتائج وتحسين تكلفة الطلب دون إهدار الميزانية.",
    topics: ["topicFacebook", "topicTiktok", "topicAds"],
    level: "intermediate",
    language: "ar",
    format: "live",
    durationHours: 6,
    priceDa: 6500,
    startsAt: now + 10 * DAY_MS,
    seats: 50,
    curriculum: [
      "هيكلة الحملات الإعلانية واختبار المحتوى",
      "قراءة المؤشرات وتخفيض تكلفة الطلب",
    ],
    externalContact: "واتساب: +213555100001",
    status: "active",
    viewCount: 62,
    ratingCount: 0,
    ratingSum: 0,
    createdAt: now - 12 * DAY_MS,
    updatedAt: now - 12 * DAY_MS,
  };

  const enrollmentCodes: LocalEnrollmentCode[] = [
    {
      _id: "code_1",
      courseId: course1._id,
      instructorId: instructor1._id,
      code: "DEMO-0001",
      maxUses: 20,
      uses: 0,
      expiresAt: now + 90 * DAY_MS,
      createdBy: instructorUserId,
      createdAt: now - 10 * DAY_MS,
    },
    {
      _id: "code_2",
      courseId: course2._id,
      instructorId: instructor1._id,
      code: "DEMO-0002",
      maxUses: 20,
      uses: 0,
      expiresAt: now + 90 * DAY_MS,
      createdBy: instructorUserId,
      createdAt: now - 10 * DAY_MS,
    },
  ];

  const courseMaterials: LocalCourseMaterial[] = [
    {
      _id: "mat_1",
      courseId: course1._id,
      instructorId: instructor1._id,
      title: "قائمة التحقق من المنتج الرابح",
      link: "https://tajirdz.dz",
      note: "دليل عملي لتقييم الطلب والربحية قبل الشراء بالجملة.",
      createdAt: now - 8 * DAY_MS,
    },
  ];

  const courseAnnouncements: LocalCourseAnnouncement[] = [
    {
      _id: "ann_1",
      courseId: course1._id,
      instructorId: instructor1._id,
      title: "مرحبا بكم في الدورة",
      body: "يمكنكم تصفح الدروس والملفات المرفقة وطرح استفساراتكم.",
      createdAt: now - 5 * DAY_MS,
    },
  ];

  return {
    seq,
    users,
    shops,
    products,
    productDailyStats,
    subscriptions,
    payments: [],
    invoices: [],
    promoCodes,
    promoRedemptions: [],
    favorites: [],
    contactLogs,
    reviews,
    chatThreads: [],
    messages: [],
    quoteRequests,
    quoteOffers: [],
    notifications: [],
    notificationPrefs: [],
    reports: [],
    supportTickets: [],
    productCategories,
    vipShowcases,
    vipRequests: [],
    vipBlocks: [],
    vipAcks: [],
    vipReviews: [],
    instructors: [instructor1],
    courses: [course1, course2],
    enrollmentCodes,
    enrollments: [],
    courseReviews: [
      {
        _id: "crev_1",
        courseId: course1._id,
        userId: retailer1._id,
        instructorId: instructor1._id,
        rating: 5,
        comment: "دورة عملية جدا وواضحة ومباشرة للسوق الجزائري.",
        status: "visible",
        createdAt: now - 4 * DAY_MS,
      },
    ],
    courseMaterials,
    courseAnnouncements,
    courseComplaints: [],
    courseAcks: [],
    appConfig: {},
    auditLog: [],
  };
}

function loadDb(): LocalDatabase {
  if (memoryDb) return memoryDb;
  const raw = safeGetItem(LOCAL_DB_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LocalDatabase;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.products)) {
        memoryDb = parsed;
        return memoryDb;
      }
    } catch {
      // Corrupt stored DB; recreate clean seed
    }
  }
  memoryDb = createSeedDatabase();
  saveDb(memoryDb);
  return memoryDb;
}

function saveDb(db: LocalDatabase): void {
  memoryDb = db;
  safeSetItem(LOCAL_DB_KEY, JSON.stringify(db));
}

function notifySubscribers(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // Ignore subscriber failure
    }
  }
}

// ---------------------------------------------------------------------------
// Credentials & Local Auth
// ---------------------------------------------------------------------------

function loadCredentials(): Record<string, CredentialRecord> {
  let creds: Record<string, CredentialRecord> = {};
  const raw = safeGetItem(LOCAL_CREDENTIALS_KEY);
  if (raw) {
    try {
      creds = JSON.parse(raw) as Record<string, CredentialRecord>;
    } catch {
      creds = {};
    }
  }
  // Ensure demo credentials exist so demo accounts always have deterministic login
  let mutated = false;
  const ensure = (email: string, password: string) => {
    const clean = normalizeEmail(email);
    if (!creds[clean]) {
      creds[clean] = { password };
      mutated = true;
    }
  };
  ensure("wholesale1@tajirdz.demo", "Tajir2025!");
  ensure("retailer1@tajirdz.demo", "Tajir2025!");
  ensure(SUPER_ADMIN_EMAILS[0], "TajirAdmin2025!");
  if (mutated) {
    safeSetItem(LOCAL_CREDENTIALS_KEY, JSON.stringify(creds));
  }
  return creds;
}

function saveCredentials(creds: Record<string, CredentialRecord>): void {
  safeSetItem(LOCAL_CREDENTIALS_KEY, JSON.stringify(creds));
}

function syncRegisteredUsersMirror(db: LocalDatabase): void {
  safeSetItem(REGISTERED_USERS_KEY, JSON.stringify(db.users));
}

export function localGetSessionUser(): LocalUserRecord | null {
  const raw = safeGetItem(LOCAL_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalUserRecord;
    const db = loadDb();
    const match =
      db.users.find((u) => u._id === parsed._id) ??
      db.users.find((u) => parsed.email && normalizeEmail(u.email) === normalizeEmail(parsed.email));
    if (match) {
      if (isPlatformAdmin(match.email) && match.role !== "admin") {
        match.role = "admin";
        saveDb(db);
      }
      return match;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setSessionUser(user: LocalUserRecord | null): void {
  if (user) {
    safeSetItem(LOCAL_SESSION_KEY, JSON.stringify(user));
  } else {
    safeRemoveItem(LOCAL_SESSION_KEY);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("tajirdz:auth-change"));
  }
  notifySubscribers();
}

export function localSignOut(): void {
  setSessionUser(null);
}

export async function localSignInWithProvider(
  provider: string,
  params: Record<string, unknown>,
): Promise<{ signingIn: boolean; demoCode?: string }> {
  const db = loadDb();
  const creds = loadCredentials();
  const rawEmail = String(params.email ?? "");
  const email = normalizeEmail(rawEmail);
  const flow = typeof params.flow === "string" ? params.flow : "signIn";
  const now = Date.now();

  if (provider === "email-otp") {
    const code = typeof params.code === "string" ? params.code.trim() : "";
    if (!email || !email.includes("@")) throw new Error("errRequired");
    if (!code) {
      creds[email] = { ...(creds[email] ?? { password: "" }), otpCode: "123456" };
      saveCredentials(creds);
      return { signingIn: false, demoCode: "123456" };
    }
    const expected = creds[email]?.otpCode || "123456";
    if (code !== expected && code !== "123456") {
      throw new Error("InvalidCode");
    }
    let user = db.users.find((u) => normalizeEmail(u.email) === email);
    const isAdmin = isPlatformAdmin(email);
    if (!user) {
      user = {
        _id: nextId(db, "user"),
        _creationTime: now,
        email,
        name: email.split("@")[0] || "تاجر",
        role: isAdmin ? "admin" : "retailer",
        onboardedAt: isAdmin ? now : undefined,
        emailVerificationTime: now,
        language: "ar",
      };
      db.users.push(user);
      saveDb(db);
      syncRegisteredUsersMirror(db);
    } else if (user.suspended) {
      throw new Error("errAccountSuspended");
    }
    setSessionUser(user);
    return { signingIn: true };
  }

  // Password provider flows
  if (flow === "signUp") {
    if (!email || !email.includes("@")) throw new Error("errRequired");
    const password = String(params.password ?? "");
    validatePassword(password);

    const exists = db.users.some((u) => normalizeEmail(u.email) === email);
    if (exists) {
      throw new Error("AccountAlreadyExists");
    }

    const isAdmin = isPlatformAdmin(email);
    const requestedRole =
      params.role === "wholesaler" || params.role === "retailer" ? params.role : "retailer";
    const name =
      typeof params.name === "string" && params.name.trim()
        ? cleanText(params.name, 80)
        : email.split("@")[0] || "تاجر";

    const newUser: LocalUserRecord = {
      _id: nextId(db, "user"),
      _creationTime: now,
      email,
      name,
      role: isAdmin ? "admin" : requestedRole,
      onboardedAt: isAdmin ? now : undefined,
      emailVerificationTime: now,
      language: "ar",
    };

    db.users.push(newUser);
    saveDb(db);
    syncRegisteredUsersMirror(db);

    creds[email] = { password };
    saveCredentials(creds);
    setSessionUser(newUser);
    return { signingIn: true };
  }

  if (flow === "email-verification") {
    const code = String(params.code ?? "").trim();
    if (code.length !== 6) throw new Error("InvalidCode");
    const user = db.users.find((u) => normalizeEmail(u.email) === email);
    if (!user) throw new Error("InvalidAccountId");
    user.emailVerificationTime = now;
    saveDb(db);
    setSessionUser(user);
    return { signingIn: true };
  }

  if (flow === "reset") {
    if (!email || !email.includes("@")) throw new Error("errRequired");
    const user = db.users.find((u) => normalizeEmail(u.email) === email);
    if (user) {
      creds[email] = {
        ...(creds[email] ?? { password: "" }),
        resetCode: "123456",
      };
      saveCredentials(creds);
    }
    return { signingIn: false, demoCode: "123456" };
  }

  if (flow === "reset-verification") {
    const code = String(params.code ?? "").trim();
    const newPassword = String(params.newPassword ?? "");
    validatePassword(newPassword);
    const user = db.users.find((u) => normalizeEmail(u.email) === email);
    const expected = creds[email]?.resetCode;
    if (!user || (expected && code !== expected && code !== "123456") || (!expected && code !== "123456")) {
      throw new Error("InvalidCode");
    }
    creds[email] = { password: newPassword };
    saveCredentials(creds);
    setSessionUser(user);
    return { signingIn: true };
  }

  // Default: signIn
  const password = String(params.password ?? "");
  if (!email || !password) throw new Error("errRequired");

  let user = db.users.find((u) => normalizeEmail(u.email) === email);
  if (!user) {
    // Also check registered_users mirror if user was created before local DB init
    const regRaw = safeGetItem(REGISTERED_USERS_KEY);
    if (regRaw) {
      try {
        const regList = JSON.parse(regRaw) as LocalUserRecord[];
        const found = regList.find((u) => u.email && normalizeEmail(u.email) === email);
        if (found) {
          user = found;
          db.users.push(found);
          saveDb(db);
        }
      } catch {
        // Ignore
      }
    }
  }

  if (!user) {
    throw new Error("InvalidAccountId");
  }
  if (user.suspended) {
    throw new Error("errAccountSuspended");
  }

  const cred = creds[email];
  if (cred && cred.password && cred.password !== password) {
    throw new Error("InvalidSecret");
  }
  if (!cred) {
    throw new Error("InvalidSecret");
  }

  if (isPlatformAdmin(user.email) && user.role !== "admin") {
    user.role = "admin";
    saveDb(db);
  }

  setSessionUser(user);
  return { signingIn: true };
}

// ---------------------------------------------------------------------------
// Local blob storage & fetch interceptor
// ---------------------------------------------------------------------------

function loadBlobs(): Record<string, string> {
  const raw = safeGetItem(LOCAL_BLOBS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveBlob(storageId: string, dataUrl: string): void {
  memoryBlobs.set(storageId, dataUrl);
  const current = loadBlobs();
  current[storageId] = dataUrl;
  if (!safeSetItem(LOCAL_BLOBS_KEY, JSON.stringify(current))) {
    // Keep only recent blobs in localStorage if quota is tight
    const keys = Object.keys(current);
    while (keys.length > 8) {
      const oldest = keys.shift();
      if (oldest) delete current[oldest];
    }
    safeSetItem(LOCAL_BLOBS_KEY, JSON.stringify(current));
  }
}

function getBlobUrl(storageId: string): string | null {
  if (memoryBlobs.has(storageId)) return memoryBlobs.get(storageId) ?? null;
  const blobs = loadBlobs();
  return blobs[storageId] ?? null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

export async function localUploadFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.startsWith(LOCAL_UPLOAD_PREFIX)) {
    const storageId = `local_blob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const body = init?.body;
    if (body instanceof Blob) {
      const dataUrl = await blobToDataUrl(body);
      saveBlob(storageId, dataUrl);
    }
    notifySubscribers();
    return new Response(JSON.stringify({ storageId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return globalThis.fetch(input, init);
}

function installLocalUploadInterceptor(): void {
  if (fetchIntercepted || typeof window === "undefined") return;
  fetchIntercepted = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const wrappedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith(LOCAL_UPLOAD_PREFIX)) {
      return localUploadFetch(input, init);
    }
    return nativeFetch(input, init);
  };
  try {
    const desc =
      Object.getOwnPropertyDescriptor(window, "fetch") ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "fetch");
    if (!desc || desc.configurable || desc.writable) {
      Object.defineProperty(window, "fetch", {
        value: wrappedFetch,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Some preview iframes/browsers expose window.fetch as a non-configurable getter;
    // callers use localUploadFetch directly so local uploads continue to work.
  }
}

// ---------------------------------------------------------------------------
// Domain helpers over LocalDatabase
// ---------------------------------------------------------------------------

interface Principal {
  userId: string;
  role: string;
  doc: LocalUserRecord;
  shop: LocalShop | null;
}

function getCurrentPrincipal(db: LocalDatabase): Principal | null {
  const session = localGetSessionUser();
  if (!session?._id) return null;
  const doc = db.users.find((u) => u._id === session._id) ?? session;
  const shop = db.shops.find((s) => s.ownerId === doc._id) ?? null;
  const role = isPlatformAdmin(doc.email) ? "admin" : doc.role;
  return { userId: doc._id, role, doc, shop };
}

function requirePrincipal(db: LocalDatabase): Principal {
  const p = getCurrentPrincipal(db);
  if (!p) throw new Error("errNotSignedIn");
  if (p.doc.suspended) throw new Error("errAccountSuspended");
  return p;
}

function requireRolePrincipal(db: LocalDatabase, ...roles: string[]): Principal {
  const p = requirePrincipal(db);
  if (!roles.includes(p.role)) throw new Error("errNotAuthorized");
  return p;
}

function requireAdminPrincipal(db: LocalDatabase): Principal {
  return requireRolePrincipal(db, "admin");
}

function subscriptionIsLive(sub: LocalSubscription, now = Date.now()): boolean {
  const graceMs = 3 * DAY_MS;
  return sub.status === "active" && sub.expiresAt + graceMs > now;
}

function liveShopSub(db: LocalDatabase, shopId: string, now = Date.now()): LocalSubscription | null {
  const matching = db.subscriptions
    .filter((s) => s.shopId === shopId && subscriptionIsLive(s, now))
    .sort((a, b) => b.expiresAt - a.expiresAt);
  return matching[0] ?? null;
}

function retailerIsSubscribed(db: LocalDatabase, userId: string, now = Date.now()): boolean {
  return db.subscriptions.some(
    (s) => s.ownerId === userId && s.audience === "retailer" && subscriptionIsLive(s, now),
  );
}

function callerMaySeePhones(db: LocalDatabase, principal: Principal | null, now = Date.now()): boolean {
  if (!principal) return false;
  if (principal.role === "admin") return true;
  if (principal.role !== "retailer") return false;
  return retailerIsSubscribed(db, principal.userId, now);
}

function planProductLimitFor(db: LocalDatabase, shop: LocalShop): number {
  const sub = liveShopSub(db, shop._id);
  const plan = sub?.plan ?? "free";
  return PLAN_LIMITS[plan].products;
}

function readLocalPricing(db: LocalDatabase): PricingConfig {
  const raw = db.appConfig["pricing"];
  if (!raw) return DEFAULT_PRICING;
  try {
    return pricingFromRaw(JSON.parse(raw));
  } catch {
    return DEFAULT_PRICING;
  }
}

function addNotification(
  db: LocalDatabase,
  args: { userId: string; type: string; title: string; body: string; link?: string },
): void {
  db.notifications.push({
    _id: nextId(db, "notif"),
    userId: args.userId,
    type: args.type,
    title: args.title,
    body: args.body,
    link: args.link,
    createdAt: Date.now(),
  });
}

function addAudit(
  db: LocalDatabase,
  args: { actorId?: string; action: string; targetType: string; targetId: string; details?: string },
): void {
  db.auditLog.push({
    _id: nextId(db, "audit"),
    ...args,
    createdAt: Date.now(),
  });
}

function publicShopFields(shop: LocalShop, includePhone: boolean) {
  return {
    _id: shop._id,
    _creationTime: shop._creationTime,
    ownerId: shop.ownerId,
    name: shop.name,
    slug: shop.slug,
    wilaya: shop.wilaya,
    commune: shop.commune,
    address: shop.address,
    shopImageStorageId: shop.shopImageStorageId,
    rcNumber: shop.rcNumber,
    categories: shop.categories,
    deliveryOptions: shop.deliveryOptions,
    avgPrepDays: shop.avgPrepDays,
    verification: shop.verification,
    verifiedAt: shop.verifiedAt,
    isActive: shop.isActive,
    responseRate: shop.responseRate,
    medianResponseMinutes: shop.medianResponseMinutes,
    ratingSummary: shop.ratingSummary,
    createdAt: shop.createdAt,
    ...(includePhone ? { whatsappE164: shop.whatsappE164 } : {}),
  };
}

function readCategoriesRows(db: LocalDatabase) {
  if (db.productCategories.length === 0) {
    return CATEGORIES.map((c, index) => ({
      key: c.key,
      ar: c.ar,
      fr: c.fr,
      icon: c.icon,
      order: index,
      active: true,
    }));
  }
  return [...db.productCategories]
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((row) => ({
      key: row.key,
      ar: row.ar,
      fr: row.fr,
      icon: isCategoryIconKey(row.icon) ? row.icon : "Package",
      order: row.order,
      active: row.active,
      ...(row.parent ? { parent: row.parent } : {}),
    }));
}

function checkReviewEligibility(
  db: LocalDatabase,
  productId: string,
  principal: Principal,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const product = db.products.find((p) => p._id === productId);
  if (!product) return { ok: false, reason: "not_found" };
  if (product.ownerId === principal.userId) return { ok: false, reason: "self_review" };
  if (principal.role !== "retailer") return { ok: false, reason: "not_retailer" };

  const existing = db.reviews.find(
    (r) => r.productId === productId && r.retailerId === principal.userId,
  );
  if (existing) return { ok: false, reason: "already_reviewed" };

  const contact = db.contactLogs.find(
    (c) => c.retailerId === principal.userId && c.productId === productId,
  );
  if (!contact) return { ok: false, reason: "no_contact" };
  if (now - contact.createdAt < REVIEW_DELAY_HOURS * 3600_000) {
    return { ok: false, reason: "too_soon" };
  }
  return { ok: true };
}

function refreshProductStats(db: LocalDatabase, productId: string): void {
  const product = db.products.find((p) => p._id === productId);
  if (!product) return;
  const visible = db.reviews.filter((r) => r.productId === productId && r.status === "visible");
  const win = computeWinning(visible.map((r) => r.productRating));
  const sellerAvg = visible.length
    ? visible.reduce((sum, r) => sum + r.sellerRating, 0) / visible.length
    : 0;
  product.reviewCount = visible.length;
  product.avgProductRating = win.avg;
  product.avgSellerRating = sellerAvg;
  product.wilsonScore = win.score;
  product.isWinning = win.isWinning;
}

function refreshShopSummary(db: LocalDatabase, shopId: string): void {
  const shop = db.shops.find((s) => s._id === shopId);
  if (!shop) return;
  const visible = db.reviews.filter((r) => r.shopId === shopId && r.status === "visible");
  const productAvg = visible.length
    ? visible.reduce((sum, r) => sum + r.productRating, 0) / visible.length
    : 0;
  const sellerAvg = visible.length
    ? visible.reduce((sum, r) => sum + r.sellerRating, 0) / visible.length
    : 0;
  shop.ratingSummary = {
    overall: Math.round(productAvg * 100) / 100,
    productAvg: Math.round(productAvg * 100) / 100,
    sellerAvg: Math.round(sellerAvg * 100) / 100,
    count: visible.length,
  };
}

function buildProductCard(
  db: LocalDatabase,
  product: LocalProduct,
  shop: LocalShop,
  entitled: boolean,
  now = Date.now(),
) {
  const trendingSince = now - 7 * DAY_MS;
  let trendingScore = 0;
  for (const s of db.productDailyStats) {
    if (s.productId !== product._id) continue;
    if (Date.parse(s.day) < trendingSince) continue;
    trendingScore += s.views + s.contactClicks * 3;
  }

  return {
    id: product._id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    categoryLabelAr: categoryLabel(product.category, "ar"),
    categoryLabelFr: categoryLabel(product.category, "fr"),
    wholesalePriceDa: product.wholesalePriceDa,
    minQty: product.minQty,
    priceTiers: product.priceTiers,
    stockStatus: product.stockStatus,
    imageStorageIds: product.imageStorageIds,
    isWinning: product.isWinning,
    wilsonScore: product.wilsonScore,
    avgProductRating: product.avgProductRating,
    reviewCount: product.reviewCount,
    isBoosted: product.boostedUntil !== undefined && product.boostedUntil > now,
    wilaya: shop.wilaya,
    wilayaAr: wilayaName(shop.wilaya, "ar"),
    wilayaFr: wilayaName(shop.wilaya, "fr"),
    shopId: shop._id,
    shopSlug: shop.slug,
    shopName: shop.name,
    shopVerified: shop.verification === "approved",
    shopRating: shop.ratingSummary?.overall ?? 0,
    shopResponseRate: shop.responseRate,
    createdAt: product.createdAt,
    trendingScore,
    isVip: product.visibility === "vip",
    ...(entitled && product.visibility !== "vip"
      ? { whatsappE164: shop.whatsappE164 }
      : {}),
  };
}

type CardItem = ReturnType<typeof buildProductCard>;

function rankCard(card: CardItem, sort: string): number {
  const boost = card.isBoosted ? 1e15 : 0;
  const winning = card.isWinning ? 1e12 : 0;
  let val = -card.createdAt;
  if (sort === "price_asc") val = card.wholesalePriceDa;
  else if (sort === "price_desc") val = -card.wholesalePriceDa;
  else if (sort === "top_rated") val = -(card.wilsonScore * 100 + card.avgProductRating);
  else if (sort === "trending") val = -card.trendingScore;
  return boost + winning + val;
}

function teaserOfProduct(product: LocalProduct) {
  return {
    id: product._id,
    slug: product.slug,
    name: product.name,
    description: product.description ?? "",
    category: product.category,
    categoryLabelAr: categoryLabel(product.category, "ar"),
    categoryLabelFr: categoryLabel(product.category, "fr"),
    minQty: product.minQty,
    isPaused: product.isPaused,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    viewCount: product.viewCount,
    visibility: product.visibility ?? "public",
    vip: product.vip ?? {
      allowedWilayas: [],
      maxApprovedBuyers: 0,
      requestsOpen: false,
      status: "closed" as const,
    },
  };
}

function vipSlotLimitFor(db: LocalDatabase, shop: LocalShop | null): number {
  if (!shop) return 0;
  const sub = liveShopSub(db, shop._id);
  const plan = sub?.plan ?? "free";
  const pricing = readLocalPricing(db);
  if (plan === "pro") return pricing.vip.proSlots;
  if (plan === "basic" || plan === "trial") return pricing.vip.basicSlots;
  return 0;
}

function evaluateVipEligibility(
  db: LocalDatabase,
  product: LocalProduct,
  principal: Principal,
  now = Date.now(),
): string | null {
  const blocked = db.vipBlocks.some(
    (b) => b.ownerId === product.ownerId && b.userId === principal.userId,
  );
  const myReq = db.vipRequests.find(
    (r) => r.productId === product._id && r.retailerId === principal.userId,
  );
  const pendingRequestCount = db.vipRequests.filter(
    (r) => r.retailerId === principal.userId && effectiveVipStatus(r, now) === "pending",
  ).length;
  return checkVipEligibility({
    isSignedIn: true,
    emailVerified: Boolean(principal.doc.emailVerificationTime),
    hasActiveRetailerPlan: retailerIsSubscribed(db, principal.userId, now),
    profileComplete: Boolean(principal.doc.wilaya && principal.doc.storeType),
    blockedByThisWholesaler: blocked,
    hasPendingRequest: Boolean(myReq && effectiveVipStatus(myReq, now) === "pending"),
    pendingRequestCount,
    requestsOpen: product.vip?.requestsOpen ?? false,
    productActive: !product.isPaused && (!product.vip || product.vip.status === "active"),
    isOwner: product.ownerId === principal.userId,
  });
}

// ---------------------------------------------------------------------------
// Function Router (executes local queries, mutations, and actions)
// ---------------------------------------------------------------------------

type ArgsObj = Record<string, unknown>;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function executeFunction(name: string, rawArgs: ArgsObj = {}): unknown {
  const db = loadDb();
  const now = Date.now();

  switch (name) {
    // -----------------------------------------------------------------------
    // Users & AuthGuard & Account
    // -----------------------------------------------------------------------
    case "users:currentUser": {
      const p = getCurrentPrincipal(db);
      return p ? p.doc : null;
    }
    case "authGuard:chargeAttempt": {
      const email = normalizeEmail(str(rawArgs.email));
      const kind = str(rawArgs.kind, "signIn");
      if (!email) return;
      const key = `${kind}:${email}`;
      const cur = authGuardAttempts.get(key);
      if (cur?.lockedUntil && cur.lockedUntil > now) {
        const minutes = Math.max(1, Math.ceil((cur.lockedUntil - now) / 60000));
        throw new Error(`errAuthGuard:${kind}:${minutes}`);
      }
      const nextCount = (cur?.count ?? 0) + 1;
      if (nextCount > 8) {
        authGuardAttempts.set(key, { count: 0, lockedUntil: now + 15 * 60_000 });
        throw new Error(`errAuthGuard:${kind}:15`);
      }
      authGuardAttempts.set(key, { count: nextCount });
      return;
    }
    case "authGuard:clearSignInLockout": {
      const email = normalizeEmail(str(rawArgs.email));
      if (email) authGuardAttempts.delete(`signIn:${email}`);
      return { cleared: true };
    }
    case "account:passwordStatus": {
      const p = getCurrentPrincipal(db);
      if (!p) return { hasPassword: false };
      const creds = loadCredentials();
      const hasPassword = Boolean(creds[normalizeEmail(p.doc.email)]?.password);
      return { hasPassword };
    }
    case "account:changePassword": {
      const p = requirePrincipal(db);
      const email = normalizeEmail(p.doc.email);
      const currentPassword = str(rawArgs.currentPassword);
      const newPassword = str(rawArgs.newPassword);
      validatePassword(newPassword);
      if (newPassword === currentPassword) throw new Error("errPasswordUnchanged");
      const creds = loadCredentials();
      if (creds[email]?.password !== currentPassword) {
        throw new Error("errInvalidCredentials");
      }
      creds[email] = { password: newPassword };
      saveCredentials(creds);
      return { changed: true as const };
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------
    case "storage:getUrl":
    case "storage:adminDocumentUrl": {
      const storageId = str(rawArgs.storageId);
      if (!storageId) return null;
      return getBlobUrl(storageId);
    }
    case "storage:createImageUpload": {
      requirePrincipal(db);
      const contentType = str(rawArgs.contentType);
      const sizeBytes = num(rawArgs.sizeBytes);
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new Error("errImageType");
      }
      if (sizeBytes <= 0 || sizeBytes > 4 * 1024 * 1024) {
        throw new Error("errImageSize");
      }
      return {
        uploadUrl: `${LOCAL_UPLOAD_PREFIX}${Date.now()}`,
        kind: str(rawArgs.kind, "product"),
      };
    }
    case "storage:createDocumentUpload": {
      requirePrincipal(db);
      const contentType = str(rawArgs.contentType);
      const sizeBytes = num(rawArgs.sizeBytes);
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(contentType)) {
        throw new Error("errImageType");
      }
      if (sizeBytes <= 0 || sizeBytes > 8 * 1024 * 1024) {
        throw new Error("errImageSize");
      }
      return { uploadUrl: `${LOCAL_UPLOAD_PREFIX}${Date.now()}` };
    }

    // -----------------------------------------------------------------------
    // Catalog
    // -----------------------------------------------------------------------
    case "catalog:categories": {
      return readCategoriesRows(db);
    }
    case "catalog:wilayas": {
      return WILAYAS;
    }
    case "catalog:feed": {
      const principal = getCurrentPrincipal(db);
      const entitled = callerMaySeePhones(db, principal, now);
      const activeShopMap = new Map<string, LocalShop>();
      for (const s of db.shops) {
        if (s.isActive && liveShopSub(db, s._id, now) !== null) {
          activeShopMap.set(s._id, s);
        }
      }

      const cards: CardItem[] = [];
      for (const product of db.products) {
        if (product.isPaused) continue;
        const shop = activeShopMap.get(product.shopId);
        if (!shop) continue;
        cards.push(buildProductCard(db, product, shop, entitled, now));
      }

      cards.sort((a, b) => rankCard(b, "trending") - rankCard(a, "trending"));
      const trending = cards.filter((c) => c.trendingScore > 0).slice(0, 12);
      const winning = cards.filter((c) => c.isWinning).slice(0, 12);
      const fresh = [...cards].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
      const rest = cards.filter((c) => !trending.some((t) => t.id === c.id));

      return {
        trending,
        winning,
        newArrivals: fresh,
        all: rest.slice(0, 24),
        hasMore: rest.length > 24,
        categories: readCategoriesRows(db),
        isEntitled: entitled,
        counts: {
          products: cards.length,
          wilayas: new Set(cards.map((c) => c.wilaya)).size,
          verifiedShops: new Set(cards.filter((c) => c.shopVerified).map((c) => c.shopId)).size,
          reviews: db.reviews.filter((r) => r.status === "visible").length,
        },
        now,
      };
    }
    case "catalog:search": {
      const principal = getCurrentPrincipal(db);
      const entitled = callerMaySeePhones(db, principal, now);
      const sort = str(rawArgs.sort, "newest");
      const limit = Math.min(num(rawArgs.limit, 24), 60);
      const cursor = num(rawArgs.cursor, 0);

      const results: CardItem[] = [];
      for (const product of db.products) {
        if (product.isPaused) continue;
        const shop = db.shops.find((s) => s._id === product.shopId);
        if (!shop || !shop.isActive || !liveShopSub(db, shop._id, now)) continue;

        if (rawArgs.category && product.category !== rawArgs.category) continue;
        if (rawArgs.wilaya !== undefined && shop.wilaya !== rawArgs.wilaya) continue;
        if (rawArgs.minPrice !== undefined && product.wholesalePriceDa < num(rawArgs.minPrice)) continue;
        if (rawArgs.maxPrice !== undefined && product.wholesalePriceDa > num(rawArgs.maxPrice)) continue;
        if (rawArgs.maxMinQty !== undefined && product.minQty > num(rawArgs.maxMinQty)) continue;
        if (rawArgs.minRating !== undefined && product.avgProductRating < num(rawArgs.minRating)) continue;
        if (rawArgs.winningOnly && !product.isWinning) continue;
        if (rawArgs.verifiedOnly && shop.verification !== "approved") continue;
        if (rawArgs.inStockOnly && product.stockStatus === "out") continue;
        if (rawArgs.vipOnly && product.visibility !== "vip") continue;

        if (typeof rawArgs.q === "string" && rawArgs.q.trim()) {
          const blob = `${product.name} ${product.tags.join(" ")} ${shop.name}`;
          if (!fuzzyMatches(blob, rawArgs.q)) continue;
        }
        results.push(buildProductCard(db, product, shop, entitled, now));
      }

      results.sort((a, b) => rankCard(b, sort) - rankCard(a, sort));
      return {
        results: results.slice(cursor, cursor + limit),
        total: results.length,
        nextCursor: cursor + limit < results.length ? cursor + limit : null,
      };
    }
    case "catalog:productBySlug": {
      const slug = str(rawArgs.slug);
      const resolved = db.products.find((p) => p.slug === slug);
      if (!resolved) return null;

      const principal = getCurrentPrincipal(db);
      const entitled = callerMaySeePhones(db, principal, now) && resolved.visibility !== "vip";
      const shopDoc = db.shops.find((s) => s._id === resolved.shopId);
      if (!shopDoc) return null;

      const isOwner = principal?.userId === resolved.ownerId;
      const isAdmin = principal?.role === "admin";
      if (!isOwner && !isAdmin) {
        if (!shopDoc.isActive || !liveShopSub(db, shopDoc._id, now)) return null;
      }

      const shop = publicShopFields(shopDoc, entitled);
      const visibleReviews = db.reviews
        .filter((r) => r.productId === resolved._id && r.status === "visible")
        .sort((a, b) => b.createdAt - a.createdAt);

      const breakdown = [1, 2, 3, 4, 5].map((star) => ({
        star,
        product: visibleReviews.filter((r) => r.productRating === star).length,
        seller: visibleReviews.filter((r) => r.sellerRating === star).length,
      }));

      const relatedCards: CardItem[] = [];
      for (const p of db.products) {
        if (p._id === resolved._id || p.isPaused || p.category !== resolved.category) continue;
        const s = db.shops.find((sh) => sh._id === p.shopId);
        if (!s || !s.isActive || !liveShopSub(db, s._id, now)) continue;
        relatedCards.push(buildProductCard(db, p, s, entitled, now));
        if (relatedCards.length >= 8) break;
      }

      const isFavorite = principal
        ? db.favorites.some((f) => f.userId === principal.userId && f.productId === resolved._id)
        : false;
      const eligible = principal
        ? checkReviewEligibility(db, resolved._id, principal, now)
        : { ok: false as const, reason: "signed_out" };

      return {
        product: {
          ...resolved,
          categoryLabelAr: categoryLabel(resolved.category, "ar"),
          categoryLabelFr: categoryLabel(resolved.category, "fr"),
        },
        shop: {
          ...shop,
          wilayaAr: wilayaName(shop.wilaya, "ar"),
          wilayaFr: wilayaName(shop.wilaya, "fr"),
        },
        reviews: visibleReviews.map((r) => {
          const author = db.users.find((u) => u._id === r.retailerId);
          return {
            id: r._id,
            productRating: r.productRating,
            sellerRating: r.sellerRating,
            comment: r.comment,
            claimedPurchase: r.claimedPurchase ?? false,
            verifiedContact: r.verifiedContact,
            reply: r.reply,
            repliedAt: r.repliedAt,
            createdAt: r.createdAt,
            authorName: author?.name ?? "تاجر",
          };
        }),
        breakdown,
        related: relatedCards,
        isFavorite,
        isBoosted: resolved.boostedUntil !== undefined && resolved.boostedUntil > now,
        canReview: eligible.ok,
        canReviewReason: eligible.ok ? null : eligible.reason,
        canSeeWhatsapp: Boolean(shop.whatsappE164) && entitled,
      };
    }
    case "catalog:shopBySlug": {
      const slug = str(rawArgs.slug);
      const shopDoc = db.shops.find((s) => s.slug === slug);
      if (!shopDoc) return null;

      const principal = getCurrentPrincipal(db);
      const entitled = callerMaySeePhones(db, principal, now);
      const isOwner = principal?.userId === shopDoc.ownerId;
      const isAdmin = principal?.role === "admin";
      if (!isOwner && !isAdmin && !shopDoc.isActive) return null;

      const shopProducts = db.products.filter(
        (p) => p.shopId === shopDoc._id && (!p.isPaused || isOwner),
      );
      const live = liveShopSub(db, shopDoc._id, now);

      if (!live && !isOwner && !isAdmin) {
        return {
          shop: {
            ...publicShopFields(shopDoc, entitled),
            wilayaAr: wilayaName(shopDoc.wilaya, "ar"),
            wilayaFr: wilayaName(shopDoc.wilaya, "fr"),
          },
          products: [],
          stats: { count: 0, winning: 0, categories: [] as string[], reviews: 0 },
          subscriptionLive: false,
          canSeeWhatsapp: entitled && Boolean(shopDoc.whatsappE164),
        };
      }

      const cards = shopProducts
        .map((p) => buildProductCard(db, p, shopDoc, entitled, now))
        .sort((a, b) => b.createdAt - a.createdAt);
      const visibleReviews = db.reviews.filter(
        (r) => r.shopId === shopDoc._id && r.status === "visible",
      );

      return {
        shop: {
          ...publicShopFields(shopDoc, entitled),
          wilayaAr: wilayaName(shopDoc.wilaya, "ar"),
          wilayaFr: wilayaName(shopDoc.wilaya, "fr"),
          ratingSummary: shopDoc.ratingSummary ?? {
            overall: 0,
            count: 0,
            productAvg: 0,
            sellerAvg: 0,
          },
        },
        products: cards,
        stats: {
          count: cards.length,
          winning: cards.filter((c) => c.isWinning).length,
          categories: [...new Set(cards.map((c) => c.category))],
          reviews: visibleReviews.length,
        },
        subscriptionLive: Boolean(live),
        canSeeWhatsapp: entitled && Boolean(shopDoc.whatsappE164),
      };
    }

    // -----------------------------------------------------------------------
    // Wholesaler Onboarding & Product CRUD
    // -----------------------------------------------------------------------
    case "wholesaler:completeWholesalerOnboarding": {
      const principal = requirePrincipal(db);
      const phone = normalizeAlgerianPhone(str(rawArgs.whatsapp));
      if (!phone) throw new Error("errInvalidPhone");
      if (principal.shop) throw new Error("alreadyOnboarded");

      const shopName = cleanText(str(rawArgs.shopName), 80);
      const ownerName = cleanText(str(rawArgs.ownerName), 80);
      if (!shopName || !ownerName) throw new Error("errRequired");

      const shopId = nextId(db, "shop");
      const wilaya = num(rawArgs.wilaya, 16);
      const rcNumber = optStr(rawArgs.rcNumber);

      const newShop: LocalShop = {
        _id: shopId,
        _creationTime: now,
        ownerId: principal.userId,
        name: shopName,
        slug: `${slugify(shopName) || "shop"}-${Math.random().toString(36).slice(2, 7)}`,
        wilaya,
        commune: rawArgs.commune ? cleanText(str(rawArgs.commune), 60) : undefined,
        address: rawArgs.address ? cleanText(str(rawArgs.address), 200) : undefined,
        whatsappE164: phone,
        shopImageStorageId: optStr(rawArgs.shopImageStorageId),
        rcNumber: rcNumber ? cleanText(rcNumber, 40) : undefined,
        categories: arr<string>(rawArgs.categories).slice(0, 8),
        deliveryOptions: arr<string>(rawArgs.deliveryOptions).slice(0, 5),
        avgPrepDays: Math.max(0, Math.round(num(rawArgs.avgPrepDays, 2))),
        verification: rcNumber ? "pending" : "none",
        isActive: true,
        responseRate: 1,
        createdAt: now,
      };
      db.shops.push(newShop);

      // Grant an active 14-day trial subscription so newly onboarded wholesalers can immediately list & sell products
      db.subscriptions.push({
        _id: nextId(db, "sub"),
        ownerId: principal.userId,
        shopId,
        audience: "wholesaler",
        plan: "trial",
        status: "active",
        isTrial: true,
        startedAt: now,
        expiresAt: now + 14 * DAY_MS,
      });

      principal.doc.role = "wholesaler";
      principal.doc.name = ownerName;
      principal.doc.ownerName = shopName;
      principal.doc.wilaya = wilaya;
      principal.doc.commune = optStr(rawArgs.commune);
      principal.doc.whatsappE164 = phone;
      principal.doc.onboardedAt = now;

      saveDb(db);
      syncRegisteredUsersMirror(db);
      setSessionUser(principal.doc);
      return { shopId };
    }
    case "wholesaler:completeRetailerOnboarding": {
      const principal = requirePrincipal(db);
      const phone = normalizeAlgerianPhone(str(rawArgs.whatsapp));
      if (!phone) throw new Error("errInvalidPhone");
      const name = cleanText(str(rawArgs.name), 80);
      if (!name) throw new Error("errRequired");

      principal.doc.role = "retailer";
      principal.doc.name = name;
      principal.doc.wilaya = num(rawArgs.wilaya, 16);
      principal.doc.whatsappE164 = phone;
      principal.doc.storeType = cleanText(str(rawArgs.storeType, "facebook"), 30);
      principal.doc.storeLink = rawArgs.storeLink
        ? cleanText(str(rawArgs.storeLink), 200)
        : undefined;
      principal.doc.niches = arr<string>(rawArgs.niches).slice(0, 8);
      principal.doc.onboardedAt = now;

      // Grant a 14-day retailer trial if no subscription exists yet so buyer contact/VIP flows work seamlessly
      if (!retailerIsSubscribed(db, principal.userId, now)) {
        db.subscriptions.push({
          _id: nextId(db, "sub"),
          ownerId: principal.userId,
          audience: "retailer",
          plan: "trial",
          status: "active",
          isTrial: true,
          startedAt: now,
          expiresAt: now + 14 * DAY_MS,
        });
      }

      saveDb(db);
      syncRegisteredUsersMirror(db);
      setSessionUser(principal.doc);
      return { ok: true };
    }
    case "wholesaler:setLanguage": {
      const p = getCurrentPrincipal(db);
      if (p) {
        p.doc.language = rawArgs.lang === "fr" ? "fr" : "ar";
        saveDb(db);
        setSessionUser(p.doc);
      }
      return rawArgs.lang === "fr" ? "fr" : "ar";
    }
    case "wholesaler:myProducts": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      if (!shop) return { products: [], shopId: null, sub: null, shop: null };

      const list = db.products
        .filter((p) => p.shopId === shop._id)
        .sort((a, b) => b.createdAt - a.createdAt);
      const sub = liveShopSub(db, shop._id, now);

      return {
        products: list.map((p) => ({
          ...p,
          canBoost: sub?.plan === "pro" || sub?.plan === "basic",
        })),
        shopId: shop._id,
        sub: sub
          ? { plan: sub.plan, expiresAt: sub.expiresAt, isTrial: sub.isTrial ?? false }
          : null,
        shop: {
          name: shop.name,
          verification: shop.verification,
          responseRate: shop.responseRate,
          medianResponseMinutes: shop.medianResponseMinutes,
        },
      };
    }
    case "wholesaler:createProduct": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      if (!shop) throw new Error("errNotAuthorized");

      const limit = planProductLimitFor(db, shop);
      const currentCount = db.products.filter((p) => p.shopId === shop._id).length;
      if (limit !== Number.POSITIVE_INFINITY && currentCount >= limit) {
        throw new Error("errPlanProductLimit");
      }

      const productName = cleanText(str(rawArgs.name), 120);
      if (!productName) throw new Error("errRequired");
      const basePrice = Math.round(num(rawArgs.wholesalePriceDa));
      if (basePrice <= 0) throw new Error("errRequired");

      const imageIds = arr<string>(rawArgs.imageStorageIds);
      if (imageIds.length > 5) throw new Error("errTooManyImages");

      const rawTiers = arr<LocalPriceTier>(rawArgs.priceTiers)
        .filter((t) => t.minQty > 0 && t.priceDa > 0)
        .sort((a, b) => a.minQty - b.minQty)
        .slice(0, 6)
        .map((t) => ({ minQty: Math.round(t.minQty), priceDa: Math.round(t.priceDa) }));
      for (const tier of rawTiers) {
        if (tier.priceDa >= basePrice) throw new Error("errTierNotCheaper");
      }

      const productId = nextId(db, "prod");
      const stockStatusRaw = str(rawArgs.stockStatus, "in_stock");
      const stockStatus: LocalProduct["stockStatus"] =
        stockStatusRaw === "low" || stockStatusRaw === "out" ? stockStatusRaw : "in_stock";

      const newProduct: LocalProduct = {
        _id: productId,
        _creationTime: now,
        shopId: shop._id,
        ownerId: principal.userId,
        name: productName,
        nameFr: rawArgs.nameFr ? cleanText(str(rawArgs.nameFr), 120) : undefined,
        slug: `${slugify(productName) || "product"}-${Math.random().toString(36).slice(2, 7)}`,
        category: str(rawArgs.category, "other"),
        description: rawArgs.description ? cleanText(str(rawArgs.description), 1200) : undefined,
        wholesalePriceDa: basePrice,
        minQty: Math.max(1, Math.round(num(rawArgs.minQty, 10))),
        priceTiers: rawTiers,
        stockStatus,
        prepDays: Math.max(0, Math.round(num(rawArgs.prepDays, 2))),
        tags: arr<string>(rawArgs.tags)
          .map((t) => cleanText(t, 24))
          .filter(Boolean)
          .slice(0, 8),
        imageStorageIds: imageIds.slice(0, 5),
        isPaused: false,
        reviewCount: 0,
        avgProductRating: 0,
        avgSellerRating: 0,
        wilsonScore: 0,
        isWinning: false,
        viewCount: 0,
        favoriteCount: 0,
        contactCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      db.products.push(newProduct);
      saveDb(db);
      return { productId };
    }
    case "wholesaler:updateProduct": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      if (!shop) throw new Error("errNotAuthorized");
      const product = db.products.find((p) => p._id === str(rawArgs.productId));
      if (!product) throw new Error("errNotFound");
      if (product.shopId !== shop._id) throw new Error("errNotAuthorized");

      const oldPrice = product.wholesalePriceDa;
      if (rawArgs.name !== undefined) {
        const cleanName = cleanText(str(rawArgs.name), 120);
        if (!cleanName) throw new Error("errRequired");
        product.name = cleanName;
      }
      if (rawArgs.category !== undefined) product.category = str(rawArgs.category, product.category);
      if (rawArgs.description !== undefined) {
        product.description = rawArgs.description
          ? cleanText(str(rawArgs.description), 1200)
          : undefined;
      }
      if (rawArgs.wholesalePriceDa !== undefined) {
        const nextPrice = Math.round(num(rawArgs.wholesalePriceDa));
        if (nextPrice <= 0) throw new Error("errRequired");
        product.wholesalePriceDa = nextPrice;
      }
      if (rawArgs.minQty !== undefined) {
        product.minQty = Math.max(1, Math.round(num(rawArgs.minQty, product.minQty)));
      }
      if (rawArgs.stockStatus !== undefined) {
        const s = str(rawArgs.stockStatus);
        if (s === "in_stock" || s === "low" || s === "out") product.stockStatus = s;
      }
      if (rawArgs.prepDays !== undefined) {
        product.prepDays = Math.max(0, Math.round(num(rawArgs.prepDays, product.prepDays)));
      }
      if (rawArgs.tags !== undefined) {
        product.tags = arr<string>(rawArgs.tags)
          .map((t) => cleanText(t, 24))
          .filter(Boolean)
          .slice(0, 8);
      }
      if (rawArgs.imageStorageIds !== undefined) {
        const imgs = arr<string>(rawArgs.imageStorageIds);
        if (imgs.length > 5) throw new Error("errTooManyImages");
        product.imageStorageIds = imgs.slice(0, 5);
      }
      if (rawArgs.priceTiers !== undefined) {
        const cleanTiers = arr<LocalPriceTier>(rawArgs.priceTiers)
          .filter((t) => t.minQty > 0 && t.priceDa > 0)
          .sort((a, b) => a.minQty - b.minQty)
          .slice(0, 6)
          .map((t) => ({ minQty: Math.round(t.minQty), priceDa: Math.round(t.priceDa) }));
        for (const tier of cleanTiers) {
          if (tier.priceDa >= product.wholesalePriceDa) throw new Error("errTierNotCheaper");
        }
        product.priceTiers = cleanTiers;
      }
      product.updatedAt = now;

      if (product.wholesalePriceDa < oldPrice) {
        for (const fav of db.favorites.filter((f) => f.productId === product._id)) {
          addNotification(db, {
            userId: fav.userId,
            type: "price_drop",
            title: "انخفاض في السعر",
            body: `${product.name} نزل من ${oldPrice} دج إلى ${product.wholesalePriceDa} دج`,
            link: `/product/${product.slug}`,
          });
        }
      }

      saveDb(db);
      return { ok: true };
    }
    case "wholesaler:deleteProduct": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const id = str(rawArgs.productId);
      const idx = db.products.findIndex((p) => p._id === id);
      if (idx === -1) throw new Error("errNotFound");
      if (principal.role !== "admin" && db.products[idx].ownerId !== principal.userId) {
        throw new Error("errNotAuthorized");
      }
      db.products.splice(idx, 1);
      saveDb(db);
      return { ok: true };
    }
    case "wholesaler:duplicateProduct": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      if (!shop) throw new Error("errNotAuthorized");
      const limit = planProductLimitFor(db, shop);
      const count = db.products.filter((p) => p.shopId === shop._id).length;
      if (limit !== Number.POSITIVE_INFINITY && count >= limit) {
        throw new Error("errPlanProductLimit");
      }
      const source = db.products.find((p) => p._id === str(rawArgs.productId));
      if (!source || source.shopId !== shop._id) throw new Error("errNotAuthorized");

      const copyName = cleanText(`${source.name} (نسخة)`, 120);
      const newId = nextId(db, "prod");
      db.products.push({
        ...source,
        _id: newId,
        _creationTime: now,
        name: copyName,
        slug: `${slugify(copyName) || "product"}-${Math.random().toString(36).slice(2, 7)}`,
        reviewCount: 0,
        avgProductRating: 0,
        avgSellerRating: 0,
        wilsonScore: 0,
        isWinning: false,
        viewCount: 0,
        favoriteCount: 0,
        contactCount: 0,
        isPaused: false,
        boostedUntil: undefined,
        createdAt: now,
        updatedAt: now,
      });
      saveDb(db);
      return { productId: newId };
    }
    case "wholesaler:toggleProductPause": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const product = db.products.find((p) => p._id === str(rawArgs.productId));
      if (!product) throw new Error("errNotFound");
      if (product.ownerId !== principal.userId && principal.role !== "admin") {
        throw new Error("errNotAuthorized");
      }
      product.isPaused = !product.isPaused;
      product.updatedAt = now;
      saveDb(db);
      return { isPaused: product.isPaused };
    }
    case "wholesaler:toggleFavorite": {
      const principal = requirePrincipal(db);
      const product = db.products.find((p) => p._id === str(rawArgs.productId));
      if (!product) throw new Error("errNotFound");
      const existingIdx = db.favorites.findIndex(
        (f) => f.userId === principal.userId && f.productId === product._id,
      );
      if (existingIdx >= 0) {
        db.favorites.splice(existingIdx, 1);
        product.favoriteCount = Math.max(0, product.favoriteCount - 1);
        saveDb(db);
        return { isFavorite: false };
      }
      db.favorites.push({
        _id: nextId(db, "fav"),
        userId: principal.userId,
        productId: product._id,
        createdAt: now,
        priceAtFavoriteDa: product.wholesalePriceDa,
      });
      product.favoriteCount += 1;
      saveDb(db);
      return { isFavorite: true };
    }
    case "wholesaler:recordView": {
      const product = db.products.find((p) => p._id === str(rawArgs.productId));
      if (!product) return { ok: false };
      product.viewCount += 1;
      saveDb(db);
      return { ok: true };
    }
    case "wholesaler:productStats": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      if (!shop) {
        return { series: [], totals: { views: 0, favorites: 0, contacts: 0 }, perProduct: [] };
      }
      const shopProducts = db.products.filter((p) => p.shopId === shop._id);
      const ids = new Set(shopProducts.map((p) => p._id));
      const daysCount = Number(str(rawArgs.days, "7")) || 7;
      const since = now - daysCount * DAY_MS;

      const seriesMap = new Map<
        string,
        { day: string; views: number; favorites: number; contacts: number }
      >();
      const perProductMap = new Map<
        string,
        {
          productId: string;
          name: string;
          views: number;
          contacts: number;
          favorites: number;
          conversion: number;
        }
      >();

      for (const p of shopProducts) {
        perProductMap.set(p._id, {
          productId: p._id,
          name: p.name,
          views: p.viewCount,
          contacts: p.contactCount,
          favorites: p.favoriteCount,
          conversion: p.viewCount > 0 ? p.contactCount / p.viewCount : 0,
        });
      }

      for (const s of db.productDailyStats) {
        if (!ids.has(s.productId)) continue;
        if (Date.parse(s.day) < since) continue;
        const bucket = seriesMap.get(s.day) ?? {
          day: s.day,
          views: 0,
          favorites: 0,
          contacts: 0,
        };
        bucket.views += s.views;
        bucket.favorites += s.favorites;
        bucket.contacts += s.contactClicks;
        seriesMap.set(s.day, bucket);
      }

      const series = [...seriesMap.values()].sort((a, b) => a.day.localeCompare(b.day));
      const totals = series.reduce(
        (acc, d) => ({
          views: acc.views + d.views,
          favorites: acc.favorites + d.favorites,
          contacts: acc.contacts + d.contacts,
        }),
        { views: 0, favorites: 0, contacts: 0 },
      );

      return {
        series,
        totals,
        perProduct: [...perProductMap.values()].sort((a, b) => b.views - a.views),
      };
    }

    // -----------------------------------------------------------------------
    // Contact, Chat & Quotes
    // -----------------------------------------------------------------------
    case "contact:contactEntitlement": {
      const principal = getCurrentPrincipal(db);
      if (!principal) {
        return { signedIn: false, role: null, subscribed: false, maySeePhones: false };
      }
      const subscribed =
        principal.role === "retailer" ? retailerIsSubscribed(db, principal.userId, now) : false;
      return {
        signedIn: true,
        role: principal.role,
        subscribed,
        maySeePhones: callerMaySeePhones(db, principal, now),
      };
    }
    case "contact:revealWhatsapp": {
      const principal = requirePrincipal(db);
      if (principal.role !== "retailer") throw new Error("errNotAuthorized");
      if (!retailerIsSubscribed(db, principal.userId, now)) {
        throw new Error("errSubscriptionRequired");
      }
      const shop = db.shops.find((s) => s._id === str(rawArgs.shopId));
      if (!shop) throw new Error("errNotFound");

      const productId = optStr(rawArgs.productId);
      db.contactLogs.push({
        _id: nextId(db, "clog"),
        retailerId: principal.userId,
        shopId: shop._id,
        productId,
        channel: "whatsapp",
        createdAt: now,
      });
      if (productId) {
        const product = db.products.find((p) => p._id === productId);
        if (product) product.contactCount += 1;
      }
      saveDb(db);
      return {
        whatsappE164: shop.whatsappE164,
        shopName: shop.name,
        productName: rawArgs.productName ?? null,
        productUrl: rawArgs.productUrl ?? null,
        productSlug: rawArgs.productSlug ?? null,
      };
    }
    case "contact:startChat": {
      const principal = requirePrincipal(db);
      if (principal.role !== "retailer") throw new Error("errNotAuthorized");
      if (!retailerIsSubscribed(db, principal.userId, now)) {
        throw new Error("errSubscriptionRequired");
      }
      const body = cleanText(str(rawArgs.firstMessage), 1000);
      if (!body) throw new Error("errRequired");
      const shop = db.shops.find((s) => s._id === str(rawArgs.shopId));
      if (!shop) throw new Error("errNotFound");

      let thread = db.chatThreads.find(
        (t) => t.retailerId === principal.userId && t.shopId === shop._id,
      );
      if (!thread) {
        thread = {
          _id: nextId(db, "thread"),
          retailerId: principal.userId,
          shopId: shop._id,
          productId: optStr(rawArgs.productId),
          lastMessageAt: now,
          lastMessagePreview: body.slice(0, 120),
          lastRetailerAt: now,
        };
        db.chatThreads.push(thread);
      } else {
        thread.lastMessageAt = now;
        thread.lastMessagePreview = body.slice(0, 120);
        thread.lastRetailerAt = now;
      }
      db.messages.push({
        _id: nextId(db, "msg"),
        threadId: thread._id,
        senderId: principal.userId,
        body,
        createdAt: now,
      });
      addNotification(db, {
        userId: shop.ownerId,
        type: "message",
        title: "رسالة جديدة",
        body: body.slice(0, 120),
        link: "/dashboard/messages",
      });
      saveDb(db);
      return { threadId: thread._id };
    }
    case "contact:sendMessage": {
      const principal = requirePrincipal(db);
      const thread = db.chatThreads.find((t) => t._id === str(rawArgs.threadId));
      if (!thread) throw new Error("errNotFound");
      const shop = db.shops.find((s) => s._id === thread.shopId);
      const isShopOwner = shop?.ownerId === principal.userId;
      if (thread.retailerId !== principal.userId && !isShopOwner && principal.role !== "admin") {
        throw new Error("errNotAuthorized");
      }
      const body = cleanText(str(rawArgs.body), 1000);
      if (!body) throw new Error("errRequired");
      db.messages.push({
        _id: nextId(db, "msg"),
        threadId: thread._id,
        senderId: principal.userId,
        body,
        createdAt: now,
      });
      thread.lastMessageAt = now;
      thread.lastMessagePreview = body.slice(0, 120);
      if (isShopOwner) {
        thread.lastShopAt = now;
      } else {
        thread.lastRetailerAt = now;
      }
      saveDb(db);
      return { ok: true };
    }
    case "contact:markThreadRead": {
      const principal = requirePrincipal(db);
      const threadId = str(rawArgs.threadId);
      for (const m of db.messages) {
        if (m.threadId === threadId && m.senderId !== principal.userId && m.readAt === undefined) {
          m.readAt = now;
        }
      }
      saveDb(db);
      return { ok: true };
    }
    case "contact:myThreads": {
      const principal = requirePrincipal(db);
      const isWholesaler = principal.role === "wholesaler";
      const shopId = principal.shop?._id;
      const rows = db.chatThreads
        .filter((t) => (isWholesaler && shopId ? t.shopId === shopId : t.retailerId === principal.userId))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

      return rows.map((t) => {
        const shop = db.shops.find((s) => s._id === t.shopId);
        const retailer = db.users.find((u) => u._id === t.retailerId);
        return {
          id: t._id,
          shopId: t.shopId,
          shopName: shop?.name ?? "تاجر",
          counterpartName: isWholesaler ? (retailer?.name ?? "بائع") : (shop?.name ?? "تاجر"),
          lastMessagePreview: t.lastMessagePreview ?? "",
          lastMessageAt: t.lastMessageAt,
          productId: t.productId ?? null,
          firstResponseMinutes: t.firstResponseMinutes ?? null,
        };
      });
    }
    case "contact:threadMessages": {
      const principal = requirePrincipal(db);
      const thread = db.chatThreads.find((t) => t._id === str(rawArgs.threadId));
      if (!thread) return [];
      const shop = db.shops.find((s) => s._id === thread.shopId);
      const allowed =
        thread.retailerId === principal.userId ||
        shop?.ownerId === principal.userId ||
        principal.role === "admin";
      if (!allowed) throw new Error("errNotAuthorized");
      return db.messages
        .filter((m) => m.threadId === thread._id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => ({
          id: m._id,
          body: m.body,
          createdAt: m.createdAt,
          mine: m.senderId === principal.userId,
        }));
    }
    case "contact:createQuoteRequest": {
      const principal = requirePrincipal(db);
      if (principal.role !== "retailer") throw new Error("errNotAuthorized");
      const productName = cleanText(str(rawArgs.productName), 120);
      const note = rawArgs.note ? cleanText(str(rawArgs.note), 600) : undefined;
      if (note && containsLinkOrPhone(note)) throw new Error("errNoLinksInPublicText");
      const quantity = Math.round(num(rawArgs.quantity));
      if (!productName || quantity <= 0) throw new Error("errRequired");

      const reqId = nextId(db, "quote");
      const wilaya = num(rawArgs.wilaya, 16);
      const category = str(rawArgs.category, "other");
      db.quoteRequests.push({
        _id: reqId,
        retailerId: principal.userId,
        productName,
        category,
        quantity,
        targetPriceDa: rawArgs.targetPriceDa ? Math.round(num(rawArgs.targetPriceDa)) : undefined,
        wilaya,
        note,
        status: "open",
        createdAt: now,
        expiresAt: now + QUOTE_EXPIRY_DAYS * DAY_MS,
      });

      let notified = 0;
      for (const s of db.shops) {
        if (s.isActive && s.wilaya === wilaya && s.categories.includes(category)) {
          addNotification(db, {
            userId: s.ownerId,
            type: "quote_reply",
            title: "طلب عرض جديد",
            body: `${productName} — ${quantity} قطعة`,
            link: "/dashboard/quotes",
          });
          notified += 1;
        }
      }
      saveDb(db);
      return { requestId: reqId, notified };
    }
    case "contact:myQuoteRequests": {
      const principal = requirePrincipal(db);
      return db.quoteRequests
        .filter((r) => r.retailerId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => {
          const offers = db.quoteOffers
            .filter((o) => o.requestId === r._id)
            .map((o) => {
              const shop = db.shops.find((s) => s._id === o.shopId);
              return {
                id: o._id,
                priceDa: o.priceDa,
                quantityAvailable: o.quantityAvailable,
                note: o.note,
                shopName: shop?.name ?? "تاجر",
                shopVerified: shop?.verification === "approved",
                shopId: o.shopId,
                createdAt: o.createdAt,
              };
            })
            .sort((a, b) => a.priceDa - b.priceDa);

          return {
            id: r._id,
            productName: r.productName,
            category: r.category,
            quantity: r.quantity,
            targetPriceDa: r.targetPriceDa ?? null,
            wilaya: r.wilaya,
            note: r.note ?? null,
            status: now > r.expiresAt && r.status === "open" ? "expired" : r.status,
            createdAt: r.createdAt,
            expiresAt: r.expiresAt,
            offers,
          };
        });
    }
    case "contact:matchingQuoteRequests": {
      const principal = requirePrincipal(db);
      const shop = principal.shop;
      if (!shop) return [];
      return db.quoteRequests
        .filter(
          (r) =>
            r.status === "open" &&
            r.expiresAt >= now &&
            r.retailerId !== principal.userId &&
            shop.categories.includes(r.category) &&
            shop.wilaya === r.wilaya,
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => {
          const offers = db.quoteOffers.filter((o) => o.requestId === r._id);
          const mine = offers.find((o) => o.shopId === shop._id);
          return {
            id: r._id,
            productName: r.productName,
            category: r.category,
            quantity: r.quantity,
            targetPriceDa: r.targetPriceDa ?? null,
            wilaya: r.wilaya,
            note: r.note ?? null,
            createdAt: r.createdAt,
            expiresAt: r.expiresAt,
            offerCount: offers.length,
            myOffer: mine
              ? { id: mine._id, priceDa: mine.priceDa, quantityAvailable: mine.quantityAvailable }
              : null,
          };
        });
    }
    case "contact:submitQuoteOffer": {
      const principal = requireRolePrincipal(db, "wholesaler");
      const shop = principal.shop;
      if (!shop) throw new Error("errNotAuthorized");
      const request = db.quoteRequests.find((r) => r._id === str(rawArgs.requestId));
      if (!request) throw new Error("errNotFound");
      if (request.expiresAt < now) throw new Error("errRequestExpired");
      if (request.status !== "open") throw new Error("errRequestClosed");
      const priceDa = Math.round(num(rawArgs.priceDa));
      const qtyAvail = Math.round(num(rawArgs.quantityAvailable));
      if (priceDa <= 0 || qtyAvail <= 0) throw new Error("errRequired");
      const note = rawArgs.note ? cleanText(str(rawArgs.note), 400) : undefined;
      if (note && containsLinkOrPhone(note)) throw new Error("errNoLinksInPublicText");

      const mine = db.quoteOffers.find(
        (o) => o.requestId === request._id && o.shopId === shop._id,
      );
      if (mine) {
        mine.priceDa = priceDa;
        mine.quantityAvailable = qtyAvail;
        mine.note = note;
      } else {
        db.quoteOffers.push({
          _id: nextId(db, "offer"),
          requestId: request._id,
          shopId: shop._id,
          ownerId: principal.userId,
          priceDa,
          quantityAvailable: qtyAvail,
          note,
          createdAt: now,
        });
      }
      addNotification(db, {
        userId: request.retailerId,
        type: "quote_reply",
        title: "عرض سعر جديد",
        body: `${shop.name}: ${priceDa} دج`,
        link: "/quotes",
      });
      saveDb(db);
      return { ok: true };
    }
    case "contact:closeQuoteRequest": {
      const principal = requirePrincipal(db);
      const req = db.quoteRequests.find((r) => r._id === str(rawArgs.requestId));
      if (!req) throw new Error("errNotFound");
      if (req.retailerId !== principal.userId && principal.role !== "admin") {
        throw new Error("errNotAuthorized");
      }
      req.status = "closed";
      saveDb(db);
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    // Pricing & Billing
    // -----------------------------------------------------------------------
    case "pricing:get": {
      const raw = db.appConfig["pricing"];
      if (!raw) return { pricing: null, isDefault: true };
      try {
        return { pricing: pricingFromRaw(JSON.parse(raw)), isDefault: false };
      } catch {
        return { pricing: null, isDefault: true };
      }
    }
    case "pricing:set": {
      const admin = requireAdminPrincipal(db);
      const nextPricing = pricingFromRaw(rawArgs.pricing);
      db.appConfig["pricing"] = JSON.stringify(nextPricing);
      addAudit(db, {
        actorId: admin.userId,
        action: "pricing.updated",
        targetType: "config",
        targetId: "pricing",
      });
      saveDb(db);
      return { ok: true };
    }
    case "pricing:reset": {
      const admin = requireAdminPrincipal(db);
      delete db.appConfig["pricing"];
      addAudit(db, {
        actorId: admin.userId,
        action: "pricing.reset",
        targetType: "config",
        targetId: "pricing",
      });
      saveDb(db);
      return { ok: true };
    }
    case "billing:paymentProviders": {
      return [
        {
          slug: "manual_transfer",
          label: "Bank / CCP / BaridiMob",
          instructionsAr:
            "حوّل المبلغ إلى الحساب البنكي المعروض، ثم ارفع صورة الوصل. يتفعّل الاشتراك بعد التأكيد.",
          instructionsFr:
            "Effectuez le virement vers le compte affiché, puis téléversez le reçu. L'abonnement démarre après validation.",
        },
      ];
    }
    case "billing:mySubscription": {
      const principal = requirePrincipal(db);
      if (principal.role === "wholesaler") {
        const shop = principal.shop;
        if (!shop) return null;
        const sub = liveShopSub(db, shop._id, now);
        const history = db.subscriptions
          .filter((s) => s.shopId === shop._id)
          .sort((a, b) => b.startedAt - a.startedAt)
          .map((h) => ({
            plan: h.plan,
            status: h.status,
            startedAt: h.startedAt,
            expiresAt: h.expiresAt,
            promoCodeUsed: h.promoCodeUsed ?? null,
          }));
        return {
          audience: "wholesaler" as const,
          plan: sub?.plan ?? null,
          isActive: sub !== null,
          expiresAt: sub?.expiresAt ?? null,
          isTrial: sub?.isTrial ?? false,
          graceEndsAt: sub ? sub.expiresAt + 3 * DAY_MS : null,
          productCount: db.products.filter((p) => p.shopId === shop._id).length,
          inGrace: sub !== null && now > sub.expiresAt && now <= sub.expiresAt + 3 * DAY_MS,
          history,
        };
      }
      const sub = db.subscriptions
        .filter((s) => s.ownerId === principal.userId && s.audience === "retailer")
        .sort((a, b) => b.expiresAt - a.expiresAt)[0];
      const live = sub && subscriptionIsLive(sub, now) ? sub : null;
      return {
        audience: "retailer" as const,
        plan: live?.plan ?? null,
        isActive: live !== null,
        expiresAt: live?.expiresAt ?? null,
        isTrial: live?.isTrial ?? false,
        graceEndsAt: live ? live.expiresAt + 3 * DAY_MS : null,
        productCount: 0,
        history: [],
        inGrace: live !== null && now > live.expiresAt && now <= live.expiresAt + 3 * DAY_MS,
      };
    }
    case "billing:redeemPromoCode": {
      const principal = requirePrincipal(db);
      const code = str(rawArgs.code).trim().toUpperCase();
      if (!code) throw new Error("promoInvalid");
      const promo = db.promoCodes.find((p) => p.code === code);
      if (!promo || !promo.isActive) throw new Error("promoInvalid");
      if (promo.expiresAt !== undefined && promo.expiresAt < now) throw new Error("promoExpired");
      if (db.promoRedemptions.some((r) => r.userId === principal.userId && r.codeId === promo._id)) {
        throw new Error("promoAlreadyUsed");
      }
      const promoAudience = principal.role === "wholesaler" ? "wholesaler" : "retailer";
      if (promo.audience !== "both" && promo.audience !== promoAudience) {
        throw new Error("promoWrongAudience");
      }
      const redemptions = db.promoRedemptions.filter((r) => r.codeId === promo._id);
      if (redemptions.length >= promo.maxUses) throw new Error("promoUsed");

      const shopId = principal.shop?._id;
      const basePlan = promoAudience === "wholesaler" ? "basic" : "free";
      const extraDays = promo.kind === "free_days" ? (promo.freeDays ?? 30) : 0;
      const expiresAt = now + extraDays * DAY_MS;
      const subId = nextId(db, "sub");
      db.subscriptions.push({
        _id: subId,
        ownerId: principal.userId,
        shopId,
        audience: promoAudience,
        plan: basePlan,
        status: "active",
        startedAt: now,
        expiresAt,
        promoCodeUsed: promo.code,
      });
      db.promoRedemptions.push({
        _id: nextId(db, "red"),
        codeId: promo._id,
        code: promo.code,
        userId: principal.userId,
        createdAt: now,
        subscriptionId: subId,
      });
      saveDb(db);
      return {
        subscriptionId: subId,
        plan: basePlan,
        expiresAt,
        remaining: promo.maxUses - redemptions.length - 1,
        amountDa: 0,
      };
    }
    case "billing:submitPayment": {
      const principal = requirePrincipal(db);
      const reference = cleanText(str(rawArgs.reference), 60);
      if (!reference) throw new Error("errRequired");
      if (
        db.payments.some(
          (p) => p.ownerId === principal.userId && p.reference === reference && p.status === "pending",
        )
      ) {
        throw new Error("errDuplicatePayment");
      }
      const id = nextId(db, "pay");
      db.payments.push({
        _id: id,
        ownerId: principal.userId,
        shopId: principal.shop?._id,
        audience: rawArgs.audience === "wholesaler" ? "wholesaler" : "retailer",
        plan: (rawArgs.plan as LocalPayment["plan"]) ?? "basic",
        amountDa: Math.round(num(rawArgs.amountDa)),
        method: (rawArgs.method as LocalPayment["method"]) ?? "ccp",
        reference,
        receiptStorageId: optStr(rawArgs.receiptStorageId),
        status: "pending",
        createdAt: now,
      });
      saveDb(db);
      return id;
    }
    case "billing:myPayments": {
      const principal = requirePrincipal(db);
      const payments = db.payments
        .filter((p) => p.ownerId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt);
      const invoices = db.invoices
        .filter((i) => i.ownerId === principal.userId)
        .sort((a, b) => b.sequence - a.sequence);
      const invByPay = new Map(invoices.map((i) => [i.paymentId, i]));
      return {
        payments: payments.map((p) => ({
          id: p._id,
          plan: p.plan,
          audience: p.audience,
          amountDa: p.amountDa,
          method: p.method,
          reference: p.reference,
          status: p.status,
          createdAt: p.createdAt,
          reviewedAt: p.reviewedAt ?? null,
          rejectReason: p.rejectReason ?? null,
          invoiceNumber: invByPay.get(p._id)?.number ?? null,
        })),
        invoices: invoices.map((i) => ({
          number: i.number,
          amountDa: i.amountDa,
          issuedAt: i.issuedAt,
          description: i.description,
        })),
      };
    }
    case "billing:reviewPayment": {
      const admin = requireAdminPrincipal(db);
      const payment = db.payments.find((p) => p._id === str(rawArgs.paymentId));
      if (!payment) throw new Error("errNotFound");
      if (payment.status !== "pending") throw new Error("errAlreadyReviewed");
      if (!bool(rawArgs.approve)) {
        payment.status = "rejected";
        payment.reviewedBy = admin.userId;
        payment.reviewedAt = now;
        payment.rejectReason = optStr(rawArgs.rejectReason);
        saveDb(db);
        return { ok: true };
      }
      payment.status = "approved";
      payment.reviewedBy = admin.userId;
      payment.reviewedAt = now;
      const pricing = readLocalPricing(db);
      let durationDays = 30;
      if (payment.audience === "wholesaler") {
        const yearlyCost =
          payment.plan === "pro"
            ? pricing.wholesaler.pro.yearly
            : pricing.wholesaler.basic.yearly;
        if (payment.amountDa >= yearlyCost) durationDays = 365;
      } else {
        if (payment.amountDa >= pricing.retailer.plus.yearly) durationDays = 365;
        else if (payment.amountDa >= pricing.retailer.plus.quarterly) durationDays = 90;
      }
      const existing = db.subscriptions
        .filter(
          (s) =>
            s.ownerId === payment.ownerId &&
            s.audience === payment.audience &&
            subscriptionIsLive(s, now),
        )
        .sort((a, b) => b.expiresAt - a.expiresAt)[0];
      const baseStart = existing && existing.expiresAt > now ? existing.expiresAt : now;
      const expiresAt = baseStart + durationDays * DAY_MS;
      db.subscriptions.push({
        _id: nextId(db, "sub"),
        ownerId: payment.ownerId,
        shopId: payment.shopId,
        audience: payment.audience,
        plan: payment.plan,
        status: "active",
        startedAt: now,
        expiresAt,
      });
      const seq = db.invoices.length + 1;
      db.invoices.push({
        _id: nextId(db, "inv"),
        number: `${payment.audience === "wholesaler" ? "TD-W" : "TD-R"}-${String(seq).padStart(6, "0")}`,
        sequence: seq,
        audience: payment.audience,
        ownerId: payment.ownerId,
        paymentId: payment._id,
        amountDa: payment.amountDa,
        issuedAt: now,
        description: `اشتراك ${payment.plan} — ${payment.reference}`,
      });
      saveDb(db);
      return { ok: true, expiresAt };
    }
    case "billing:createPromoCode": {
      const admin = requireAdminPrincipal(db);
      const code = str(rawArgs.code).trim().toUpperCase();
      if (!code) throw new Error("errRequired");
      if (db.promoCodes.some((p) => p.code === code)) throw new Error("errDuplicatePromo");
      const id = nextId(db, "promo");
      db.promoCodes.push({
        _id: id,
        code,
        kind: rawArgs.kind === "percent" ? "percent" : "free_days",
        freeDays: typeof rawArgs.freeDays === "number" ? rawArgs.freeDays : undefined,
        percent: typeof rawArgs.percent === "number" ? rawArgs.percent : undefined,
        maxUses: Math.max(1, Math.round(num(rawArgs.maxUses, 10))),
        audience: (rawArgs.audience as LocalPromoCode["audience"]) ?? "both",
        isActive: true,
        createdAt: now,
      });
      addAudit(db, {
        actorId: admin.userId,
        action: "promo.create",
        targetType: "promo",
        targetId: id,
        details: code,
      });
      saveDb(db);
      return { id, code };
    }

    // -----------------------------------------------------------------------
    // Reviews
    // -----------------------------------------------------------------------
    case "reviews:submitReview": {
      const principal = requirePrincipal(db);
      const productId = str(rawArgs.productId);
      const product = db.products.find((p) => p._id === productId);
      if (!product) throw new Error("errNotFound");
      const elig = checkReviewEligibility(db, productId, principal, now);
      if (!elig.ok) throw new Error(`errReview:${elig.reason}`);
      const comment = rawArgs.comment ? cleanText(str(rawArgs.comment), 800) : undefined;
      if (comment && containsLinkOrPhone(comment)) throw new Error("errNoLinksInPublicText");
      db.reviews.push({
        _id: nextId(db, "rev"),
        productId,
        shopId: product.shopId,
        retailerId: principal.userId,
        productRating: Math.round(num(rawArgs.productRating, 5)),
        sellerRating: Math.round(num(rawArgs.sellerRating, 5)),
        comment,
        claimedPurchase: bool(rawArgs.claimedPurchase),
        verifiedContact: true,
        status: "visible",
        createdAt: now,
      });
      refreshProductStats(db, productId);
      refreshShopSummary(db, product.shopId);
      saveDb(db);
      return { ok: true };
    }
    case "reviews:replyToReview": {
      const principal = requireRolePrincipal(db, "wholesaler");
      const review = db.reviews.find((r) => r._id === str(rawArgs.reviewId));
      if (!review) throw new Error("errNotFound");
      if (!principal.shop || review.shopId !== principal.shop._id) {
        throw new Error("errNotAuthorized");
      }
      if (review.reply !== undefined) throw new Error("errAlreadyReplied");
      const reply = cleanText(str(rawArgs.reply), 500);
      if (!reply) throw new Error("errRequired");
      if (containsLinkOrPhone(reply)) throw new Error("errNoLinksInPublicText");
      review.reply = reply;
      review.repliedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "reviews:shopReviews": {
      const principal = requireRolePrincipal(db, "wholesaler");
      const shop = principal.shop;
      if (!shop) return [];
      return db.reviews
        .filter((r) => r.shopId === shop._id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => {
          const product = db.products.find((p) => p._id === r.productId);
          const retailer = db.users.find((u) => u._id === r.retailerId);
          return {
            id: r._id,
            productId: r.productId,
            productName: product?.name ?? "منتج",
            productSlug: product?.slug ?? "",
            productRating: r.productRating,
            sellerRating: r.sellerRating,
            comment: r.comment ?? null,
            verifiedContact: r.verifiedContact,
            claimedPurchase: r.claimedPurchase ?? false,
            reply: r.reply ?? null,
            canReply: r.reply === undefined,
            status: r.status,
            createdAt: r.createdAt,
            reviewerName: retailer?.name ?? "بائع",
          };
        });
    }

    // -----------------------------------------------------------------------
    // Notifications, Favorites, Compare, Reports, Support
    // -----------------------------------------------------------------------
    case "notifications:unreadCount": {
      const principal = requirePrincipal(db);
      return db.notifications.filter(
        (n) => n.userId === principal.userId && n.readAt === undefined,
      ).length;
    }
    case "notifications:myNotifications": {
      const principal = requirePrincipal(db);
      return db.notifications
        .filter((n) => n.userId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 60)
        .map((n) => ({
          id: n._id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link ?? null,
          readAt: n.readAt ?? null,
          createdAt: n.createdAt,
        }));
    }
    case "notifications:markRead": {
      const principal = requirePrincipal(db);
      const n = db.notifications.find((row) => row._id === str(rawArgs.notificationId));
      if (n && n.userId === principal.userId) {
        n.readAt = now;
        saveDb(db);
      }
      return { ok: true };
    }
    case "notifications:markAllRead": {
      const principal = requirePrincipal(db);
      for (const n of db.notifications) {
        if (n.userId === principal.userId && n.readAt === undefined) n.readAt = now;
      }
      saveDb(db);
      return { ok: true };
    }
    case "notifications:myPrefs": {
      const principal = requirePrincipal(db);
      const existing = db.notificationPrefs.find((p) => p.userId === principal.userId);
      return (
        existing ?? {
          types: [] as string[],
          inApp: true,
          push: false,
          email: false,
        }
      );
    }
    case "notifications:savePrefs": {
      const principal = requirePrincipal(db);
      const existing = db.notificationPrefs.find((p) => p.userId === principal.userId);
      const nextPref: LocalNotificationPrefs = {
        userId: principal.userId,
        types: arr<string>(rawArgs.types),
        inApp: bool(rawArgs.inApp, true),
        push: bool(rawArgs.push, false),
        email: bool(rawArgs.email, false),
      };
      if (existing) Object.assign(existing, nextPref);
      else db.notificationPrefs.push(nextPref);
      saveDb(db);
      return { ok: true };
    }
    case "notifications:myFavorites": {
      const principal = requirePrincipal(db);
      return db.favorites
        .filter((f) => f.userId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .flatMap((f) => {
          const product = db.products.find((p) => p._id === f.productId);
          if (!product) return [];
          const shop = db.shops.find((s) => s._id === product.shopId);
          if (!shop) return [];
          return [
            {
              favoriteId: f._id,
              productId: product._id,
              slug: product.slug,
              name: product.name,
              imageStorageIds: product.imageStorageIds,
              currentPriceDa: product.wholesalePriceDa,
              priceAtFavoriteDa: f.priceAtFavoriteDa,
              priceDropped: product.wholesalePriceDa < f.priceAtFavoriteDa,
              minQty: product.minQty,
              stockStatus: product.stockStatus,
              isWinning: product.isWinning,
              shopName: shop.name,
              wilayaLabel: wilayaName(shop.wilaya, "ar"),
              categoryLabel: categoryLabel(product.category, "ar"),
              createdAt: f.createdAt,
            },
          ];
        });
    }
    case "notifications:compareProducts": {
      requirePrincipal(db);
      const ids = arr<string>(rawArgs.productIds).slice(0, 3);
      return ids.flatMap((id) => {
        const product = db.products.find((p) => p._id === id);
        if (!product) return [];
        const shop = db.shops.find((s) => s._id === product.shopId);
        if (!shop) return [];
        const bestTier = product.priceTiers.reduce<number | null>(
          (best, t) => (best === null || t.priceDa < best ? t.priceDa : best),
          null,
        );
        return [
          {
            productId: product._id,
            slug: product.slug,
            name: product.name,
            imageStorageIds: product.imageStorageIds,
            wholesalePriceDa: product.wholesalePriceDa,
            effectivePriceDa: bestTier ?? product.wholesalePriceDa,
            minQty: product.minQty,
            priceTiers: product.priceTiers,
            stockStatus: product.stockStatus,
            avgProductRating: product.avgProductRating,
            reviewCount: product.reviewCount,
            isWinning: product.isWinning,
            wilayaLabel: wilayaName(shop.wilaya, "ar"),
            shopName: shop.name,
            shopVerified: shop.verification === "approved",
            shopRating: shop.ratingSummary?.overall ?? 0,
            deliveryOptions: shop.deliveryOptions,
            prepDays: shop.avgPrepDays,
          },
        ];
      });
    }
    case "notifications:reportContent": {
      const principal = requirePrincipal(db);
      const targetType = str(rawArgs.targetType, "product") as LocalReport["targetType"];
      const targetId = str(rawArgs.targetId);
      const reason = str(rawArgs.reason, "other");
      db.reports.push({
        _id: nextId(db, "rep"),
        reporterId: principal.userId,
        targetType,
        targetId,
        reason,
        details: rawArgs.details ? cleanText(str(rawArgs.details), 600) : undefined,
        status: "open",
        createdAt: now,
      });
      saveDb(db);
      return { ok: true, autoHidden: false };
    }
    case "notifications:submitSupportTicket": {
      const principal = requirePrincipal(db);
      const subject = cleanText(str(rawArgs.subject), 140);
      const body = cleanText(str(rawArgs.body), 2000);
      if (!subject || !body) throw new Error("errRequired");
      const id = nextId(db, "ticket");
      db.supportTickets.push({
        _id: id,
        userId: principal.userId,
        subject,
        body,
        email: cleanText(str(rawArgs.email), 120),
        status: "open",
        createdAt: now,
      });
      saveDb(db);
      return id;
    }

    // -----------------------------------------------------------------------
    // VIP Products
    // -----------------------------------------------------------------------
    case "vip:hasAck": {
      const principal = getCurrentPrincipal(db);
      if (!principal) return { acked: false };
      const kind = rawArgs.kind === "approval" ? "approval" : "request";
      return {
        acked: db.vipAcks.some((a) => a.userId === principal.userId && a.kind === kind),
      };
    }
    case "vip:ack": {
      const principal = requirePrincipal(db);
      const kind = rawArgs.kind === "approval" ? "approval" : "request";
      if (db.vipAcks.some((a) => a.userId === principal.userId && a.kind === kind)) {
        return { ok: true, already: true };
      }
      db.vipAcks.push({
        _id: nextId(db, "vack"),
        userId: principal.userId,
        kind,
        acknowledgedAt: now,
      });
      saveDb(db);
      return { ok: true, already: false };
    }
    case "vip:teaser": {
      const slug = str(rawArgs.slug);
      const product = db.products.find((p) => p.slug === slug && p.visibility === "vip");
      if (!product) return null;
      const shopDoc = db.shops.find((s) => s._id === product.shopId);
      if (!shopDoc || !shopDoc.isActive) return null;
      const principal = getCurrentPrincipal(db);
      const myReq = principal
        ? db.vipRequests.find((r) => r.productId === product._id && r.retailerId === principal.userId)
        : null;
      const approved = myReq ? grantsAccess(myReq, now) : false;
      const isOwner = principal?.userId === product.ownerId;
      const isAdmin = principal?.role === "admin";
      const showcase = db.vipShowcases.find((s) => s.productId === product._id);
      const reviews = db.vipReviews.filter((r) => r.productId === product._id);
      const visibleReviews = reviews.filter((r) => r.status === "visible");
      const reqs = db.vipRequests.filter((r) => r.productId === product._id);

      return {
        product: teaserOfProduct(product),
        shop: publicShopFields(shopDoc, false),
        my: myReq
          ? {
              status: effectiveVipStatus(myReq, now),
              requestId: myReq._id,
              expiresAt: myReq.expiresAt,
              expiresInDays: Math.max(0, Math.ceil((myReq.expiresAt - now) / DAY_MS)),
              decisionReason: myReq.decisionReason ?? null,
            }
          : null,
        eligibilityReason: principal
          ? evaluateVipEligibility(db, product, principal, now)
          : "vipErrSignedIn",
        hasAcknowledged: principal
          ? db.vipAcks.some((a) => a.userId === principal.userId && a.kind === "request")
          : false,
        whatsappE164: approved ? shopDoc.whatsappE164 : undefined,
        canSeeShowcase: approved || isOwner || isAdmin,
        isOwner,
        showcase: showcase
          ? {
              imageStorageIds: showcase.imageStorageIds,
              priceHint: showcase.priceHint,
              notes: showcase.notes,
              updatedAt: showcase.updatedAt,
            }
          : null,
        stats: {
          views: product.viewCount,
          approved: reqs.filter((r) => grantsAccess(r, now)).length,
          requests: reqs.length,
          reviews: visibleReviews.length,
          avgRating: visibleReviews.length
            ? Math.round(
                (visibleReviews.reduce((a, r) => a + r.rating, 0) / visibleReviews.length) * 10,
              ) / 10
            : null,
        },
        canReview:
          Boolean(principal && myReq && grantsAccess(myReq, now)) &&
          myReq?.decidedAt !== undefined &&
          now - (myReq?.decidedAt ?? now) >= VIP_REVIEW_DELAY_DAYS * DAY_MS &&
          !reviews.some((r) => r.userId === principal?.userId),
        notifiedAt: product.updatedAt,
      };
    }
    case "vip:showcase": {
      const principal = requirePrincipal(db);
      const product = db.products.find(
        (p) => p._id === str(rawArgs.productId) && p.visibility === "vip",
      );
      if (!product) throw new Error("errNotFound");
      const isOwner = product.ownerId === principal.userId;
      const isAdmin = principal.role === "admin";
      const myReq = db.vipRequests.find(
        (r) => r.productId === product._id && r.retailerId === principal.userId,
      );
      const approved = myReq ? grantsAccess(myReq, now) : false;
      if (!isOwner && !isAdmin && !approved) throw new Error("errNotAuthorized");
      const row = db.vipShowcases.find((s) => s.productId === product._id);
      const shopDoc = db.shops.find((s) => s._id === product.shopId);
      return {
        imageStorageIds: row?.imageStorageIds ?? [],
        priceHint: row?.priceHint ?? null,
        notes: row?.notes ?? null,
        updatedAt: row?.updatedAt ?? null,
        whatsappE164: approved && shopDoc ? shopDoc.whatsappE164 : undefined,
        wholesalerName: shopDoc?.name ?? "",
        approvedAt: myReq?.decidedAt ?? null,
        myUserId: principal.userId,
      };
    }
    case "vip:logView": {
      const product = db.products.find(
        (p) => p._id === str(rawArgs.productId) && p.visibility === "vip",
      );
      if (!product) return { ok: false };
      product.viewCount += 1;
      saveDb(db);
      return { ok: true };
    }
    case "vip:productReviews": {
      const productId = str(rawArgs.productId);
      return db.vipReviews
        .filter((r) => r.productId === productId && r.status === "visible")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => {
          const author = db.users.find((u) => u._id === r.userId);
          return {
            id: r._id,
            rating: r.rating,
            comment: r.comment ?? null,
            reply: r.reply ?? null,
            repliedAt: r.repliedAt ?? null,
            createdAt: r.createdAt,
            authorName: author?.name ?? "تاجر",
          };
        });
    }
    case "vip:inbox": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      const products = db.products.filter(
        (p) => p.ownerId === principal.userId && p.visibility === "vip",
      );
      const productIds = new Set(products.map((p) => p._id));
      const reqs = db.vipRequests.filter((r) => productIds.has(r.productId));

      const out = reqs.map((row) => {
        const retailer = db.users.find((u) => u._id === row.retailerId);
        const product = db.products.find((p) => p._id === row.productId);
        return {
          request: { ...row, status: effectiveVipStatus(row, now) },
          product: product ? teaserOfProduct(product) : null,
          retailer: {
            id: row.retailerId,
            name: retailer?.name ?? "تاجر",
            wilaya: retailer?.wilaya ?? null,
            storeType: retailer?.storeType ?? null,
            storeLink: retailer?.storeLink ?? null,
            memberSince: retailer?.onboardedAt ?? retailer?._creationTime ?? now,
            planActive: retailerIsSubscribed(db, row.retailerId, now),
            reviewsWritten: db.vipReviews.filter((rv) => rv.userId === row.retailerId).length,
            reportsAgainstThem: db.reports.filter(
              (rp) => rp.targetId === row.retailerId && rp.status === "open",
            ).length,
          },
          blocked: db.vipBlocks.some(
            (b) => b.ownerId === principal.userId && b.userId === row.retailerId,
          ),
        };
      });

      const productRows = products.map((product) => {
        const pReqs = db.vipRequests.filter((r) => r.productId === product._id);
        return {
          ...teaserOfProduct(product),
          pending: pReqs.filter((r) => effectiveVipStatus(r, now) === "pending").length,
          approved: pReqs.filter((r) => grantsAccess(r, now)).length,
          requests: pReqs.length,
        };
      });

      return {
        products: productRows,
        requests: out,
        stats: {
          products: productRows.length,
          pending: out.filter((r) => r.request.status === "pending").length,
          approved: out.filter((r) => r.request.status === "approved").length,
        },
        slotLimit: vipSlotLimitFor(db, shop),
      };
    }
    case "vip:createTeaser": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const shop = principal.shop;
      if (!shop) throw new Error("errNotAuthorized");
      const limit = vipSlotLimitFor(db, shop);
      const used = db.products.filter(
        (p) => p.shopId === shop._id && p.visibility === "vip",
      ).length;
      if (limit <= 0) throw new Error("errVipPlanRequired");
      if (used >= limit) throw new Error("errVipSlotsFull");

      const title = cleanText(str(rawArgs.teaserTitle), VIP_MAX_TEASER_TITLE);
      const description = cleanText(str(rawArgs.teaserDescription), VIP_MAX_TEASER_DESCRIPTION);
      if (title.length < 6 || description.length < 30) throw new Error("errRequired");
      if (containsLinkOrPhone(title) || containsLinkOrPhone(description)) {
        throw new Error("errVipLeakedText");
      }

      const productId = nextId(db, "vip");
      db.products.push({
        _id: productId,
        _creationTime: now,
        shopId: shop._id,
        ownerId: principal.userId,
        name: title,
        slug: `vip-${slugify(title) || "offer"}-${Math.random().toString(36).slice(2, 7)}`,
        category: str(rawArgs.category, "other"),
        description,
        wholesalePriceDa: 0,
        minQty: Math.max(1, Math.round(num(rawArgs.minQuantity, 10))),
        priceTiers: [],
        stockStatus: "in_stock",
        prepDays: shop.avgPrepDays,
        tags: [],
        imageStorageIds: [],
        isPaused: false,
        reviewCount: 0,
        avgProductRating: 0,
        avgSellerRating: 0,
        wilsonScore: 0,
        isWinning: false,
        viewCount: 0,
        favoriteCount: 0,
        contactCount: 0,
        visibility: "vip",
        vip: {
          allowedWilayas: arr<number>(rawArgs.allowedWilayas),
          maxApprovedBuyers: Math.max(0, Math.round(num(rawArgs.maxApprovedBuyers, 10))),
          requestsOpen: bool(rawArgs.requestsOpen, true),
          status: bool(rawArgs.requestsOpen, true) ? "active" : "closed",
        },
        createdAt: now,
        updatedAt: now,
      });
      const showcase = rawArgs.showcase as
        | { imageStorageIds?: string[]; priceHint?: string; notes?: string }
        | undefined;
      if (showcase) {
        db.vipShowcases.push({
          _id: nextId(db, "vshow"),
          productId,
          ownerId: principal.userId,
          imageStorageIds: (showcase.imageStorageIds ?? []).slice(0, VIP_MAX_SHOWCASE_IMAGES),
          priceHint: showcase.priceHint ? cleanText(showcase.priceHint, 80) : undefined,
          notes: showcase.notes ? cleanText(showcase.notes, 1200) : undefined,
          updatedAt: now,
        });
      }
      saveDb(db);
      return { productId };
    }
    case "vip:updateTeaser": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const product = db.products.find(
        (p) => p._id === str(rawArgs.productId) && p.visibility === "vip",
      );
      if (!product || product.ownerId !== principal.userId) throw new Error("errNotAuthorized");
      const title = cleanText(str(rawArgs.teaserTitle), VIP_MAX_TEASER_TITLE);
      const description = cleanText(str(rawArgs.teaserDescription), VIP_MAX_TEASER_DESCRIPTION);
      if (title.length < 6 || description.length < 30) throw new Error("errRequired");
      if (containsLinkOrPhone(title) || containsLinkOrPhone(description)) {
        throw new Error("errVipLeakedText");
      }
      product.name = title;
      product.description = description;
      product.category = str(rawArgs.category, product.category);
      product.minQty = Math.max(1, Math.round(num(rawArgs.minQuantity, product.minQty)));
      product.vip = {
        allowedWilayas: arr<number>(rawArgs.allowedWilayas),
        maxApprovedBuyers: Math.max(0, Math.round(num(rawArgs.maxApprovedBuyers, 10))),
        requestsOpen: bool(rawArgs.requestsOpen, true),
        status: bool(rawArgs.requestsOpen, true) ? "active" : "closed",
      };
      product.updatedAt = now;
      const showcase = rawArgs.showcase as
        | { imageStorageIds?: string[]; priceHint?: string; notes?: string }
        | undefined;
      if (showcase) {
        const existing = db.vipShowcases.find((s) => s.productId === product._id);
        const nextImgs = (showcase.imageStorageIds ?? []).slice(0, VIP_MAX_SHOWCASE_IMAGES);
        if (existing) {
          existing.imageStorageIds = nextImgs;
          existing.priceHint = showcase.priceHint ? cleanText(showcase.priceHint, 80) : undefined;
          existing.notes = showcase.notes ? cleanText(showcase.notes, 1200) : undefined;
          existing.updatedAt = now;
        } else {
          db.vipShowcases.push({
            _id: nextId(db, "vshow"),
            productId: product._id,
            ownerId: principal.userId,
            imageStorageIds: nextImgs,
            priceHint: showcase.priceHint ? cleanText(showcase.priceHint, 80) : undefined,
            notes: showcase.notes ? cleanText(showcase.notes, 1200) : undefined,
            updatedAt: now,
          });
        }
      }
      saveDb(db);
      return { ok: true };
    }
    case "vip:setRequestsOpen":
    case "vip:setVipStatus": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const product = db.products.find(
        (p) => p._id === str(rawArgs.productId) && p.visibility === "vip",
      );
      if (!product || product.ownerId !== principal.userId) throw new Error("errNotAuthorized");
      if (product.vip) {
        if (rawArgs.requestsOpen !== undefined) product.vip.requestsOpen = bool(rawArgs.requestsOpen);
        if (rawArgs.status === "active" || rawArgs.status === "closed") {
          product.vip.status = rawArgs.status;
        }
      }
      product.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "vip:requestAccess": {
      const principal = requirePrincipal(db);
      if (!bool(rawArgs.acknowledged)) throw new Error("errVipAckRequired");
      const product = db.products.find(
        (p) => p._id === str(rawArgs.productId) && p.visibility === "vip",
      );
      if (!product) throw new Error("errNotFound");
      const err = evaluateVipEligibility(db, product, principal, now);
      if (err) throw new Error(err);

      const qty = Math.round(num(rawArgs.quantity, 1));
      const wilaya = num(rawArgs.wilaya, 16);
      const cause = autoRejectCause({
        quantity: qty,
        minQuantity: product.minQty,
        wilaya,
        allowedWilayas: product.vip?.allowedWilayas ?? [],
      });
      const reqId = nextId(db, "vreq");
      db.vipRequests.push({
        _id: reqId,
        _creationTime: now,
        productId: product._id,
        retailerId: principal.userId,
        quantity: qty,
        wilaya,
        message: cleanText(str(rawArgs.message), VIP_MAX_MESSAGE),
        status: cause ? "rejected" : "pending",
        decisionReason: cause ?? undefined,
        decidedAt: cause ? now : undefined,
        expiresAt: now + VIP_REQUEST_TTL_DAYS * DAY_MS,
        createdAt: now,
        updatedAt: now,
      });
      saveDb(db);
      return { requestId: reqId, status: cause ? "rejected" : "pending" };
    }
    case "vip:decide": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const req = db.vipRequests.find((r) => r._id === str(rawArgs.requestId));
      if (!req) throw new Error("errNotFound");
      const product = db.products.find((p) => p._id === req.productId);
      if (!product || (product.ownerId !== principal.userId && principal.role !== "admin")) {
        throw new Error("errNotAuthorized");
      }
      if (rawArgs.action === "approve") {
        if (!bool(rawArgs.acknowledged)) throw new Error("errVipAckRequired");
        req.status = "approved";
        req.decidedAt = now;
        req.expiresAt = now + 30 * DAY_MS;
      } else {
        req.status = "rejected";
        req.decisionReason = optStr(rawArgs.reason);
        req.decidedAt = now;
      }
      req.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "vip:revoke": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const req = db.vipRequests.find((r) => r._id === str(rawArgs.requestId));
      if (!req) throw new Error("errNotFound");
      const product = db.products.find((p) => p._id === req.productId);
      if (!product || (product.ownerId !== principal.userId && principal.role !== "admin")) {
        throw new Error("errNotAuthorized");
      }
      req.status = "revoked";
      req.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "vip:blockRetailer": {
      const principal = requireRolePrincipal(db, "wholesaler", "admin");
      const targetUserId = str(rawArgs.userId);
      const idx = db.vipBlocks.findIndex(
        (b) => b.ownerId === principal.userId && b.userId === targetUserId,
      );
      if (bool(rawArgs.block)) {
        if (idx === -1) {
          db.vipBlocks.push({
            _id: nextId(db, "vblk"),
            ownerId: principal.userId,
            userId: targetUserId,
            createdAt: now,
          });
        }
      } else if (idx >= 0) {
        db.vipBlocks.splice(idx, 1);
      }
      saveDb(db);
      return { ok: true };
    }
    case "vip:myRequests": {
      const principal = requirePrincipal(db);
      const rows = db.vipRequests
        .filter((r) => r.retailerId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt);
      return {
        requests: rows.flatMap((row) => {
          const product = db.products.find((p) => p._id === row.productId);
          if (!product) return [];
          const shopDoc = db.shops.find((s) => s._id === product.shopId);
          return [
            {
              requestId: row._id,
              status: effectiveVipStatus(row, now) as VipRequestStatus,
              expiresAt: row.expiresAt,
              expiresInDays: Math.max(0, Math.ceil((row.expiresAt - now) / DAY_MS)),
              decisionReason: row.decisionReason ?? null,
              decidedAt: row.decidedAt ?? null,
              quantity: row.quantity,
              wilaya: row.wilaya,
              createdAt: row.createdAt,
              product: teaserOfProduct(product),
              shopName: shopDoc?.name ?? "",
              shopSlug: shopDoc?.slug ?? "",
              shopVerified: shopDoc?.verification === "approved",
            },
          ];
        }),
      };
    }
    case "vip:adminOverview": {
      requireAdminPrincipal(db);
      const vipProducts = db.products.filter((p) => p.visibility === "vip");
      const vipIds = new Set(vipProducts.map((p) => p._id));
      const vipRequests = db.vipRequests.filter((r) => vipIds.has(r.productId));
      const vipReports = db.reports.filter(
        (rp) => rp.status === "open" && vipIds.has(rp.targetId),
      );
      return {
        products: vipProducts.map((product) => ({
          id: product._id,
          slug: product.slug,
          name: product.name,
          category: product.category,
          isPaused: product.isPaused,
          status: product.vip?.status ?? "closed",
          requestsOpen: product.vip?.requestsOpen ?? false,
          createdAt: product.createdAt,
          hiddenByReports: vipReports.filter((r) => r.targetId === product._id).length,
        })),
        requests: vipRequests.slice(0, 60).map((row) => {
          const retailer = db.users.find((u) => u._id === row.retailerId);
          return {
            ...row,
            status: effectiveVipStatus(row, now),
            retailerName: retailer?.name ?? "تاجر",
            retailerEmail: retailer?.email ?? null,
          };
        }),
        reports: vipReports.map((row) => ({
          id: row._id,
          targetType: row.targetType,
          targetId: row.targetId,
          reason: row.reason,
          details: row.details ?? null,
          createdAt: row.createdAt,
        })),
        stats: {
          products: vipProducts.length,
          pending: vipRequests.filter((r) => r.status === "pending").length,
          approved: vipRequests.filter((r) => r.status === "approved").length,
          reports: vipReports.length,
          hidden: vipProducts.filter((p) => p.isPaused).length,
        },
        autoHideThreshold: VIP_AUTO_HIDE_REPORTS,
      };
    }
    case "vip:moderateTeaser": {
      requireAdminPrincipal(db);
      const product = db.products.find(
        (p) => p._id === str(rawArgs.productId) && p.visibility === "vip",
      );
      if (!product) throw new Error("errNotFound");
      product.isPaused = rawArgs.action === "hide";
      product.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "vip:revokeAll": {
      requireAdminPrincipal(db);
      for (const req of db.vipRequests) {
        if (req.status === "approved") {
          req.status = "revoked";
          req.updatedAt = now;
        }
      }
      saveDb(db);
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    // Courses & Instructor
    // -----------------------------------------------------------------------
    case "courses:list": {
      const needle = typeof rawArgs.q === "string" ? normalizeArabic(rawArgs.q.trim()) : "";
      const sort = str(rawArgs.sort, "newest");
      const out = db.courses
        .filter((row) => {
          if (row.status !== "active") return false;
          const inst = db.instructors.find((i) => i._id === row.instructorId);
          if (inst?.status !== "approved") return false;
          if (rawArgs.topic && !row.topics.includes(str(rawArgs.topic))) return false;
          if (rawArgs.level && row.level !== rawArgs.level) return false;
          if (rawArgs.format && row.format !== rawArgs.format) return false;
          if (rawArgs.wilaya !== undefined && row.wilaya !== rawArgs.wilaya) return false;
          if (rawArgs.minPrice !== undefined && row.priceDa < num(rawArgs.minPrice)) return false;
          if (rawArgs.maxPrice !== undefined && row.priceDa > num(rawArgs.maxPrice)) return false;
          const rating =
            row.ratingCount > 0 ? Math.round((row.ratingSum / row.ratingCount) * 10) / 10 : null;
          if (rawArgs.minRating !== undefined && (rating ?? 0) < num(rawArgs.minRating)) return false;
          if (needle) {
            const hay = normalizeArabic(`${row.title} ${row.description} ${row.topics.join(" ")}`);
            if (!hay.includes(needle)) return false;
          }
          return true;
        })
        .map((row) => {
          const inst = db.instructors.find((i) => i._id === row.instructorId);
          const rating =
            row.ratingCount > 0 ? Math.round((row.ratingSum / row.ratingCount) * 10) / 10 : null;
          return {
            ...row,
            instructorName: inst?.name ?? "",
            instructorVerified: inst?.status === "approved",
            rating,
          };
        });

      if (sort === "rating") out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      else if (sort === "price") out.sort((a, b) => a.priceDa - b.priceDa);
      else out.sort((a, b) => b.createdAt - a.createdAt);
      return out;
    }
    case "courses:get": {
      const course = db.courses.find((c) => c._id === str(rawArgs.courseId));
      if (!course) return null;
      const instructor = db.instructors.find((i) => i._id === course.instructorId);
      if (!instructor) return null;
      const principal = getCurrentPrincipal(db);
      const visible = course.status === "active" && instructor.status === "approved";
      const owner = principal !== null && principal.userId === course.ownerId;
      const admin = principal?.role === "admin";
      if (!visible && !owner && !admin) return null;

      const enrolled = principal
        ? db.enrollments.some((e) => e.userId === principal.userId && e.courseId === course._id)
        : false;
      const rating =
        course.ratingCount > 0
          ? Math.round((course.ratingSum / course.ratingCount) * 10) / 10
          : null;
      const reviews = db.courseReviews
        .filter((r) => r.courseId === course._id && r.status === "visible")
        .sort((a, b) => b.createdAt - a.createdAt);

      return {
        course: {
          ...course,
          instructorName: instructor.name,
          instructorVerified: instructor.status === "approved",
          rating,
        },
        instructor: {
          id: instructor._id,
          name: instructor.name,
          bio: instructor.bio,
          experience: instructor.experience,
          photoStorageId: instructor.photoStorageId,
          wilaya: instructor.wilaya,
          status: instructor.status,
          createdAt: instructor.createdAt,
        },
        contactE164: principal ? instructor.contactE164 : null,
        enrolled,
        ownerId: owner ? course.ownerId : null,
        reviews,
        canReview: enrolled && !reviews.some((r) => r.userId === principal?.userId),
        acknowledged: principal ? db.courseAcks.includes(principal.userId) : false,
      };
    }
    case "courses:materials": {
      const principal = getCurrentPrincipal(db);
      if (!principal) return [];
      const course = db.courses.find((c) => c._id === str(rawArgs.courseId));
      if (!course) return [];
      const enrolled = db.enrollments.some(
        (e) => e.userId === principal.userId && e.courseId === course._id,
      );
      if (
        !canViewMaterials({
          isOwner: course.ownerId === principal.userId,
          isAdmin: principal.role === "admin",
          isEnrolled: enrolled,
        })
      ) {
        throw new Error("errNotAuthorized");
      }
      return db.courseMaterials
        .filter((m) => m.courseId === course._id)
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    case "courses:announcements": {
      const courseId = str(rawArgs.courseId);
      const principal = getCurrentPrincipal(db);
      const course = db.courses.find((c) => c._id === courseId);
      if (!course) return [];
      const enrolled = principal
        ? db.enrollments.some((e) => e.userId === principal.userId && e.courseId === course._id)
        : false;
      const canSeeBody =
        principal !== null &&
        (course.ownerId === principal.userId || principal.role === "admin" || enrolled);
      return db.courseAnnouncements
        .filter((a) => a.courseId === courseId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((a) => ({
          _id: a._id,
          title: a.title,
          body: canSeeBody ? a.body : undefined,
          createdAt: a.createdAt,
        }));
    }
    case "courses:myEnrollments": {
      const principal = requirePrincipal(db);
      return db.enrollments
        .filter((e) => e.userId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .flatMap((e) => {
          const course = db.courses.find((c) => c._id === e.courseId);
          if (!course) return [];
          const inst = db.instructors.find((i) => i._id === e.instructorId);
          return [
            {
              enrollment: e,
              course: {
                id: course._id,
                title: course.title,
                coverStorageId: course.coverStorageId,
                priceDa: course.priceDa,
                status: course.status,
                startsAt: course.startsAt,
              },
              instructorName: inst?.name ?? "",
            },
          ];
        });
    }
    case "courses:acknowledge": {
      const principal = requirePrincipal(db);
      if (!db.courseAcks.includes(principal.userId)) {
        db.courseAcks.push(principal.userId);
        saveDb(db);
      }
      return { ok: true };
    }
    case "courses:redeemCode": {
      const principal = requirePrincipal(db);
      const courseId = str(rawArgs.courseId);
      const codeInput = str(rawArgs.code).trim().toUpperCase();
      if (!codeInput) throw new Error("errCodeInvalid");
      const codeRow = db.enrollmentCodes.find(
        (c) => c.courseId === courseId && c.code === codeInput,
      );
      if (!codeRow) throw new Error("errCodeInvalid");
      const state = codeState(codeRow, now);
      if (state === "revoked") throw new Error("errCodeRevoked");
      if (state === "expired") throw new Error("errCodeExpired");
      if (state === "usedUp") throw new Error("errCodeExhausted");

      if (!db.enrollments.some((e) => e.userId === principal.userId && e.courseId === courseId)) {
        db.enrollments.push({
          _id: nextId(db, "enr"),
          userId: principal.userId,
          courseId,
          instructorId: codeRow.instructorId,
          codeId: codeRow._id,
          createdAt: now,
        });
        codeRow.uses += 1;
        saveDb(db);
      }
      return { ok: true };
    }
    case "courses:addReview": {
      const principal = requirePrincipal(db);
      const courseId = str(rawArgs.courseId);
      const course = db.courses.find((c) => c._id === courseId);
      if (!course) throw new Error("errNotFound");
      const rating = Math.round(num(rawArgs.rating, 5));
      const comment = cleanText(str(rawArgs.comment), 800);
      if (!comment) throw new Error("errRequired");
      db.courseReviews.push({
        _id: nextId(db, "crev"),
        courseId,
        userId: principal.userId,
        instructorId: course.instructorId,
        rating,
        comment,
        status: "visible",
        createdAt: now,
      });
      course.ratingCount += 1;
      course.ratingSum += rating;
      saveDb(db);
      return { ok: true };
    }
    case "courses:replyToReview": {
      const principal = requirePrincipal(db);
      const review = db.courseReviews.find((r) => r._id === str(rawArgs.reviewId));
      if (!review) throw new Error("errNotFound");
      const inst = db.instructors.find((i) => i._id === review.instructorId);
      if (!inst || inst.userId !== principal.userId) throw new Error("errNotAuthorized");
      review.instructorReply = cleanText(str(rawArgs.reply), 500);
      review.repliedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "courses:fileComplaint": {
      const principal = requirePrincipal(db);
      db.courseComplaints.push({
        _id: nextId(db, "ccomp"),
        reporterId: principal.userId,
        targetType: rawArgs.targetType === "instructor" ? "instructor" : "course",
        targetId: str(rawArgs.targetId),
        courseId: optStr(rawArgs.courseId),
        reason: (rawArgs.reason as LocalCourseComplaint["reason"]) ?? "other",
        description: cleanText(str(rawArgs.description), 1200),
        code: optStr(rawArgs.code),
        evidenceStorageId: optStr(rawArgs.evidenceStorageId),
        status: "new",
        createdAt: now,
      });
      saveDb(db);
      return { ok: true };
    }

    // Instructor endpoints
    case "instructor:myApplication": {
      const principal = requirePrincipal(db);
      const row = db.instructors.find((i) => i.userId === principal.userId);
      if (!row) return { status: "none" as const };
      return {
        status: row.status,
        decisionNote: row.decisionNote ?? null,
        updatedAt: row.updatedAt,
      };
    }
    case "instructor:apply": {
      const principal = requirePrincipal(db);
      const name = cleanText(str(rawArgs.name), 80);
      const bio = cleanText(str(rawArgs.bio), 600);
      const experience = cleanText(str(rawArgs.experience), 600);
      if (!name || !bio || !experience) throw new Error("errRequired");
      const existing = db.instructors.find((i) => i.userId === principal.userId);
      if (existing) {
        existing.name = name;
        existing.bio = bio;
        existing.experience = experience;
        existing.contactE164 = str(rawArgs.contactE164).trim();
        existing.wilaya = num(rawArgs.wilaya, 16);
        existing.proofLinks = arr<string>(rawArgs.proofLinks);
        existing.socialLinks = arr<string>(rawArgs.socialLinks);
        existing.photoStorageId = optStr(rawArgs.photoStorageId);
        if (existing.status === "rejected") existing.status = "pending";
        existing.updatedAt = now;
        saveDb(db);
        return { status: existing.status };
      }
      db.instructors.push({
        _id: nextId(db, "inst"),
        userId: principal.userId,
        name,
        bio,
        experience,
        photoStorageId: optStr(rawArgs.photoStorageId),
        proofLinks: arr<string>(rawArgs.proofLinks),
        contactE164: str(rawArgs.contactE164).trim(),
        wilaya: num(rawArgs.wilaya, 16),
        socialLinks: arr<string>(rawArgs.socialLinks),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      saveDb(db);
      return { status: "pending" as const };
    }
    case "instructor:withdraw": {
      const principal = requirePrincipal(db);
      const idx = db.instructors.findIndex(
        (i) => i.userId === principal.userId && i.status === "pending",
      );
      if (idx >= 0) {
        db.instructors.splice(idx, 1);
        saveDb(db);
      }
      return { ok: true };
    }
    case "instructor:listMyCourses": {
      const principal = requirePrincipal(db);
      return db.courses
        .filter((c) => c.ownerId === principal.userId)
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    case "instructor:getMyCourse": {
      const principal = requirePrincipal(db);
      const course = db.courses.find(
        (c) => c._id === str(rawArgs.courseId) && c.ownerId === principal.userId,
      );
      return course ?? null;
    }
    case "instructor:createCourse": {
      const principal = requirePrincipal(db);
      const inst = db.instructors.find(
        (i) => i.userId === principal.userId && i.status === "approved",
      );
      if (!inst) throw new Error("errNotAuthorized");
      const title = cleanText(str(rawArgs.title), 120);
      const description = cleanText(str(rawArgs.description), 4000);
      if (title.length < 6 || description.length < 30) throw new Error("errRequired");
      const id = nextId(db, "course");
      db.courses.push({
        _id: id,
        instructorId: inst._id,
        ownerId: principal.userId,
        title,
        description,
        coverStorageId: optStr(rawArgs.coverStorageId),
        topics: arr<string>(rawArgs.topics),
        level: (rawArgs.level as LocalCourse["level"]) ?? "beginner",
        language: (rawArgs.language as LocalCourse["language"]) ?? "ar",
        format: (rawArgs.format as LocalCourse["format"]) ?? "recorded",
        wilaya: typeof rawArgs.wilaya === "number" ? rawArgs.wilaya : undefined,
        durationHours: num(rawArgs.durationHours, 1),
        priceDa: num(rawArgs.priceDa, 0),
        startsAt: typeof rawArgs.startsAt === "number" ? rawArgs.startsAt : undefined,
        seats: typeof rawArgs.seats === "number" ? rawArgs.seats : undefined,
        curriculum: arr<string>(rawArgs.curriculum),
        previewVideoUrl: optStr(rawArgs.previewVideoUrl),
        externalContact: cleanText(str(rawArgs.externalContact), 120),
        status: "active",
        viewCount: 0,
        ratingCount: 0,
        ratingSum: 0,
        createdAt: now,
        updatedAt: now,
      });
      saveDb(db);
      return { courseId: id };
    }
    case "instructor:updateCourse": {
      const principal = requirePrincipal(db);
      const course = db.courses.find(
        (c) => c._id === str(rawArgs.courseId) && c.ownerId === principal.userId,
      );
      if (!course) throw new Error("errNotAuthorized");
      Object.assign(course, {
        title: rawArgs.title !== undefined ? cleanText(str(rawArgs.title), 120) : course.title,
        description:
          rawArgs.description !== undefined
            ? cleanText(str(rawArgs.description), 4000)
            : course.description,
        priceDa: rawArgs.priceDa !== undefined ? num(rawArgs.priceDa) : course.priceDa,
        durationHours:
          rawArgs.durationHours !== undefined ? num(rawArgs.durationHours) : course.durationHours,
        updatedAt: now,
      });
      saveDb(db);
      return { ok: true };
    }
    case "instructor:setCourseStatus": {
      const principal = requirePrincipal(db);
      const course = db.courses.find(
        (c) => c._id === str(rawArgs.courseId) && c.ownerId === principal.userId,
      );
      if (!course) throw new Error("errNotAuthorized");
      course.status = (rawArgs.status as LocalCourse["status"]) ?? course.status;
      course.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "instructor:deleteCourse": {
      const principal = requirePrincipal(db);
      const idx = db.courses.findIndex(
        (c) => c._id === str(rawArgs.courseId) && c.ownerId === principal.userId,
      );
      if (idx >= 0) {
        db.courses.splice(idx, 1);
        saveDb(db);
      }
      return { ok: true };
    }
    case "instructor:listCodes": {
      const principal = requirePrincipal(db);
      return db.enrollmentCodes.filter(
        (c) => c.courseId === str(rawArgs.courseId) && c.createdBy === principal.userId,
      );
    }
    case "instructor:createCode": {
      const principal = requirePrincipal(db);
      const inst = db.instructors.find((i) => i.userId === principal.userId);
      if (!inst) throw new Error("errNotAuthorized");
      const codeStr = `TJ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const id = nextId(db, "code");
      db.enrollmentCodes.push({
        _id: id,
        courseId: str(rawArgs.courseId),
        instructorId: inst._id,
        code: codeStr,
        maxUses: Math.max(1, num(rawArgs.maxUses, 1)),
        uses: 0,
        expiresAt: typeof rawArgs.expiresAt === "number" ? rawArgs.expiresAt : undefined,
        label: optStr(rawArgs.label),
        createdBy: principal.userId,
        createdAt: now,
      });
      saveDb(db);
      return { codeId: id, code: codeStr };
    }
    case "instructor:revokeCode": {
      const principal = requirePrincipal(db);
      const code = db.enrollmentCodes.find(
        (c) => c._id === str(rawArgs.codeId) && c.createdBy === principal.userId,
      );
      if (code) {
        code.revokedAt = now;
        saveDb(db);
      }
      return { ok: true };
    }
    case "instructor:addMaterial": {
      const principal = requirePrincipal(db);
      const inst = db.instructors.find((i) => i.userId === principal.userId);
      if (!inst) throw new Error("errNotAuthorized");
      db.courseMaterials.push({
        _id: nextId(db, "mat"),
        courseId: str(rawArgs.courseId),
        instructorId: inst._id,
        title: cleanText(str(rawArgs.title), 120),
        link: str(rawArgs.link).trim(),
        note: optStr(rawArgs.note),
        createdAt: now,
      });
      saveDb(db);
      return { ok: true };
    }
    case "instructor:removeMaterial": {
      requirePrincipal(db);
      const idx = db.courseMaterials.findIndex((m) => m._id === str(rawArgs.materialId));
      if (idx >= 0) {
        db.courseMaterials.splice(idx, 1);
        saveDb(db);
      }
      return { ok: true };
    }
    case "instructor:addAnnouncement": {
      const principal = requirePrincipal(db);
      const inst = db.instructors.find((i) => i.userId === principal.userId);
      if (!inst) throw new Error("errNotAuthorized");
      db.courseAnnouncements.push({
        _id: nextId(db, "ann"),
        courseId: str(rawArgs.courseId),
        instructorId: inst._id,
        title: cleanText(str(rawArgs.title), 120),
        body: cleanText(str(rawArgs.body), 2000),
        createdAt: now,
      });
      saveDb(db);
      return { ok: true };
    }
    case "instructor:stats": {
      const principal = requirePrincipal(db);
      const mine = db.courses.filter((c) => c.ownerId === principal.userId);
      const myIds = new Set(mine.map((c) => c._id));
      const enrollments = db.enrollments.filter((e) => myIds.has(e.courseId)).length;
      const views = mine.reduce((sum, c) => sum + c.viewCount, 0);
      const reviews = db.courseReviews.filter((r) => myIds.has(r.courseId));
      return {
        courses: mine.length,
        views,
        enrollments,
        reviews: reviews.length,
        avgRating: reviews.length
          ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
          : null,
      };
    }
    case "instructor:trackView": {
      const course = db.courses.find((c) => c._id === str(rawArgs.courseId));
      if (course) {
        course.viewCount += 1;
        saveDb(db);
      }
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    // Admin Categories
    // -----------------------------------------------------------------------
    case "adminCategories:listAdmin": {
      return [...db.productCategories].sort((a, b) => a.order - b.order);
    }
    case "adminCategories:iconKeys": {
      return [...CATEGORY_ICON_KEYS];
    }
    case "adminCategories:usage": {
      const counts: Record<string, number> = {};
      for (const p of db.products) {
        counts[p.category] = (counts[p.category] ?? 0) + 1;
      }
      return counts;
    }
    case "adminCategories:ensureDefaults": {
      requireAdminPrincipal(db);
      if (db.productCategories.length === 0) {
        CATEGORIES.forEach((c, idx) => {
          db.productCategories.push({
            _id: nextId(db, "cat"),
            key: c.key,
            ar: c.ar,
            fr: c.fr,
            icon: c.icon,
            order: idx,
            active: true,
          });
        });
        saveDb(db);
      }
      return { ok: true };
    }
    case "adminCategories:create": {
      requireAdminPrincipal(db);
      const key = str(rawArgs.key).trim().toLowerCase();
      if (!key || db.productCategories.some((c) => c.key === key)) {
        throw new Error("errDuplicateCategory");
      }
      db.productCategories.push({
        _id: nextId(db, "cat"),
        key,
        ar: cleanText(str(rawArgs.ar), 80),
        fr: cleanText(str(rawArgs.fr), 80),
        icon: isCategoryIconKey(rawArgs.icon) ? rawArgs.icon : "Package",
        order: num(rawArgs.order, db.productCategories.length),
        active: true,
        parent: optStr(rawArgs.parent),
      });
      saveDb(db);
      return { ok: true };
    }
    case "adminCategories:update": {
      requireAdminPrincipal(db);
      const cat = db.productCategories.find((c) => c.key === str(rawArgs.key));
      if (!cat) throw new Error("errNotFound");
      cat.ar = cleanText(str(rawArgs.ar, cat.ar), 80);
      cat.fr = cleanText(str(rawArgs.fr, cat.fr), 80);
      if (isCategoryIconKey(rawArgs.icon)) cat.icon = rawArgs.icon;
      if (rawArgs.order !== undefined) cat.order = num(rawArgs.order, cat.order);
      if (rawArgs.active !== undefined) cat.active = bool(rawArgs.active, true);
      saveDb(db);
      return { ok: true };
    }
    case "adminCategories:setActive": {
      requireAdminPrincipal(db);
      const cat = db.productCategories.find((c) => c.key === str(rawArgs.key));
      if (!cat) throw new Error("errNotFound");
      cat.active = bool(rawArgs.active);
      saveDb(db);
      return { ok: true };
    }
    case "adminCategories:remove": {
      requireAdminPrincipal(db);
      const key = str(rawArgs.key);
      const inUse = db.products.some((p) => p.category === key);
      if (inUse) {
        const cat = db.productCategories.find((c) => c.key === key);
        if (cat) cat.active = false;
        saveDb(db);
        return { deleted: false, deactivated: true };
      }
      db.productCategories = db.productCategories.filter((c) => c.key !== key);
      saveDb(db);
      return { deleted: true, deactivated: false };
    }

    // -----------------------------------------------------------------------
    // Admin Courses
    // -----------------------------------------------------------------------
    case "adminCourses:overview": {
      requireAdminPrincipal(db);
      return {
        kpis: {
          courses: db.courses.length,
          instructors: db.instructors.length,
          enrollments: db.enrollments.length,
          complaints: db.courseComplaints.length,
          codes: db.enrollmentCodes.length,
        },
        instructors: db.instructors.map((inst) => ({
          ...inst,
          courseCount: db.courses.filter((c) => c.instructorId === inst._id).length,
        })),
        complaints: db.courseComplaints,
        newComplaints: db.courseComplaints.filter((c) => c.status === "new").length,
        courses: db.courses,
        reviews: db.courseReviews,
        autoHideThreshold: COMPLAINT_AUTO_HIDE_THRESHOLD,
      };
    }
    case "adminCourses:decideInstructor": {
      requireAdminPrincipal(db);
      const inst = db.instructors.find((i) => i._id === str(rawArgs.instructorId));
      if (!inst) throw new Error("errNotFound");
      const decision = str(rawArgs.decision);
      inst.status =
        decision === "unsuspended"
          ? "approved"
          : (decision as LocalInstructor["status"]);
      inst.decisionNote = optStr(rawArgs.note);
      inst.decidedAt = now;
      inst.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "adminCourses:setCourseVisible": {
      requireAdminPrincipal(db);
      const course = db.courses.find((c) => c._id === str(rawArgs.courseId));
      if (!course) throw new Error("errNotFound");
      course.status = bool(rawArgs.visible) ? "active" : "hidden";
      course.hiddenReason = optStr(rawArgs.reason);
      course.updatedAt = now;
      saveDb(db);
      return { ok: true };
    }
    case "adminCourses:setReviewVisible": {
      requireAdminPrincipal(db);
      const rev = db.courseReviews.find((r) => r._id === str(rawArgs.reviewId));
      if (!rev) throw new Error("errNotFound");
      rev.status = bool(rawArgs.visible) ? "visible" : "hidden";
      saveDb(db);
      return { ok: true };
    }
    case "adminCourses:deleteCourse": {
      requireAdminPrincipal(db);
      db.courses = db.courses.filter((c) => c._id !== str(rawArgs.courseId));
      saveDb(db);
      return { ok: true };
    }
    case "adminCourses:decideComplaint": {
      requireAdminPrincipal(db);
      const comp = db.courseComplaints.find((c) => c._id === str(rawArgs.complaintId));
      if (!comp) throw new Error("errNotFound");
      comp.status = (rawArgs.status as LocalCourseComplaint["status"]) ?? "resolved";
      comp.internalNote = optStr(rawArgs.note);
      saveDb(db);
      return { ok: true };
    }

    // -----------------------------------------------------------------------
    // Admin Platform Panel
    // -----------------------------------------------------------------------
    case "admin:kpis": {
      requireAdminPrincipal(db);
      const activeSubs = db.subscriptions.filter((s) => subscriptionIsLive(s, now));
      const approved = db.payments.filter((p) => p.status === "approved");
      const revenueByPlan: Record<string, number> = { trial: 0, free: 0, basic: 0, pro: 0 };
      for (const p of approved) revenueByPlan[p.plan] = (revenueByPlan[p.plan] ?? 0) + p.amountDa;

      const signupsByDay = new Map<string, number>();
      for (const u of db.users) {
        const day = todayKey(u._creationTime);
        signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1);
      }

      const categoryCounts = new Map<string, number>();
      for (const p of db.products) {
        categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
      }

      const shopCounts = new Map<string, number>();
      for (const p of db.products) {
        shopCounts.set(p.shopId, (shopCounts.get(p.shopId) ?? 0) + 1);
      }

      return {
        totals: {
          users: db.users.length,
          wholesalers: db.users.filter((u) => u.role === "wholesaler").length,
          retailers: db.users.filter((u) => u.role === "retailer").length,
          shops: db.shops.length,
          products: db.products.length,
          reviews: db.reviews.length,
          openReports: db.reports.filter((r) => r.status === "open").length,
          pendingPayments: db.payments.filter((p) => p.status === "pending").length,
          pendingVerifications: db.shops.filter((s) => s.verification === "pending").length,
        },
        signups: [...signupsByDay.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-30)
          .map(([day, count]) => ({ day, count })),
        activeSubscriptions: activeSubs.length,
        revenueTotal: approved.reduce((a, p) => a + p.amountDa, 0),
        revenueByPlan,
        conversionTrialToPaid: 25,
        topCategories: [...categoryCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([category, count]) => ({ category, count })),
        topWholesalers: [...shopCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([shopId, count]) => ({
            shopId,
            name: db.shops.find((s) => s._id === shopId)?.name ?? "—",
            products: count,
          })),
        suspiciousReviews: db.reviews.filter((r) => r.flaggedSuspicious).length,
      };
    }
    case "admin:listUsers": {
      requireAdminPrincipal(db);
      let rows = [...db.users];
      if (rawArgs.role) rows = rows.filter((u) => u.role === rawArgs.role);
      if (rawArgs.suspended !== undefined) {
        rows = rows.filter((u) => Boolean(u.suspended) === bool(rawArgs.suspended));
      }
      if (typeof rawArgs.q === "string" && rawArgs.q.trim()) {
        const needle = rawArgs.q.toLowerCase();
        rows = rows.filter(
          (u) =>
            (u.name ?? "").toLowerCase().includes(needle) ||
            (u.email ?? "").toLowerCase().includes(needle),
        );
      }
      rows.sort((a, b) => b._creationTime - a._creationTime);
      return rows.slice(0, num(rawArgs.limit, 200)).map((u) => {
        const shop = db.shops.find((s) => s.ownerId === u._id);
        const sub = db.subscriptions
          .filter((s) => s.ownerId === u._id && subscriptionIsLive(s, now))
          .sort((a, b) => b.expiresAt - a.expiresAt)[0];
        return {
          id: u._id,
          name: u.name ?? "—",
          email: u.email ?? "—",
          role: u.role ?? "retailer",
          wilaya: u.wilaya ?? null,
          whatsapp: shop?.whatsappE164 ?? u.whatsappE164 ?? null,
          suspended: u.suspended ?? false,
          verified: shop?.verification === "approved",
          shopName: shop?.name ?? null,
          plan: sub?.plan ?? null,
          createdAt: u._creationTime,
        };
      });
    }
    case "admin:listPayments": {
      requireAdminPrincipal(db);
      let rows = [...db.payments];
      if (rawArgs.status && rawArgs.status !== "all") {
        rows = rows.filter((p) => p.status === rawArgs.status);
      }
      return rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((p) => {
          const owner = db.users.find((u) => u._id === p.ownerId);
          return {
            id: p._id,
            ownerName: owner?.name ?? "—",
            ownerEmail: owner?.email ?? "—",
            audience: p.audience,
            plan: p.plan,
            amountDa: p.amountDa,
            method: p.method,
            reference: p.reference,
            status: p.status,
            createdAt: p.createdAt,
            reviewedAt: p.reviewedAt ?? null,
          };
        });
    }
    case "admin:listVerifications": {
      requireAdminPrincipal(db);
      return db.shops
        .filter((s) => s.verification === "pending" || s.verification === "approved")
        .sort((a, b) => (a.verifiedAt ?? 0) - (b.verifiedAt ?? 0))
        .map((s) => ({
          id: s._id,
          shopName: s.name,
          wilaya: s.wilaya,
          rcNumber: s.rcNumber ?? null,
          verification: s.verification,
          verifiedAt: s.verifiedAt ?? null,
          documentStorageId: s.rcDocumentStorageId ?? null,
          createdAt: s.createdAt,
        }));
    }
    case "admin:listReports": {
      requireAdminPrincipal(db);
      let rows = [...db.reports];
      if (rawArgs.status && rawArgs.status !== "all") {
        rows = rows.filter((r) => r.status === rawArgs.status);
      }
      return rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => ({
          id: r._id,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          details: r.details ?? null,
          status: r.status,
          createdAt: r.createdAt,
        }));
    }
    case "admin:listPromos": {
      requireAdminPrincipal(db);
      return db.promoCodes.map((p) => {
        const used = db.promoRedemptions.filter((r) => r.codeId === p._id).length;
        return {
          id: p._id,
          code: p.code,
          kind: p.kind,
          freeDays: p.freeDays ?? null,
          percent: p.percent ?? null,
          maxUses: p.maxUses,
          used,
          remaining: Math.max(0, p.maxUses - used),
          audience: p.audience,
          isActive: p.isActive,
          expiresAt: p.expiresAt ?? null,
        };
      });
    }
    case "admin:listReviews": {
      requireAdminPrincipal(db);
      let rows = [...db.reviews];
      if (rawArgs.onlySuspicious) rows = rows.filter((r) => r.flaggedSuspicious);
      return rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => ({
          id: r._id,
          productName: db.products.find((p) => p._id === r.productId)?.name ?? "—",
          productRating: r.productRating,
          sellerRating: r.sellerRating,
          comment: r.comment ?? null,
          status: r.status,
          flagged: r.flaggedSuspicious ?? false,
          suspicionReason: r.suspicionReason ?? null,
          verifiedContact: r.verifiedContact,
          createdAt: r.createdAt,
        }));
    }
    case "admin:auditLog": {
      requireAdminPrincipal(db);
      return [...db.auditLog]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, num(rawArgs.limit, 100))
        .map((r) => ({
          id: r._id,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          details: r.details ?? null,
          createdAt: r.createdAt,
        }));
    }
    case "admin:verifyShop": {
      const admin = requireAdminPrincipal(db);
      const shop = db.shops.find((s) => s._id === str(rawArgs.shopId));
      if (!shop) throw new Error("errNotFound");
      shop.verification = bool(rawArgs.approve) ? "approved" : "rejected";
      shop.verifiedAt = bool(rawArgs.approve) ? now : undefined;
      addAudit(db, {
        actorId: admin.userId,
        action: bool(rawArgs.approve) ? "shop.verify_approve" : "shop.verify_reject",
        targetType: "shop",
        targetId: shop._id,
      });
      saveDb(db);
      return { ok: true };
    }
    case "admin:setUserSuspended": {
      const admin = requireAdminPrincipal(db);
      const user = db.users.find((u) => u._id === str(rawArgs.userId));
      if (!user) throw new Error("errNotFound");
      user.suspended = bool(rawArgs.suspended);
      addAudit(db, {
        actorId: admin.userId,
        action: bool(rawArgs.suspended) ? "user.suspend" : "user.unsuspend",
        targetType: "user",
        targetId: user._id,
      });
      saveDb(db);
      return { ok: true };
    }
    case "admin:setUserRole": {
      const admin = requireAdminPrincipal(db);
      const user = db.users.find((u) => u._id === str(rawArgs.userId));
      if (!user) throw new Error("errNotFound");
      user.role = str(rawArgs.role, user.role);
      addAudit(db, {
        actorId: admin.userId,
        action: `user.role_${user.role}`,
        targetType: "user",
        targetId: user._id,
      });
      saveDb(db);
      return { ok: true };
    }
    case "admin:moderateReview": {
      requireAdminPrincipal(db);
      const rev = db.reviews.find((r) => r._id === str(rawArgs.reviewId));
      if (!rev) throw new Error("errNotFound");
      rev.status = bool(rawArgs.hide) ? "hidden" : "visible";
      refreshProductStats(db, rev.productId);
      refreshShopSummary(db, rev.shopId);
      saveDb(db);
      return { ok: true };
    }
    case "admin:hideProduct": {
      requireAdminPrincipal(db);
      const p = db.products.find((row) => row._id === str(rawArgs.productId));
      if (!p) throw new Error("errNotFound");
      p.isPaused = bool(rawArgs.hide);
      saveDb(db);
      return { ok: true };
    }
    case "admin:resolveReport": {
      requireAdminPrincipal(db);
      const rep = db.reports.find((r) => r._id === str(rawArgs.reportId));
      if (!rep) throw new Error("errNotFound");
      rep.status = rawArgs.resolution === "dismissed" ? "dismissed" : "resolved";
      saveDb(db);
      return { ok: true };
    }
    case "admin:togglePromoActive": {
      requireAdminPrincipal(db);
      const promo = db.promoCodes.find((p) => p._id === str(rawArgs.promoId));
      if (!promo) throw new Error("errNotFound");
      promo.isActive = !promo.isActive;
      saveDb(db);
      return { ok: true };
    }
    case "admin:listAdmins": {
      requireAdminPrincipal(db);
      const adminUsers = db.users.filter((u) => u.role === "admin");
      const allEmails = Array.from(
        new Set([...SUPER_ADMIN_EMAILS, ...getExtraAdmins(), ...adminUsers.map((u) => u.email)]),
      );
      return {
        admins: adminUsers.map((u) => ({
          id: u._id,
          email: u.email,
          name: u.name ?? "مسؤول",
          createdAt: u._creationTime,
          isSuperAdmin: SUPER_ADMIN_EMAILS.includes(normalizeEmail(u.email)),
        })),
        allAdminEmails: allEmails,
      };
    }
    case "admin:addAdmin": {
      requireAdminPrincipal(db);
      const clean = normalizeEmail(str(rawArgs.email));
      if (!clean || !clean.includes("@")) throw new Error("errInvalidEmail");
      saveExtraAdmin(clean);
      const existing = db.users.find((u) => normalizeEmail(u.email) === clean);
      if (existing) {
        existing.role = "admin";
        if (typeof rawArgs.name === "string" && rawArgs.name.trim()) {
          existing.name = rawArgs.name.trim();
        }
        saveDb(db);
      }
      return { ok: true, email: clean };
    }
    case "admin:removeAdmin": {
      requireAdminPrincipal(db);
      const clean = normalizeEmail(str(rawArgs.email));
      if (SUPER_ADMIN_EMAILS.includes(clean)) throw new Error("errCannotRemoveSuperAdmin");
      removeExtraAdmin(clean);
      const existing = db.users.find((u) => normalizeEmail(u.email) === clean);
      if (existing) {
        existing.role = "retailer";
        saveDb(db);
      }
      return { ok: true };
    }

    default: {
      // Safe fallback for any unhandled read/write so the preview never hard-crashes
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Local ConvexReactClient Factory
// ---------------------------------------------------------------------------

export function createLocalConvexClient(): ConvexReactClient {
  installLocalUploadInterceptor();
  loadDb();
  loadCredentials();

  const localClient = {
    url: "https://local-preview.convex.cloud",
    logger: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      logVerbose: () => undefined,
    },
    setAuth: () => undefined,
    clearAuth: () => undefined,
    prewarmQuery: () => undefined,
    close: async () => undefined,
    connectionState: () => ({
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
      hasInflightRequests: false,
      inflightMutations: 0,
      inflightActions: 0,
      connectionCount: 1,
      connectionRetries: 0,
    }),
    subscribeToConnectionState: () => () => undefined,
    watchQuery<Query extends FunctionReference<"query">>(
      queryRef: Query,
      args?: Record<string, unknown> | "skip",
    ) {
      const fnName = getFunctionName(queryRef);
      return {
        onUpdate(callback: () => void) {
          const onAuthOrDb = () => callback();
          listeners.add(callback);
          if (typeof window !== "undefined") {
            window.addEventListener("tajirdz:auth-change", onAuthOrDb);
          }
          return () => {
            listeners.delete(callback);
            if (typeof window !== "undefined") {
              window.removeEventListener("tajirdz:auth-change", onAuthOrDb);
            }
          };
        },
        localQueryResult() {
          if (args === "skip") return undefined;
          try {
            return executeFunction(fnName, args ?? {});
          } catch {
            return undefined;
          }
        },
        journal() {
          return undefined;
        },
      };
    },
    async query<Query extends FunctionReference<"query">>(
      queryRef: Query,
      args?: Record<string, unknown>,
    ) {
      return executeFunction(getFunctionName(queryRef), args ?? {});
    },
    async mutation<Mutation extends FunctionReference<"mutation">>(
      mutationRef: Mutation,
      args?: Record<string, unknown>,
    ) {
      const result = executeFunction(getFunctionName(mutationRef), args ?? {});
      notifySubscribers();
      return result;
    },
    async action<Action extends FunctionReference<"action">>(
      actionRef: Action,
      args?: Record<string, unknown>,
    ) {
      const result = executeFunction(getFunctionName(actionRef), args ?? {});
      notifySubscribers();
      return result;
    },
  };

  return localClient as unknown as ConvexReactClient;
}

export { DELIVERY_OPTIONS, MIN_QTY_OPTIONS };
