/**
 * Demo data seed.
 *
 * Produces a believable marketplace: 15 wholesalers across the main wilayas,
 * ~60 products over 8 categories with quantity tiers, retailers with real
 * contact history, reviews whose ratings satisfy the Wilson winning rule, and
 * open quote requests.
 *
 * Everything written here is tagged in the `demoFlags` table so `removeDemoData`
 * can wipe the lot without touching real accounts.
 */

import { action, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

import { adminEmails } from "./lib/security";
import { requireAdmin } from "./lib/access";
import { v } from "convex/values";

import {
  CATEGORIES,
  DELIVERY_OPTIONS,
  MIN_QTY_OPTIONS,
  computeWinning,
  slugify,
} from "../lib/catalog";
import { DAY_MS } from "./lib/access";

const DEMO_SCOPE = "demo";

// ---------------------------------------------------------------------------
// Deterministic PRNG so re-seeding produces the same catalogue.
// ---------------------------------------------------------------------------

function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Realistic wholesale catalogue
// ---------------------------------------------------------------------------

type SeedProduct = {
  name: string;
  category: string;
  /** Base wholesale unit price in DA. */
  price: number;
  desc: string;
  tags: string[];
};

const CATALOGUE: Record<string, SeedProduct[]> = {
  fashion: [
    { name: "فستان صيفي نسائي", category: "fashion", price: 780, desc: "فستان صيفي خفيف، قماش قطنية، متوفر بكل المقاسات.", tags: ["فستان", "صيف", "نساء"] },
    { name: "قميص رجالي كلاسيك", category: "fashion", price: 950, desc: "قميص رجالي كلاسيكي بقصة عصرية، قماش مقاوم للتجعد.", tags: ["قميص", "رجال", "كلاسيك"] },
    { name: "طقم رياضي نسائي", category: "fashion", price: 1650, desc: "طقم رياضي من قطعتين، مناسب للرياضة والنادي.", tags: ["رياضي", "نساء", "طقم"] },
    { name: "حذاء رياضي أبيض", category: "fashion", price: 2100, desc: "حذاء رياضي أبيض أصلي، مقاسات من 38 إلى 46.", tags: ["حذاء", "رياضي", "أبيض"] },
    { name: "شنطة يد جلد صناعي", category: "fashion", price: 1250, desc: "شنطة يد نسائية من الجلد الصناعي، جيوب داخلية.", tags: ["شنطة", "جلد", "نساء"] },
    { name: "تيشيرت قطن مطبوع", category: "fashion", price: 420, desc: "تيشيرت قطن 100%، متوفر بعدة تصاميم.", tags: ["تيشيرت", "قطن"] },
    { name: "سروال جينز رجالي", category: "fashion", price: 1450, desc: "سروال جينز رجالي بقصة عصرية، عدة ألوان.", tags: ["جينز", "رجال"] },
    { name: "عباية صيفية", category: "fashion", price: 1850, desc: "عباية صيفية بخامة خفيفة ومطاوعة مريحة.", tags: ["عباية", "نساء"] },
  ],
  electronics: [
    { name: "سماعات بلوتوث لاسلكية", category: "electronics", price: 1350, desc: "سماعات بلوتوث 5.3 مع علبة شحن وبطارية تدوم 20 ساعة.", tags: ["سماعات", "بلوتوث", "لاسلكي"] },
    { name: "شاحن سريع 30 واط", category: "electronics", price: 890, desc: "شاحن سريع 30 واط بمنفذين، يدعم الشحن السريع للأجهزة الحديثة.", tags: ["شاحن", "سريع"] },
    { name: "كابل Type-C متين", category: "electronics", price: 320, desc: "كابل Type-C بطول متر، متين ضد القطع.", tags: ["كابل", "Type-C"] },
    { name: "ساعة ذكية بشاشة AMOLED", category: "electronics", price: 4200, desc: "ساعة ذكية بشاشة AMOLED، مقاومة للماء، تتبع النوم والنشاط.", tags: ["ساعة", "ذكية", "AMOLED"] },
    { name: "باور بانك 20000 مللي", category: "electronics", price: 2400, desc: "باور بانك 20000mAh مع شحن سريع وثلاثة منافذ.", tags: ["باور", "بانك"] },
    { name: "مكبر صوت بلوتوث", category: "electronics", price: 3100, desc: "مكبر صوت بلوتوث قوي مع إضاءة LED.", tags: ["مكبر", "صوت"] },
    { name: "لوحة مفاتيح لاسلكية", category: "electronics", price: 1650, desc: "لوحة مفاتيح لاسلكية هادئة، تصميم نحيف ومريح.", tags: ["لوحة", "مفاتيح"] },
    { name: "حامل هاتف مغناطيسي", category: "electronics", price: 450, desc: "حامل هاتف مغناطيسي لاسلكي للسيارة والمكتب.", tags: ["حامل", "هاتف"] },
  ],
  beauty: [
    { name: "عطر شرقي رجالي 100 مل", category: "beauty", price: 2800, desc: "عطر شرحي رجالي بتركيبة شرقية يدوم طويلاً.", tags: ["عطر", "رجالي", "شرقي"] },
    { name: "عطر نسوي فرنسي 50 مل", category: "beauty", price: 3600, desc: "عطر نسوي فرنسي بعبوة أنيقة.", tags: ["عطر", "نسوي"] },
    { name: "كريم ترطيب الوجه", category: "beauty", price: 1450, desc: "كريم ترطيب يومي للبشرة الجافة والحساسة.", tags: ["كريم", "وجهة"] },
    { name: "مجموعة عناية بالبشرة", category: "beauty", price: 2200, desc: "مجموعة عناية كاملة: غسول، سيروم، كريم.", tags: ["عناية", "بشرة"] },
    { name: "شمعة معطرة 200 غ", category: "beauty", price: 980, desc: "شمعة معطرة برائحة الياسمين، مدة احتراق 40 ساعة.", tags: ["شمعة", "معطرة"] },
    { name: "مكياج أساسي فردي", category: "beauty", price: 1750, desc: "طقم مكياج أساسي للاستعمال اليومي.", tags: ["مكياج"] },
  ],
  home: [
    { name: "طقم قدور ضغط 6 قطع", category: "home", price: 5600, desc: "طقم قدور ضغط من ستانلس ستيل مقاوم للصدأ، 6 قطع.", tags: ["قدور", "مطبخ"] },
    { name: "آلة قهوة إسبريسو", category: "home", price: 7400, desc: "آلة قهوة إسبريسو 15 بار مع مبخّر حليب.", tags: ["قهوة", "إسبريسو"] },
    { name: "خلاط كهربائي متعدد", category: "home", price: 3200, desc: "خلاط كهربائي متعدد الاستخدامات، سعة 1.5 لتر.", tags: ["خلاط", "مطبخ"] },
    { name: "طقم صحون 24 قطعة", category: "home", price: 4100, desc: "طقم صحون خزفي 24 قطعة، مقاوم للحرارة.", tags: ["صحون", "خزفي"] },
    { name: "مكنسة رمل كهربائية", category: "home", price: 8900, desc: "مكنسة شفط قوية بفلتر HEPA وسلك طويل.", tags: ["مكنسة"] },
    { name: "مرتبة ذكية بذاكرة", category: "home", price: 12500, desc: "مرتبة بذاكرة تستجيب للضغط، سبع مناطق دعم.", tags: ["مرتبة", "مفروشات"] },
    { name: "مصباح LED ذكي", category: "home", price: 1650, desc: "مصباح LED ذكي بألوان متغيرة والتحكم عبر التطبيق.", tags: ["مصباح", "LED", "ذكي"] },
  ],
  groceries: [
    { name: "زيت زيتون بكر 1 لتر", category: "groceries", price: 1250, desc: "زيت زيتون بكر ممتاز معبأ في زجاج.", tags: ["زيت", "زيتون"] },
    { name: "قهوة محمصة 250 غ", category: "groceries", price: 780, desc: "قهوة محمصة حديثاً، مذاق قوي ومتوازن.", tags: ["قهوة", "محمصة"] },
    { name: "تمر فاخر ممتاز", category: "groceries", price: 1600, desc: "تمور فاخرة من أفضل الأصناف، معبأة في علبة محكمة.", tags: ["تمر"] },
    { name: "عسل طبيعي 500 غ", category: "groceries", price: 2200, desc: "عسل طبيعي جبلي خام غير مضاف إليه.", tags: ["عسل", "طبيعي"] },
    { name: "شاي أخضر 100 كيس", category: "groceries", price: 620, desc: "شاي أخضر فاتح في علبة 100 كيس.", tags: ["شاي"] },
    { name: "ماء معدني عبوة كبيرة", category: "groceries", price: 380, desc: "عبوات ماء معدني 6 قناطر.", tags: ["ماء"] },
  ],
  kids: [
    { name: "عربة أطفال قابلة للطي", category: "kids", price: 9500, desc: "عربة أطفال خفيفة قابلة للطي، مقعد قابل للاستلقاء.", tags: ["عربة", "أطفال"] },
    { name: "سيارة أطفال بالتحكم", category: "kids", price: 6800, desc: "سيارة أطفال تعمل بالبطارية وبريموت كنترول.", tags: ["سيارة", "أطفال"] },
    { name: "طقم ملابس رضيع", category: "kids", price: 1350, desc: "طقم ملابس للرضيع من 5 قطع، قطن ناعم.", tags: ["ملابس", "رضيع"] },
    { name: "كراسة نشاط تعليمية", category: "kids", price: 480, desc: "كراسة أنشطة تعليمية للأعمار 4-7 سنوات.", tags: ["كراسة", "تعليم"] },
    { name: "عدسة أطفال للرياضة", category: "kids", price: 560, desc: "عدسة أطفال بإطار مرن ومقاومة للخدش.", tags: ["عدسة", "نظارات"] },
  ],
  auto: [
    { name: "غسيل سيارات بالطراز", category: "auto", price: 780, desc: "طقم غسيل سيارات كامل مع جلد وميغ.", tags: ["غسيل", "سيارات"] },
    { name: "زيت محرك 5W-30 4 لتر", category: "auto", price: 3200, desc: "زيت محرك صناعي 5W-30 بعبوة 4 لتر.", tags: ["زيت", "محرك"] },
    { name: "بطارية سيارة 70Ah", category: "auto", price: 12500, desc: "بطارية سيارة 70 أمبير، ضمان سنة.", tags: ["بطارية", "سيارة"] },
    { name: "مجموعة فرامل أمامية", category: "auto", price: 6400, desc: "مجموعة فرامل أمامية كاملة، تركيب سهل.", tags: ["فرامل", "قطع"] },
    { name: "كابل شاحن سيارة مزدوج", category: "auto", price: 1150, desc: "شاحن سيارة مزدوج بمنفذين USB ومنفذ سيارة.", tags: ["شاحن", "سيارة"] },
    { name: "كاميرا رؤية خلفية", category: "auto", price: 2400, desc: "كاميرا رؤية خلفية مع شاشة صغيرة ولوح ترخيص.", tags: ["كاميرا", "سيارة"] },
  ],
  other: [
    { name: "مظلة صغيرة قابلة للطي", category: "other", price: 620, desc: "مظلة صغيرة قابلة للطي، مقاومة للرياح.", tags: ["مظلة"] },
    { name: "حقيبة ظهر عصرية", category: "other", price: 1890, desc: "حقيبة ظهر عصرية مع منفذ شحن USB.", tags: ["حقيبة", "ظهر"] },
    { name: "ساعة رملية ديكورية", category: "other", price: 950, desc: "ساعة رملية ديكورية بتصميم أنيق يصلح كهدية.", tags: ["ديكور"] },
    { name: "علبة تخزين بلاستيكية", category: "other", price: 380, desc: "علبة تخزين محكمة الإغلاق، 10 قطع.", tags: ["تخزين"] },
  ],
};

/** Collapse whitespace on seeded copy; content is authored, not machine-mixed. */
function fixText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Wholesalers
// ---------------------------------------------------------------------------

type SeedShop = {
  shop: string;
  owner: string;
  wilaya: number;
  commune: string;
  phone: string;
  categories: string[];
  verified: boolean;
  plan: "free" | "basic" | "pro";
  prepDays: number;
};

const SHOPS: SeedShop[] = [
  { shop: "Electra Wholesale", owner: "كريم بلعيد", wilaya: 19, commune: "سيدي عكاشة", phone: "213555123456", categories: ["electronics", "home"], verified: true, plan: "pro", prepDays: 1 },
  { shop: "مجمع الوفاء للجملة", owner: "ياسين عمراني", wilaya: 16, commune: "باب الوادي", phone: "213661234567", categories: ["fashion", "beauty"], verified: true, plan: "pro", prepDays: 2 },
  { shop: "Silk Road Wholesale", owner: "Amine Belkacem", wilaya: 16, commune: "Hydra", phone: "213770111222", categories: ["fashion", "other"], verified: true, plan: "basic", prepDays: 2 },
  { shop: " سوق الأمل", owner: "سمير حداد", wilaya: 19, commune: "عين ولمان", phone: "213554321987", categories: ["groceries", "home"], verified: true, plan: "basic", prepDays: 1 },
  { shop: "Beauty Star'import", owner: "ليلى شرقي", wilaya: 6, commune: "أقبو", phone: "213669876543", categories: ["beauty"], verified: true, plan: "basic", prepDays: 3 },
  { shop: "Auto Parts Express", owner: "عبد الرحمان قاسم", wilaya: 31, commune: "السانيا", phone: "213551234987", categories: ["auto"], verified: true, plan: "basic", prepDays: 2 },
  { shop: "Kids & Co Distribution", owner: "سعاد مرزوق", wilaya: 25, commune: "الخروب", phone: "213778765432", categories: ["kids", "other"], verified: false, plan: "basic", prepDays: 3 },
  { shop: "مخزن النخبة", owner: "فريد زروقي", wilaya: 25, commune: "عين سمارة", phone: "213660998877", categories: ["electronics", "auto"], verified: true, plan: "pro", prepDays: 1 },
  { shop: "El Eulma Textile Hub", owner: "Nabil Cherif", wilaya: 19, commune: "El Eulma", phone: "213555887744", categories: ["fashion"], verified: true, plan: "pro", prepDays: 2 },
  { shop: "تجارة الأمانة", owner: "حسين بوعلام", wilaya: 31, commune: "حاسي مسعود", phone: "213773450987", categories: ["groceries", "kids"], verified: false, plan: "basic", prepDays: 2 },
  { shop: "Home Living Store", owner: "Meriem Haddad", wilaya: 16, commune: "Kouba", phone: "213559988776", categories: ["home", "other"], verified: true, plan: "basic", prepDays: 3 },
  { shop: "سوق النور", owner: "عبد الرحمان طالب", wilaya: 7, commune: "زريبة الوادي", phone: "213660554433", categories: ["groceries", "beauty"], verified: false, plan: "free", prepDays: 2 },
  { shop: "Perfume Palace", owner: "Sofia Meziane", wilaya: 6, commune: "Bejaia Centre", phone: "213771234567", categories: ["beauty", "other"], verified: true, plan: "basic", prepDays: 4 },
  { shop: "Bulk Food Sétif", owner: "علي بوجمعة", wilaya: 19, commune: "بوقاعة", phone: "213553311224", categories: ["groceries"], verified: true, plan: "basic", prepDays: 1 },
  { shop: "Mobile Accessories Oran", owner: "Rachid Benali", wilaya: 31, commune: "Bir El Djir", phone: "213550998877", categories: ["electronics"], verified: true, plan: "basic", prepDays: 2 },
];

const RETAILERS = [
  { name: "سوق أونلاين الجزائر", wilaya: 16, storeType: "facebook", phone: "213555111222" },
  { name: "EcomDZ Store", wilaya: 31, storeType: "website", phone: "213661333444" },
  { name: "متجر الأنيق", wilaya: 19, storeType: "instagram", phone: "213770555666" },
  { name: "TikTok Deals DZ", wilaya: 25, storeType: "tiktok", phone: "213555777888" },
  { name: "Boutique Chahinez", wilaya: 6, storeType: "instagram", phone: "213661999000" },
];

const REVIEW_COMMENTS = [
  "المنتج جا ممتاز والجودة أحسن من المتوقع، التاجر جاوب بسرعة.",
  "الكمية كانت كافية والدفع تم بلا مشاكل. توصية بزاف.",
  "بضاعة_original ومطابقة للوصف، التوصيل وصل في الوقت.",
  "ثمن الجملة معقول مقارنة بالجودة. راح نطلب مرة أخرى.",
  "الكمية الدنيا كانت مناسبة لي. الخدمة محترمة.",
  "المنتج رابح بصح التوصيل تأخر يوم واحد، ماعدا ذاك.",
  "جربت المنتج وبعتو في يومين، مبيعات مزيانة.",
  "الورق كان حجمه أصغر من الوصف شوية، بصح الجودة مليحة.",
];

const RETAILER_POOL_SIZE = 5;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Courses demo data
// ---------------------------------------------------------------------------

/**
 * Three verified instructors, eight courses, a few codes and two reviews.
 *
 * The codes are the interesting part: one untouched single-use code, one that
 * has already been used twice out of five, and one the instructor revoked. That
 * is every branch the enrollment box can take, available without editing data
 * by hand.
 */
async function seedCourses(ctx: MutationCtx, now: number) {
  const INSTRUCTORS = [
    {
      email: "instructor1@tajirdz.demo",
      name: "أمين بوعلام",
      wilaya: 16,
      phone: "+213555100001",
      bio: "شغلت 4 متاجر إلكترونية في الجزائر، ودرّبت أكثر من 300 طالب على الدروبشيبينغ والإعلانات.",
      experience: "6 سنين دروبشيبينغ، إدارة إعلانات فيسبوك بميزانية شهرية، وتدريب حضوريات في الجزائر العاصمة.",
      socials: ["https://www.facebook.com/amin.ecom"],
      proof: ["https://drive.google.com/demo-amin"],
    },
    {
      email: "instructor2@tajirdz.demo",
      name: "سارة بن علي",
      wilaya: 31,
      phone: "+213555100002",
      bio: "متخصصة في تيك توك أورغانيك وبناء المتاجر، ناوية نوصل 1000 تاجر جزائري لأول عملية بيع.",
      experience: "5 سنين محتوى قصير، أكثر من 40 متجر تيك توك أنشأتها ورافقتها من الصفر.",
      socials: ["https://www.tiktok.com/@sara.ecom"],
      proof: ["https://sara-ecom.example.com/portfolio"],
    },
    {
      email: "instructor3@tajirdz.demo",
      name: "ياسين حداد",
      wilaya: 25,
      phone: "+213555100003",
      bio: "مسؤول لوجستيك سابق، نعلمك كيفاش تشري من الصين وتوصل بلا ما تخسر فلوسك في الشحن.",
      experience: "8 سنين توريد وشحن، تعامل مع أكثر من 120 مورد وشريك شحن دولي.",
      socials: [],
      proof: ["https://www.linkedin.com/in/yassine-demo"],
    },
  ];

  const instructorIds: Id<"instructors">[] = [];
  const userIds: Id<"users">[] = [];
  for (const [index, seed] of INSTRUCTORS.entries()) {
    const userId = await ctx.db.insert("users", {
      name: seed.name,
      email: seed.email,
      role: "retailer",
      wilaya: seed.wilaya,
      whatsappE164: seed.phone,
      onboardedAt: now - (60 + index * 5) * DAY_MS,
      language: index === 1 ? "fr" : "ar",
    });
    userIds.push(userId);

    const instructorId = await ctx.db.insert("instructors", {
      userId,
      name: seed.name,
      bio: seed.bio,
      experience: seed.experience,
      proofLinks: seed.proof,
      contactE164: seed.phone,
      wilaya: seed.wilaya,
      socialLinks: seed.socials,
      status: "approved",
      decidedAt: now - 30 * DAY_MS,
      createdAt: now - (55 + index * 5) * DAY_MS,
      updatedAt: now - 30 * DAY_MS,
    });
    instructorIds.push(instructorId);
  }

  /** Every field is explicit so the optional `wilaya` stays optional. */
  type SeedCourse = {
    instructor: number;
    title: string;
    description: string;
    topics: string[];
    level: "beginner" | "intermediate" | "advanced";
    language: "ar" | "fr" | "both";
    format: "live" | "recorded" | "in_person";
    wilaya?: number;
    duration: number;
    price: number;
    seats: number;
    curriculum: string[];
  };

  const COURSES: SeedCourse[] = [
    {
      instructor: 0,
      title: "دروبشيبينغ من الصفر حتى أول 100 طلب",
      description:
        "دورة عملية كاملة: اختيار المنتج الرابح، تجهيز المتجر، أول إعلان، ومعالجة الطلبات حتى توصلك الأرباح. كل محاضرة مصحوبة بقالب جاهز تنزّله وتخدم بيه.",
      topics: ["topicDropshipping", "topicStore"],
      level: "beginner" as const,
      language: "both" as const,
      format: "recorded" as const,
      duration: 8,
      price: 4500,
      seats: 200,
      curriculum: [
        "اختيار المنتج: المعايير الستة قبل ما تشري",
        "تجهيز المتجر والدفع عند التسليم",
        "أول إعلان: الميزانية والإبداع",
        "التعامل مع الطلبات والمرتجعات",
        "قياس النتائج وتحسين الحملة",
      ],
    },
    {
      instructor: 0,
      title: "إعلانات فيسبوك للمتاجر الجزائرية",
      description:
        "من إنشاء مدير الأعمال حتى تحسين الحملات: الجمهور، الميزانية، قراءة الأرقام، وكيفاش تقلّل ثمن الطلب بدون ما تخسر الجودة.",
      topics: ["topicFacebook", "topicAds"],
      level: "intermediate" as const,
      language: "ar" as const,
      format: "live" as const,
      duration: 6,
      price: 6500,
      seats: 40,
      curriculum: [
        "مدير الأعمال والحساب الإعلاني الخطوات كاملة",
        "اختبار الجمهور والاهتمامات",
        "قراءة CPM و CPC و ROAS",
        "إعادة الاستهداف للسلات المتروكة",
      ],
    },
    {
      instructor: 1,
      title: "تيك توك أورغانيك: من 0 إلى 10 آلاف متابع",
      description:
        "طريقة بناء حساب يبيع فعلاً: الفكرة، أول 3 ثواني، جدول النشر، وتحويل المتابعين لطلبات بدون إعلانات مدفوعة.",
      topics: ["topicTiktok"],
      level: "beginner" as const,
      language: "ar" as const,
      format: "recorded" as const,
      duration: 5,
      price: 3500,
      seats: 300,
      curriculum: [
        "اختيار المجال اللي يخدم في الجزائر",
        "بنية الفيديو الرابح",
        "جدول النشر والتحليل",
        "من الفيديو للطلب: متجر ولا واتساب؟",
      ],
    },
    {
      instructor: 1,
      title: "بناء متجر احترافي على شوبيفاي",
      description:
        "من فتح الحساب حتى أول عملية بيع: الثيم، الصفحات الأساسية، بوابات الدفع المتوفرة في الجزائر، وسرعة المتجر على الهاتف.",
      topics: ["topicStore", "topicLogistics"],
      level: "intermediate" as const,
      language: "both" as const,
      format: "recorded" as const,
      duration: 10,
      price: 8000,
      seats: 150,
      curriculum: [
        "فتح المتجر وربط الدومين",
        "الثيم والصفحات اللي لازم تكون",
        "الدفع عند التسليم والتحصيل",
        "تحسين السرعة على الهاتف",
        "التطبيقات اللي تستاهل تجربتها",
      ],
    },
    {
      instructor: 2,
      title: "التوريد من الصين والجزائر بلا وسيط",
      description:
        "كيفاش تشري بالكمية المناسبة، تقارن الموردين، تفاوض على الثمن، وتحسب تكلفة الشحن الحقيقية قبل ما تدفع دينار واحد.",
      topics: ["topicSourcing", "topicLogistics"],
      level: "advanced" as const,
      language: "ar" as const,
      format: "live" as const,
      duration: 7,
      price: 9500,
      seats: 30,
      curriculum: [
        "قراءة منصات التوريد واختيار المورد",
        "التفاوض والعينات",
        "حساب الشحن والجمارك",
        "الدفع الآمن والضمانات",
      ],
    },
    {
      instructor: 2,
      title: "ورشة حضورية: اللوجستيك مع شركات التوصيل",
      description:
        "ورشة حضورية في قسنطينة: تجهيز الطرد، التعامل مع المرتجعات، وأسعار التوصيل وأخطاء تكلّف التجار كل شهر.",
      topics: ["topicLogistics"],
      level: "beginner" as const,
      language: "ar" as const,
      format: "in_person" as const,
      wilaya: 25,
      duration: 4,
      price: 2500,
      seats: 25,
      curriculum: [
        "تجهيز الطرد والتغليف",
        "المرتجعات: من يدفع؟",
        "التسعير والتفاوض مع شركة التوصيل",
      ],
    },
    {
      instructor: 0,
      title: "حوّل متابعينك لمشترين",
      description:
        "جلسة مباشرة على المحتوى اللي يبيع: بناء العروض، نداءات الفعل، والردود الجاهزة على اعتراضات المشترين الجزائريين.",
      topics: ["topicAds", "topicOther"],
      level: "intermediate" as const,
      language: "both" as const,
      format: "live" as const,
      duration: 6,
      price: 5500,
      seats: 60,
      curriculum: [
        "العرض اللي يبيع في الجزائر",
        "نداء الفعل والاستعجال الأخلاقي",
        "الردود على الاعتراضات",
      ],
    },
    {
      instructor: 1,
      title: "ورشة حضورية: تصوير المنتجات بالموبايل",
      description:
        "ورشة في وهران: الإضاءة، الخلفيات، والتعديل السريع بالموبايل حتى تطلع الصور اللي تزيد المبيعات.",
      topics: ["topicOther", "topicStore"],
      level: "beginner" as const,
      language: "both" as const,
      format: "in_person" as const,
      wilaya: 31,
      duration: 3,
      price: 3000,
      seats: 20,
      curriculum: [
        "إضاءة بسيطة بلا استوديو",
        "الخلفيات والحوامل",
        "تعديل الصور بالتطبيقات",
      ],
    },
  ];

  const courseIds: Id<"courses">[] = [];
  for (const [index, seed] of COURSES.entries()) {
    const instructorId = instructorIds[seed.instructor];
    const instructor = INSTRUCTORS[seed.instructor];
    const createdAt = now - (40 - index * 3) * DAY_MS;
    const courseId = await ctx.db.insert("courses", {
      instructorId,
      ownerId: userIds[seed.instructor],
      title: seed.title,
      description: seed.description,
      topics: seed.topics,
      level: seed.level,
      language: seed.language,
      format: seed.format,
      wilaya: seed.wilaya,
      durationHours: seed.duration,
      priceDa: seed.price,
      startsAt: now + (7 + index * 2) * DAY_MS,
      seats: seed.seats,
      curriculum: seed.curriculum,
      externalContact: `واتساب: ${instructor.phone}`,
      status: "active",
      viewCount: 40 + index * 17,
      ratingCount: 0,
      ratingSum: 0,
      createdAt,
      updatedAt: createdAt,
    });
    courseIds.push(courseId);
  }

  // ---- enrollment codes for the first course
  const codeRows: {
    code: string;
    maxUses: number;
    uses: number;
    revokedAt?: number;
  }[] = [
    { code: "DEMO-0001", maxUses: 1, uses: 1 },
    { code: "DEMO-0002", maxUses: 5, uses: 2 },
    { code: "DEMO-0003", maxUses: 10, uses: 0, revokedAt: now - 2 * DAY_MS },
  ];
  const codeIds: Id<"enrollmentCodes">[] = [];
  for (const [index, row] of codeRows.entries()) {
    const codeId = await ctx.db.insert("enrollmentCodes", {
      courseId: courseIds[0],
      instructorId: instructorIds[0],
      code: row.code,
      maxUses: row.maxUses,
      uses: row.uses,
      expiresAt: now + (60 - index * 10) * DAY_MS,
      label: index === 0 ? "مريم — دفعت 4500 دج" : undefined,
      revokedAt: row.revokedAt,
      createdBy: userIds[0],
      createdAt: now - (20 - index) * DAY_MS,
    });
    codeIds.push(codeId);
  }

  // ---- two students, so reviews and materials have a real audience
  const enrollmentIds: Id<"enrollments">[] = [];
  const reviewIds: Id<"courseReviews">[] = [];
  const STUDENTS = [
    { email: "student1@tajirdz.demo", name: "مريم زروقي", wilaya: 16, course: 0, code: 0, rating: 5, comment: "أحسن 4500 دج صرفتهم. القوالب وحدهم يستحقو الثمن، وأول حملة جابت لي 9 طلبات." },
    { email: "student2@tajirdz.demo", name: "Karim H.", wilaya: 31, course: 2, code: 1, rating: 4, comment: "المحتوى واضح والمدربة صبورة. كنت حاب ندير أكثر على التعديل، لكن النتيجة بانت في أسبوع." },
  ];
  for (const student of STUDENTS) {
    const userId = await ctx.db.insert("users", {
      name: student.name,
      email: student.email,
      role: "retailer",
      wilaya: student.wilaya,
      onboardedAt: now - 25 * DAY_MS,
      language: student.email.endsWith("1@tajirdz.demo") ? "ar" : "fr",
    });
    userIds.push(userId);

    enrollmentIds.push(
      await ctx.db.insert("enrollments", {
        userId,
        courseId: courseIds[student.course],
        instructorId: instructorIds[COURSES[student.course].instructor],
        codeId: codeIds[student.code],
        createdAt: now - (12 - student.course) * DAY_MS,
      }),
    );

    reviewIds.push(
      await ctx.db.insert("courseReviews", {
        courseId: courseIds[student.course],
        userId,
        instructorId: instructorIds[COURSES[student.course].instructor],
        rating: student.rating,
        comment: student.comment,
        status: "visible",
        createdAt: now - 3 * DAY_MS,
      }),
    );

    // The denormalised rating on the course row is what the list sorts on.
    await ctx.db.patch(courseIds[student.course], {
      ratingCount: 1,
      ratingSum: student.rating,
    });
  }

  // ---- private materials and one announcement, so the enrolled view is not empty
  const materialRows = [
    { title: "قوالب اختيار المنتج (Google Sheets)", link: "https://docs.google.com/spreadsheets/d/demo-template", note: "انسخو عندك قبل ما تبدل." },
    { title: "ملف الإعلانات الجاهز", link: "https://drive.google.com/demo-ads-file", note: "فيه 12 إعلان مع النصوص والصور." },
  ];
  for (const [index, row] of materialRows.entries()) {
    await ctx.db.insert("courseMaterials", {
      courseId: courseIds[0],
      instructorId: instructorIds[0],
      title: row.title,
      link: row.link,
      note: row.note,
      createdAt: now - (10 - index) * DAY_MS,
    });
  }

  await ctx.db.insert("courseAnnouncements", {
    courseId: courseIds[0],
    instructorId: instructorIds[0],
    title: "الحصة المباشرة يوم السبت",
    body: "غادي نديرو جلسة مباشرة السبت على 20:00 لمراجعة حملاتكم. حطو أسئلتكم هنا قبل.",
    createdAt: now - 2 * DAY_MS,
  });

  return {
    ids: [
      ...userIds.map(String),
      ...instructorIds.map(String),
      ...courseIds.map(String),
      ...codeIds.map(String),
      ...enrollmentIds.map(String),
      ...reviewIds.map(String),
    ],
    courseIds,
    instructorIds,
  };
}

export const seedStatus = query({
  args: {},
  handler: async (ctx) => {
    const flag = await ctx.db
      .query("demoFlags")
      .withIndex("by_scope", (q) => q.eq("scope", DEMO_SCOPE))
      .first();
    const users = await ctx.db.query("users").collect();
    const products = await ctx.db.query("products").collect();
    const shops = await ctx.db.query("shops").collect();
    return {
      seeded: flag !== null,
      seededAt: flag?._creationTime ?? null,
      users: users.length,
      shops: shops.length,
      products: products.length,
    };
  },
});

/**
 * Write the demo marketplace. Development only.
 *
 * The literal `"seed-demo-data"` argument is the explicit flag: a bare call —
 * including one from a stray script — cannot run it by accident, and production
 * is never seeded because the deploy pipeline does not pass the flag. The
 * caller still has to be an admin, so an ordinary account cannot flood the
 * platform with fake shops either.
 *
 *   npx convex run seed:seedDemoData '{"confirm":"seed-demo-data"}'
 */
export const seedDemoData = mutation({
  args: { confirm: v.literal("seed-demo-data") },
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const existing = await ctx.db
      .query("demoFlags")
      .withIndex("by_scope", (q) => q.eq("scope", DEMO_SCOPE))
      .first();
    if (existing) {
      return { seeded: false, reason: "already_seeded" as const };
    }

    const random = makeRandom(20260904);
    const now = Date.now();
    const createdUserIds: Id<"users">[] = [];
    const createdShopIds: Id<"shops">[] = [];
    const createdProductIds: Id<"products">[] = [];

    // ---- promo code the landing page advertises
    const promoExists = await ctx.db
      .query("promoCodes")
      .withIndex("by_code", (q) => q.eq("code", "TAJIR-FREE"))
      .first();
    if (!promoExists) {
      await ctx.db.insert("promoCodes", {
        code: "TAJIR-FREE",
        kind: "free_days",
        freeDays: 30,
        maxUses: 10,
        audience: "both",
        isActive: true,
        createdAt: now,
      });
    }

    // ---- wholesalers
    for (const [index, seed] of SHOPS.entries()) {
      const email = `wholesale${index + 1}@tajirdz.demo`;
      const userId = await ctx.db.insert("users", {
        name: seed.owner,
        email,
        role: "wholesaler",
        wilaya: seed.wilaya,
        commune: seed.commune,
        whatsappE164: seed.phone,
        ownerName: seed.owner,
        onboardedAt: now - (120 - index * 4) * DAY_MS,
        language: index % 4 === 3 ? "fr" : "ar",
      });
      createdUserIds.push(userId);

      const shopId = await ctx.db.insert("shops", {
        ownerId: userId,
        name: fixText(seed.shop).trim(),
        slug: `${slugify(fixText(seed.shop).trim())}-${index + 1}`,
        wilaya: seed.wilaya,
        commune: seed.commune,
        whatsappE164: seed.phone,
        rcNumber: seed.verified ? `RC-${16 + index}/2021` : undefined,
        categories: seed.categories,
        deliveryOptions: ["pickup", "yalidine", "own"],
        avgPrepDays: seed.prepDays,
        verification: seed.verified ? "approved" : "none",
        verifiedAt: seed.verified ? now - (90 - index * 3) * DAY_MS : undefined,
        isActive: true,
        responseRate: Math.round((0.65 + random() * 0.33) * 100) / 100,
        medianResponseMinutes: 15 + Math.floor(random() * 240),
        createdAt: now - (120 - index * 4) * DAY_MS,
      });
      createdShopIds.push(shopId);

      // Every seeded shop except the free-plan one is subscribed, which is what
      // keeps their products visible in the public feed.
      if (seed.plan !== "free") {
        await ctx.db.insert("subscriptions", {
          ownerId: userId,
          shopId,
          audience: "wholesaler",
          plan: seed.plan,
          status: "active",
          startedAt: now - 60 * DAY_MS,
          expiresAt: now + 27 * DAY_MS,
        });
      }
    }

    // ---- products
    let productIndex = 0;
    for (const [shopIndex, shopId] of createdShopIds.entries()) {
      const seedShop = SHOPS[shopIndex];
      for (const category of seedShop.categories) {
        const items = CATALOGUE[category] ?? [];
        // Each shop lists a slice of its category, not the whole catalogue.
        const slice = items.slice(0, Math.min(items.length, 4 + Math.floor(random() * 3)));
        for (const item of slice) {
          const minQty = MIN_QTY_OPTIONS[Math.floor(random() * MIN_QTY_OPTIONS.length)];
          const basePrice = item.price;
          // Quantity tiers: deeper discounts as the order grows.
          const priceTiers = [
            { minQty: minQty * 2, priceDa: Math.round(basePrice * 0.92) },
            { minQty: minQty * 5, priceDa: Math.round(basePrice * 0.85) },
          ].filter((t) => t.priceDa < basePrice);

          const createdAt = now - Math.floor(random() * 60) * DAY_MS;
          const productId = await ctx.db.insert("products", {
            shopId,
            ownerId: createdUserIds[shopIndex],
            name: item.name,
            slug: `${slugify(item.name)}-${productIndex + 1}`,
            category: item.category,
            description: fixText(item.desc),
            wholesalePriceDa: basePrice,
            minQty,
            priceTiers,
            stockStatus: random() > 0.85 ? "low" : random() > 0.95 ? "out" : "in_stock",
            prepDays: seedShop.prepDays,
            tags: item.tags.map(fixText),
            imageStorageIds: [],
            isPaused: false,
            reviewCount: 0,
            avgProductRating: 0,
            avgSellerRating: 0,
            wilsonScore: 0,
            isWinning: false,
            viewCount: 40 + Math.floor(random() * 900),
            favoriteCount: Math.floor(random() * 60),
            contactCount: Math.floor(random() * 40),
            createdAt,
            updatedAt: createdAt,
          });
          createdProductIds.push(productId);
          productIndex++;
        }
      }
    }

    // ---- daily stats for the trending row and wholesaler charts
    for (const productId of createdProductIds) {
      for (let day = 6; day >= 0; day--) {
        const date = new Date(now - day * DAY_MS).toISOString().slice(0, 10);
        await ctx.db.insert("productDailyStats", {
          productId,
          day: date,
          views: Math.floor(random() * 45),
          favorites: Math.floor(random() * 6),
          contactClicks: Math.floor(random() * 9),
        });
      }
    }

    // ---- retailers
    const retailerIds: Id<"users">[] = [];
    for (const [index, seed] of RETAILERS.entries()) {
      const userId = await ctx.db.insert("users", {
        name: fixText(seed.name).trim(),
        email: `retailer${index + 1}@tajirdz.demo`,
        role: "retailer",
        wilaya: seed.wilaya,
        whatsappE164: seed.phone,
        storeType: seed.storeType,
        niches: ["fashion", "home"],
        onboardedAt: now - (60 - index * 5) * DAY_MS,
        language: "ar",
      });
      retailerIds.push(userId);
      createdUserIds.push(userId);

      // Retailers are subscribed so they can see phone numbers and contact.
      await ctx.db.insert("subscriptions", {
        ownerId: userId,
        audience: "retailer",
        plan: "free",
        status: "active",
        startedAt: now - 30 * DAY_MS,
        expiresAt: now + 20 * DAY_MS,
      });
    }

    // ---- contact history + reviews
    // A review only exists where a contact log for that exact product does,
    // which is precisely the invariant the live review mutation enforces.
    //
    // The winning badge needs at least 5 reviews from *distinct* retailers
    // (one review per retailer per product), so the first products are
    // reviewed by the whole retailer pool and the rest by a subset.
    const REVIEW_TARGETS = createdProductIds.slice(0, 40);
    for (const [i, productId] of REVIEW_TARGETS.entries()) {
      const product = await ctx.db.get(productId);
      if (!product) continue;

      // Front-load products: the first 12 get the full pool of 5 reviewers so
      // they clear the >=5 review / >4.5 average winning rule; later products
      // get fewer, which keeps the badge selective rather than universal.
      const isFeatured = i < 12;
      const reviewerCount = isFeatured ? RETAILER_POOL_SIZE : 1 + Math.floor(random() * 3);

      for (let r = 0; r < reviewerCount; r++) {
        const reviewer = retailerIds[(i + r) % retailerIds.length];
        // Spread contacts over the last 20 days so the 48h rule is satisfied.
        const contactedAt = now - (3 + Math.floor(random() * 17)) * DAY_MS;

        await ctx.db.insert("contactLogs", {
          retailerId: reviewer,
          shopId: product.shopId,
          productId,
          channel: (i + r) % 3 === 0 ? "chat" : "whatsapp",
          createdAt: contactedAt,
        });

        await ctx.db.patch(product._id, {
          contactCount: product.contactCount + 1,
        });

        // Featured products get near-perfect ratings; the rest vary, and a
        // minority earn no review at all.
        if (!isFeatured && random() < 0.35) continue;

        const productRating = isFeatured
          ? random() < 0.8
            ? 5
            : 4
          : random() < 0.6
            ? 5
            : random() < 0.7
              ? 4
              : 3;
        const sellerRating = productRating === 3 ? 4 : 5;

        await ctx.db.insert("reviews", {
          productId,
          shopId: product.shopId,
          retailerId: reviewer,
          productRating,
          sellerRating,
          comment:
            random() < 0.85
              ? fixText(REVIEW_COMMENTS[Math.floor(random() * REVIEW_COMMENTS.length)])
              : undefined,
          claimedPurchase: random() < 0.7,
          verifiedContact: true,
          status: "visible",
          createdAt: contactedAt + 2 * DAY_MS,
        });
      }
    }

    // ---- recompute aggregates so badges and ratings match the reviews
    for (const productId of createdProductIds) {
      const reviews = await ctx.db
        .query("reviews")
        .withIndex("by_product", (q) => q.eq("productId", productId))
        .collect();
      const visible = reviews.filter((r) => r.status === "visible");
      const winning = computeWinning(visible.map((r) => r.productRating));
      const sellerAvg = visible.length
        ? visible.reduce((a, r) => a + r.sellerRating, 0) / visible.length
        : 0;
      await ctx.db.patch(productId, {
        reviewCount: visible.length,
        avgProductRating: winning.avg,
        avgSellerRating: sellerAvg,
        wilsonScore: winning.score,
        isWinning: winning.isWinning,
      });
    }

    // ---- shop rating summaries
    for (const shopId of createdShopIds) {
      const reviews = await ctx.db
        .query("reviews")
        .withIndex("by_shop", (q) => q.eq("shopId", shopId))
        .collect();
      const visible = reviews.filter((r) => r.status === "visible");
      const productAvg = visible.length
        ? visible.reduce((a, r) => a + r.productRating, 0) / visible.length
        : 0;
      const sellerAvg = visible.length
        ? visible.reduce((a, r) => a + r.sellerRating, 0) / visible.length
        : 0;
      await ctx.db.patch(shopId, {
        ratingSummary: {
          overall: Math.round(productAvg * 100) / 100,
          productAvg: Math.round(productAvg * 100) / 100,
          sellerAvg: Math.round(sellerAvg * 100) / 100,
          count: visible.length,
        },
      });
    }

    // ---- quote requests
    const QUOTES = [
      { productName: "سماعات بلوتوث لاسلكية", category: "electronics", quantity: 200, wilaya: 16, target: 1100 },
      { productName: "فستان صيفي نسائي", category: "fashion", quantity: 300, wilaya: 19, target: 650 },
      { productName: "عطر شرقي رجالي", category: "beauty", quantity: 100, wilaya: 31, target: 2400 },
      { productName: "زيت زيتون بكر 1 لتر", category: "groceries", quantity: 500, wilaya: 25, target: 1050 },
      { productName: "طقم قدور ضغط", category: "home", quantity: 50, wilaya: 6, target: 5000 },
      { productName: "غسيل سيارات بالطراز", category: "auto", quantity: 400, wilaya: 19, target: 650 },
    ];
    for (const [i, q] of QUOTES.entries()) {
      await ctx.db.insert("quoteRequests", {
        retailerId: retailerIds[i % retailerIds.length],
        productName: q.productName,
        category: q.category,
        quantity: q.quantity,
        targetPriceDa: q.target,
        wilaya: q.wilaya,
        note: "نحتاج كمية ثابتة كل أسبوع، التوصيل عبر ياليدين.",
        status: "open",
        searchBlob: "",
        createdAt: now - i * DAY_MS,
        expiresAt: now + (7 - i) * DAY_MS,
      });
    }

    // ---- a couple of seller replies so the review inbox is not empty
    const someReviews = await ctx.db.query("reviews").take(6);
    for (const review of someReviews.slice(0, 3)) {
      await ctx.db.patch(review._id, {
        reply: "شكراً على التقييم، نتمنى نواصل الخدمة والكمية متوفرة دائماً.",
        repliedAt: now - 2 * DAY_MS,
      });
    }

    // ---- courses: verified instructors, their courses, codes and students
    const courses = await seedCourses(ctx, now);

    await ctx.db.insert("demoFlags", {
      scope: DEMO_SCOPE,
      ids: [
        ...createdUserIds.map(String),
        ...createdShopIds.map(String),
        ...createdProductIds.map(String),
        ...courses.ids,
      ],
    });

    return {
      seeded: true,
      wholesalers: SHOPS.length,
      retailers: RETAILERS.length,
      products: createdProductIds.length,
      quotes: QUOTES.length,
      instructors: courses.instructorIds.length,
      courses: courses.courseIds.length,
    };
  },
});

/**
 * Remove every seeded row so the database can start clean.
 *
 * Scoped strictly to what `seedDemoData` recorded in the `demoFlags` row: the
 * root ids it wrote (users, shops, products, courses and their children) plus
 * anything whose foreign key points at one of those roots. A real account that
 * registered afterwards is never touched, even if it happens to sit in a table
 * the seeder also filled.
 *
 * Deleting the flag row is the last step and is what makes the run
 * idempotent-by-refusal: with no flag left there is nothing to prove the data
 * came from the seeder, so a second run fails loudly rather than silently
 * wiping whatever real merchants have published since.
 *
 *   npx convex run seed:removeDemoData --prod
 */
export const removeDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const flag = await ctx.db
      .query("demoFlags")
      .withIndex("by_scope", (q) => q.eq("scope", DEMO_SCOPE))
      .first();

    // No flag: either never seeded, or already cleaned. Both mean "stop",
    // and saying so beats deleting rows nobody can attribute.
    if (!flag) {
      throw new Error("errDemoDataAlreadyRemoved");
    }

    const demoIds = new Set(flag.ids);
    const isDemo = (id: unknown) => demoIds.has(String(id));

    let removed = 0;

    // ---- children first, so a root never goes while a row still points at it.
    // Every branch filters on the flagged roots; nothing unconditional.
    const drop = async (id: Id<never> | string) => {
      await ctx.db.delete(id as never);
      removed++;
    };

    for (const row of await ctx.db.query("reviews").collect()) {
      if (isDemo(row.productId) || isDemo(row.shopId) || isDemo(row.retailerId)) {
        await drop(row._id);
      }
    }
    for (const row of await ctx.db.query("contactLogs").collect()) {
      if (isDemo(row.retailerId) || isDemo(row.shopId) || (row.productId && isDemo(row.productId))) {
        await drop(row._id);
      }
    }
    for (const row of await ctx.db.query("productDailyStats").collect()) {
      if (isDemo(row.productId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("favorites").collect()) {
      if (isDemo(row.productId) || isDemo(row.userId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("quoteRequests").collect()) {
      if (isDemo(row.retailerId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("quoteOffers").collect()) {
      if (isDemo(row.shopId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("messages").collect()) {
      if (isDemo(row.senderId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("chatThreads").collect()) {
      if (isDemo(row.retailerId) || isDemo(row.shopId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("notifications").collect()) {
      if (isDemo(row.userId)) await drop(row._id);
    }
    // A subscription with no shop belongs to a demo retailer account.
    for (const row of await ctx.db.query("subscriptions").collect()) {
      if (isDemo(row.ownerId) || (row.shopId && isDemo(row.shopId))) await drop(row._id);
    }

    // ---- courses: children before the instructors and accounts beneath them.
    const demoInstructorIds = new Set<string>();
    for (const row of await ctx.db.query("instructors").collect()) {
      if (isDemo(row.userId)) demoInstructorIds.add(String(row._id));
    }
    const demoCourseIds = new Set<string>();
    for (const row of await ctx.db.query("courses").collect()) {
      if (demoInstructorIds.has(String(row.instructorId))) {
        demoCourseIds.add(String(row._id));
      }
    }
    const isDemoCourse = (id: unknown) => demoCourseIds.has(String(id));

    for (const row of await ctx.db.query("enrollments").collect()) {
      if (isDemoCourse(row.courseId) || isDemo(row.userId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("enrollmentCodes").collect()) {
      if (demoInstructorIds.has(String(row.instructorId))) await drop(row._id);
    }
    for (const table of [
      "courseMaterials",
      "courseAnnouncements",
      "courseReviews",
    ] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        if (isDemoCourse(row.courseId)) await drop(row._id);
      }
    }
    for (const row of await ctx.db.query("courseComplaints").collect()) {
      if (
        (row.courseId && isDemoCourse(row.courseId)) ||
        (row.instructorId && demoInstructorIds.has(String(row.instructorId)))
      ) {
        await drop(row._id);
      }
    }
    for (const row of await ctx.db.query("courseAcknowledgements").collect()) {
      if (isDemo(row.userId)) await drop(row._id);
    }
    for (const row of await ctx.db.query("courses").collect()) {
      if (isDemoCourse(row._id)) await drop(row._id);
    }
    for (const row of await ctx.db.query("instructors").collect()) {
      if (demoInstructorIds.has(String(row._id))) await drop(row._id);
    }

    // ---- roots last.
    for (const row of await ctx.db.query("products").collect()) {
      if (isDemo(row._id)) await drop(row._id);
    }
    for (const row of await ctx.db.query("shops").collect()) {
      if (isDemo(row._id)) await drop(row._id);
    }
    for (const row of await ctx.db.query("users").collect()) {
      if (isDemo(row._id)) await drop(row._id);
    }

    await ctx.db.delete(flag._id);
    return { removed: true, rowsDeleted: removed, alreadyRemoved: false };
  },
});

/**
 * Optional dev helper: report who the ADMIN_EMAILS allowlist will promote.
 *
 * Admin access does not depend on this — `syncAdminRole` in lib/access.ts
 * promotes an allowlisted address on its first authenticated call, but only
 * once the email has been verified by code, so nobody can claim the admin
 * address by registering it without owning the inbox. This action just reports
 * the configured list so a deploy can be checked without signing in.
 */
export const ensureAdmin = action({
  args: {},
  // Explicit return type: inferred types here would reference this module's
  // own exports and fail to compile.
  handler: async (): Promise<{
    emails: string[];
    configured: boolean;
    note: string;
  }> => {
    const emails = [...adminEmails()].sort();
    if (emails.length === 0) {
      return {
        emails,
        configured: false,
        note:
          "ADMIN_EMAILS is not set. Run: npx convex env set ADMIN_EMAILS you@example.com",
      };
    }
    return {
      emails,
      configured: true,
      note:
        "These addresses are promoted to admin on their first signed-in call " +
        "AFTER confirming the email code. No seeded account is required.",
    };
  },
});

export { CATEGORIES, DELIVERY_OPTIONS };
export type { Doc };