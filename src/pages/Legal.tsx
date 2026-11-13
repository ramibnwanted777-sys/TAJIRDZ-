/**
 * Legal and support content, bilingual. Bilingual copy lives here so a page
 * renders fully in whichever language is active.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";

type Page = "how" | "faq" | "terms" | "privacy" | "refund" | "scam" | "contact";

type Copy = { title: string; intro: string; sections: { heading: string; body: string }[] };

const CONTENT: Record<Page, Record<"ar" | "fr", Copy>> = {
  how: {
    ar: {
      title: "كيفاش يخدم TajirDz",
      intro:
        "TajirDz منصة كيربط بين تجار الجملة والبائعين الأونلاين. هو كيربط و يسهّل التواصل، أما البيع والدفع يتم مباشرة بين الطرفين.",
      sections: [
        {
          heading: "1. التاجر يسجّل ويعرض منتجاته",
          body: "يسجل اسم المحل، الولاية، رقم واتساب، الفئات و طرق التوصيل. يرفع products بالصور و ثمن الجملة و الحد الأدنى للكمية.",
        },
        {
          heading: "2. توثيق المحل",
          body: "التاجر يرفع السجل التجاري، الإدارة تأكد، و من وقتها يولي يلقى الشارة الخضراء على productsو البروفايل.",
        },
        {
          heading: "3. البائع يبحث و يقارن",
          body: "البائع يقدر يفلتر بالولاية، الفئة، السعر، الكمية الدنيا، التقييم، و ك possible la mise en avant غير المنتجات الرابحة ولا التجار الموثّقين.",
        },
        {
          heading: "4. التواصل",
          body: "البائع المدفوع يوصل لرقم واتساب التاجر (ب رسالة جاهزة فيها اسم المنتج) ولا يفتح محادثة داخل التطبيق.",
        },
        {
          heading: "5. التقييم",
          body: "بعد 48 ساعة من التواصل، البائع يقدر يقيّم المنتج و التاجر — مرة وحدة على كل منتج.",
        },
      ],
    },
    fr: {
      title: "Comment ça marche",
      intro:
        "TajirDz met en relation les grossistes et les revendeurs en ligne. Nous ne nous intermédions pas dans la vente ni dans le paiement.",
      sections: [
        {
          heading: "1. Le grossiste s'inscrit",
          body: "Il renseigne sa boutique, sa wilaya, son WhatsApp, ses catégories et ses modes de livraison, puis publie ses produits avec photos, prix de gros et quantités minimum.",
        },
        {
          heading: "2. Vérification de la boutique",
          body: "Le grossiste transmet son registre de commerce. Après validation, le badge vert apparaît sur ses produits et son profil.",
        },
        {
          heading: "3. L'acheteur recherche",
          body: "Filtres par wilaya, catégorie, prix, quantité minimum, note, et options « produits gagnants » ou « vendeurs vérifiés ».",
        },
        {
          heading: "4. Contact",
          body: "Un acheteur abonné accède au WhatsApp du grossiste (message pré-rempli avec le produit) ou discute dans l'application.",
        },
        {
          heading: "5. Avis",
          body: "48 h après le contact, l'acheteur peut noter le produit et le vendeur — une seule fois par produit.",
        },
      ],
    },
  },
  faq: {
    ar: {
      title: "أسئلة شائعة",
      intro: "أهم الأسئلة اللي كيتسالوا علينا.",
      sections: [
        {
          heading: "واش كتديرو البيع و الدفع؟",
          body: "لا. TajirDz كيربط فقط. البيع و الدفع و التوصيل كيديرو التاجر و المشتري مباشرة بينهم.",
        },
        {
          heading: "كيفاش نعرف بلي التقييم ما يمكن يتزور؟",
          body: "ما يمكن حتى بائع يقيّم إلا كان قد تواصل مع التاجر على هاد المنتج بالضبط، و بعد 48 ساعة، و مرة وحدة. كل نقررة تواصل مسجلة في النظام.",
        },
        {
          heading: "علاش ما نلقاش رقم التاجر؟",
          body: "أرقام التجار مخبية على البائعين غير المسجلين باش ما يصيرش نشر الأرقام. البائع اللي عندو اشتراك بريتايلر (500 دج/شهر) يقدر يوصل ليهم كاملين.",
        },
        {
          heading: "كيفاش نعرف بلي المنتج رابح؟",
          body: "الشارة محسوبة بطريقة Wilson: على الأقل 5 تقييمات، معدل فوق 4.5، و ثقة إحصائية كافية. منتج بـ 5 نجوم وحدة ما countedاش رابح.",
        },
        {
          heading: "واش كاين اشتراك؟",
          body: "نعم. التاجر: أساسي 1000 دج/شهر (30 منتج)، احترافي 2500 دج/شهر (غير محدود). البائع: 500 دج/شهر باش يوصل للتجار.",
        },
        {
          heading: "واش نقدر نلغي في أي وقت؟",
          body: "نعم. من صفحة الاشتراك. كاين 3 أيام سماح بعد تاريخ الانتهاء باش ما تتقطعش الخدمة في نص الليل.",
        },
      ],
    },
    fr: {
      title: "Questions fréquentes",
      intro: "Les questions les plus posées.",
      sections: [
        {
          heading: "Gérez-vous la vente et le paiement ?",
          body: "Non. TajirDz met en relation. La vente, le paiement et la livraison se font directement entre le grossiste et l'acheteur.",
        },
        {
          heading: "Comment savoir qu'un avis est authentique ?",
          body: "Un avis n'est possible qu'après un contact enregistré sur ce produit précis, 48 h plus tard, et une seule fois.",
        },
        {
          heading: "Pourquoi je ne vois pas le numéro du vendeur ?",
          body: "Les numéros sont masqués pour décourager les arnaques. Un abonné revendeur (500 DA/mois) y accède intégralement.",
        },
        {
          heading: "Comment un produit est-il « gagnant » ?",
          body: "Score de Wilson : au moins 5 avis, moyenne supérieure à 4,5 et une confiance statistique suffisante. Un seul avis 5 étoiles ne suffit pas.",
        },
        {
          heading: "Y a-t-il un abonnement ?",
          body: "Oui. Grossiste : Basique 1 000 DA/mois (30 produits), Pro 2 500 DA/mois (illimité). Revendeur : 500 DA/mois pour contacter les grossistes.",
        },
        {
          heading: "Puis-je annuler à tout moment ?",
          body: "Oui, depuis la page d'abonnement. Vous disposez de 3 jours de grâce après expiration.",
        },
      ],
    },
  },
  terms: {
    ar: {
      title: "شروط الاستعمال",
      intro:
        "باستعمال TajirDz، أنت توافق على هاد الشروط. TajirDz منصة تعارف و تسويق، ماشي طرف في البيع.",
      sections: [
        {
          heading: "الدور ديال TajirDz",
          body: "TajirDz يعرّف بالمنتجات و التجار و يسهّل الاتصال. البيع و الدفع و التوصيل و حل الخلافات تجري بين المشتري و البائع.",
        },
        {
          heading: "التزامات البائع",
          body: "البائع مسؤول على دقة المنتجات و الصور و ثمن الجملة، و على احترام قانون حماية المستهلك.",
        },
        {
          heading: "التزامات المشتري",
          body: "المشتري ما يستعملش المنصة للتلاعب، و ما يرسلش روابط ولا أرقام هواتف في المحادثات العامة.",
        },
        {
          heading: "التقييمات",
          body: "التقييم لازم يكون حقيقي. التقييم المصطنع كيتحذف و كيتوقف الحساب.",
        },
        {
          heading: "المسؤولية",
          body: "المنصة ما تتحملش مسؤولية عن جودة البضاعة ولا عن الطرفين. خاصك تتحقق قبل ما تدفع.",
        },
        {
          heading: "بنود خدمة VIP",
          body: "خدمة VIP خدمة تعارف: نعرض وصف عام بلا سعر ولا صور حقيقية، وبعد موافقة الموزع يتواصل الطرفان مباشرة خارج TajirDz. الاتفاق والدفع بينك وبين الموزع، وTajirDz ما يستلمش أموالاً وما يضمنش الصفقة، لكنه يستقبل الشكاوى ويغلق حسابات المخالفين. 3 شكاوى مختلفة على عرض VIP كتوقف تلقائياً حتى مراجعة الإدارة.",
        },
      ],
    },
    fr: {
      title: "Conditions d'utilisation",
      intro:
        "En utilisant TajirDz, vous acceptez ces conditions. TajirDz est une place de mise en relation, pas une partie à la vente.",
      sections: [
        {
          heading: "Rôle de TajirDz",
          body: "TajirDz référence les produits et les vendeurs et facilite le contact. Vente, paiement, livraison et règlement des litiges restent entre l'acheteur et le vendeur.",
        },
        {
          heading: "Obligations du vendeur",
          body: "Le vendeur est responsable de l'exactitude des produits, photos et prix, et du respect du droit de la consommation.",
        },
        {
          heading: "Obligations de l'acheteur",
          body: "L'acheteur s'interdit toute manipulation et l'envoi de liens ou numéros de téléphone dans les espaces publics.",
        },
        {
          heading: "Avis",
          body: "Les avis doivent être authentiques. Les avis artificiels sont supprimés et le compte suspendu.",
        },
        {
          heading: "Responsabilité",
          body: "La plateforme n'est pas responsable de la qualité des marchandises. Vérifiez avant de payer.",
        },
        {
          heading: "Service VIP",
          body: "Le service VIP est une mise en relation : description générique sans prix ni photos réelles, et contact direct entre les deux parties hors TajirDz après accord du grossiste. L'accord et le paiement se font entre vous ; TajirDz ne reçoit pas d'argent et ne garantit pas l'affaire, mais reçoit les plaintes et ferme les comptes contrevenants. Trois signalements distincts suspendent automatiquement une offre VIP, le temps d'une revue.",
        },
      ],
    },
  },
  privacy: {
    ar: {
      title: "سياسة الخصوصية",
      intro: "نجمعوا أقل قدر من البيانات و نحميوها.",
      sections: [
        {
          heading: "البيانات اللي نجمعوها",
          body: "البريد الإلكتروني، الاسم، الولاية، و الرقم ديال واتساب (للأطراف المعنيين فقط)، و سجل التقييمات و طلبات العروض.",
        },
        {
          heading: "أرقام الهواتف",
          body: "رقم التاجر ما يبانش إلا للمشترين المسجلين. رقم المشتري ما يبانش أبدا للتجار في الواجهة العامة.",
        },
        {
          heading: "ملفات التوثيق",
          body: "السجل التجاري و وثيقة الهوية محفوظين في مساحة خاصة، ما يمكنش الوصول ليهم غير المالك و الإدارة.",
        },
        {
          heading: "حقوقك",
          body: "تقدر تطلب consulted في بياناتك ولا تحيها في أي وقت عبر صفحة الاتصال.",
        },
      ],
    },
    fr: {
      title: "Politique de confidentialité",
      intro: "Nous collectons le strict minimum et le protégeons.",
      sections: [
        {
          heading: "Données collectées",
          body: "E-mail, nom, wilaya, numéro WhatsApp (parties concernées uniquement), historique d'avis et de demandes de devis.",
        },
        {
          heading: "Numéros de téléphone",
          body: "Le numéro du grossiste n'est visible que par les acheteurs inscrits. Celui de l'acheteur n'est jamais exposé publiquement.",
        },
        {
          heading: "Documents de vérification",
          body: "Registre de commerce et pièce d'identité sont stockés dans un espace privé, accessible au seul propriétaire et à l'administration.",
        },
        {
          heading: "Vos droits",
          body: "Vous pouvez demander la consultation ou la suppression de vos données à tout moment via la page contact.",
        },
      ],
    },
  },
  refund: {
    ar: {
      title: "سياسة الاسترجاع",
      intro: "ما كنوسطوش في المعاملات المالية، لكن احنا نوضحو المسار.",
      sections: [
        {
          heading: "اشتراك TajirDz",
          body: "الاشتراك في TajirDz كيتوقف في أي وقت من صفحة الاشتراك. خلال 3 أيام سماح بعد الانتهاء، وما كنرجعوش مدة الاستعمال بعد استهلاكها.",
        },
        {
          heading: "بضاعة مش مطابقة",
          body: "هاد المسؤولية على التاجر و المشتري. بلّغ من صفحة «أبلغ عن نصب» و الإدارة تتواصل مع التاجر.",
        },
        {
          heading: "التوصيل",
          body: "أوقفة التوصيل كيتعالج مباشرة مع شركة التوصيل (ياليدين، ZR Express، مايسترو).",
        },
      ],
    },
    fr: {
      title: "Politique de remboursement",
      intro: "Nous n'intervenons pas dans les transactions, mais voici la marche à suivre.",
      sections: [
        {
          heading: "Abonnement TajirDz",
          body: "Il peut être résilié à tout moment depuis la page d'abonnement. Vous disposez de 3 jours de grâce après expiration. Aucune rétrocession des jours déjà utilisés.",
        },
        {
          heading: "Marchandise non conforme",
          body: "Cette responsabilité incombe au vendeur et à l'acheteur. Signalez via « Signaler une arnaque » et l'administration contacte le vendeur.",
        },
        {
          heading: "Livraison",
          body: "Les retards de livraison se traitent directement avec le transporteur (Yalidine, ZR Express, Maystro).",
        },
      ],
    },
  },
  scam: {
    ar: {
      title: "أبلغ عن نصب",
      intro: "الوقاية أحسن من العلاج. هاك كيفاش تحمي روحك، و كيفاش تبلّغ.",
      sections: [
        {
          heading: "علامات النصب",
          body: "ثمن معقول بزاف، طلب الدفع قبل المعاينة، طلب تواصل خارج المنصة، أو insistence باش تدخل WhatsApp مباشرة.",
        },
        {
          heading: "كيفاش تبلّغ",
          body: "استعمل زرار «إبلاغ» في صفحة المنتج ولا في البروفايل ديال التاجر، ولا املأ الاستمارة هنا و زيد التفاصيل.",
        },
        {
          heading: "شنو نحفظو",
          body: "الإبلاغ، لقطات الشاشة، و رقم التاجر. الإدارة كيتواصلو مع التاجر و كيتوقفو الحساب إلا تكرر.",
        },
      ],
    },
    fr: {
      title: "Signaler une arnaque",
      intro: "Mieux vaut prévenir. Voici comment vous protéger et signaler.",
      sections: [
        {
          heading: "Signaux d'arnaque",
          body: "Prix anormalement bas, demande de paiement avant inspection, demande de contact hors plateforme, ou insistance pour passer sur WhatsApp.",
        },
        {
          heading: "Comment signaler",
          body: "Utilisez le bouton « Signaler » sur la page produit ou le profil du vendeur, ou remplissez le formulaire ci-dessous.",
        },
        {
          heading: "Ce que nous conservons",
          body: "Le signalement, les captures d'écran et le numéro concerné. L'administration contacte le vendeur et suspend le compte en cas de récidive.",
        },
      ],
    },
  },
  contact: {
    ar: {
      title: "اتصل بنا",
      intro: "عندك سؤال ولا مشكل؟ ابعثلنا.",
      sections: [],
    },
    fr: {
      title: "Nous contacter",
      intro: "Une question ou un problème ? Écrivez-nous.",
      sections: [],
    },
  },
};

export function Legal({ page }: { page: Page }) {
  const { lang, t } = useLang();
  const copy = CONTENT[page][lang];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-xl font-bold text-black">{copy.title}</h1>
      <p className="text-sm leading-relaxed text-neutral-700">{copy.intro}</p>

      <div className="space-y-4">
        {copy.sections.map((section) => (
          <section key={section.heading} className="border-s-2 border-[#006233] ps-4">
            <h2 className="text-sm font-bold text-black">{section.heading}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700">{section.body}</p>
          </section>
        ))}
      </div>

      {page === "contact" && <ContactForm />}

      <p className="rounded-lg border border-[#e3e8e5] bg-[#eef6f1]/50 p-4 text-xs leading-relaxed text-neutral-700">
        {t.disclaimer}
      </p>
    </div>
  );
}

function ContactForm() {
  const { lang } = useLang();
  const { user } = useAuth();
  const submit = useMutation(api.notifications.submitSupportTicket);
  const [form, setForm] = useState({
    subject: "",
    body: "",
    email: user?.email ?? "",
  });
  const [busy, setBusy] = useState(false);

  const inputClass =
    "tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await submit(form);
          toast.success(lang === "ar" ? "تبعثت الرسالة" : "Message envoyé");
          setForm({ subject: "", body: "", email: form.email });
        } catch {
          toast.error(lang === "ar" ? "وقعت مشكلة" : "Une erreur est survenue");
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-3 rounded-lg border border-[#e3e8e5] p-4"
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          {lang === "ar" ? "الموضوع" : "Sujet"}
        </span>
        <input
          required
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">Email</span>
        <input
          required
          type="email"
          dir="ltr"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className={`${inputClass} text-start`}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          {lang === "ar" ? "الرسالة" : "Message"}
        </span>
        <textarea
          required
          rows={5}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          className="w-full rounded-lg border border-[#e3e8e5] px-3 py-2 text-sm outline-none focus:border-[#006233]"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="tap-target w-full rounded-lg bg-[#006233] text-sm font-semibold text-white disabled:opacity-60"
      >
        {lang === "ar" ? "إرسال" : "Envoyer"}
      </button>
    </form>
  );
}