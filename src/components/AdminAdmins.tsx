import { useState } from "react";
import { useMutation } from "convex/react";
import { ShieldCheck, UserPlus, Trash2, Key, Mail } from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { SUPER_ADMIN_EMAILS, getExtraAdmins, saveExtraAdmin, removeExtraAdmin } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { useAuthQuery } from "@/lib/useAuthQuery";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function AdminAdmins() {
  const { lang } = useLang();
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Read backend admins
  const liveAdmins = useAuthQuery(api.admin.listAdmins, {});
  const addAdminMutation = useMutation(api.admin.addAdmin);
  const removeAdminMutation = useMutation(api.admin.removeAdmin);

  // Local storage extra admins fallback
  const [extraAdminsList, setExtraAdminsList] = useState<string[]>(getExtraAdmins);
  const [pendingRemoveEmail, setPendingRemoveEmail] = useState<string | null>(null);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error(lang === "ar" ? "يرجى إدخال بريد إلكتروني صحيح" : "Veuillez entrer une adresse email valide");
      return;
    }

    if (SUPER_ADMIN_EMAILS.includes(cleanEmail) || extraAdminsList.includes(cleanEmail)) {
      toast.info(lang === "ar" ? "هذا البريد مسجل كمسؤول بالفعل" : "Cet email est déjà administrateur");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Try backend mutation
      await addAdminMutation({ email: cleanEmail, name: nameInput.trim() || undefined }).catch(() => {
        // Fallback to local storage
      });
      // 2. Persist in local storage
      const updated = saveExtraAdmin(cleanEmail);
      setExtraAdminsList(updated);

      toast.success(
        lang === "ar"
          ? `تمت إضافة المسؤول (${cleanEmail}) بنجاح! يمكنه الآن التحكم الكامل في المنصة.`
          : `Administrateur (${cleanEmail}) ajouté avec succès!`
      );
      setEmailInput("");
      setNameInput("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (lang === "ar" ? "حدث خطأ أثناء الإضافة" : "Erreur");
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAdmin = (emailToRemove: string) => {
    if (SUPER_ADMIN_EMAILS.includes(emailToRemove)) {
      toast.error(lang === "ar" ? "لا يمكن حذف المدير العام للمنصة" : "Impossible de supprimer le super admin");
      return;
    }
    setPendingRemoveEmail(emailToRemove);
  };

  const confirmRemoveAdmin = async () => {
    const emailToRemove = pendingRemoveEmail;
    setPendingRemoveEmail(null);
    if (!emailToRemove) return;
    try {
      await removeAdminMutation({ email: emailToRemove }).catch(() => {
        // Fallback to local storage
      });
      const updated = removeExtraAdmin(emailToRemove);
      setExtraAdminsList(updated);
      toast.success(lang === "ar" ? "تم سحب صلاحيات الإدارة بنجاح" : "Administrateur retiré");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (lang === "ar" ? "خطأ أثناء الحذف" : "Erreur");
      toast.error(msg);
    }
  };

  // Compile list of all administrators
  const combinedAdminEmails: string[] = Array.from(
    new Set(
      [
        ...SUPER_ADMIN_EMAILS,
        ...(liveAdmins?.allAdminEmails ?? []),
        ...extraAdminsList,
      ].filter((x): x is string => Boolean(x)),
    ),
  );

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="rounded-2xl border border-[#006233]/20 bg-gradient-to-br from-[#eef6f1] to-white p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[#006233] p-2.5 text-white shadow-xs shrink-0">
            <ShieldCheck className="size-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-neutral-900">
              {lang === "ar" ? "إدارة مسؤولي المنصة والصلاحيات" : "Gestion des administrateurs"}
            </h2>
            <p className="text-xs text-neutral-700 leading-relaxed max-w-3xl">
              {lang === "ar"
                ? "المدير العام والمالك للمنصة هو: ramibnwantedd777@gmail.com. يمكنك هنا إضافة مسؤولين جدد ومنحهم صلاحيات كاملة لإدارة المنصة، مراجعة واعتماد الحسابات والتجار، التحكم بالمنتجات، ومتابعة مدفوعات الاشتراكات وإيصالات CCP."
                : "Le super administrateur est ramibnwantedd777@gmail.com. Vous pouvez ajouter des administrateurs supplémentaires pour gérer la plateforme, les comptes et les paiements."}
            </p>
          </div>
        </div>
      </div>

      {/* Add Admin Form */}
      <div className="rounded-2xl border border-[#e3e8e5] bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-[#e3e8e5] pb-3">
          <UserPlus className="size-5 text-[#006233]" />
          <h3 className="text-sm font-bold text-neutral-900">
            {lang === "ar" ? "إضافة مسؤول جديد للمنصة" : "Ajouter un nouvel administrateur"}
          </h3>
        </div>

        <form onSubmit={handleAddAdmin} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-email" className="block text-xs font-semibold text-neutral-800 mb-1">
                {lang === "ar" ? "البريد الإلكتروني للمسؤول *" : "Email de l'administrateur *"}
              </label>
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
                <input
                  id="admin-email"
                  type="email"
                  required
                  dir="ltr"
                  placeholder="admin@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="tap-target w-full rounded-xl border border-[#e3e8e5] bg-white ps-9 pe-3 text-xs outline-none focus:border-[#006233] focus:ring-1 focus:ring-[#006233]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="admin-name" className="block text-xs font-semibold text-neutral-800 mb-1">
                {lang === "ar" ? "اسم المسؤول / المنصب (اختياري)" : "Nom / Rôle (optionnel)"}
              </label>
              <input
                id="admin-name"
                type="text"
                placeholder={lang === "ar" ? "مثال: مسؤول مراجعة المدفوعات" : "Ex: Gestionnaire des paiements"}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="tap-target w-full rounded-xl border border-[#e3e8e5] bg-white px-3 text-xs outline-none focus:border-[#006233] focus:ring-1 focus:ring-[#006233]"
              />
            </div>
          </div>

          <div className="rounded-xl border border-[#dcefe4] bg-[#eef6f1]/60 p-3 text-xs text-neutral-700">
            <span className="font-bold text-[#006233] block mb-1">
              {lang === "ar" ? "الصلاحيات الممنوحة للمسؤول الجديد:" : "Permissions accordées:"}
            </span>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-neutral-600 list-disc list-inside">
              <li>{lang === "ar" ? "إدارة وتوثيق حسابات تجار الجملة والتجزئة" : "Gestion et vérification des comptes"}</li>
              <li>{lang === "ar" ? "مراجعة واعتماد إيصالات الدفع وطلبات CCP" : "Validation des paiements et reçus CCP"}</li>
              <li>{lang === "ar" ? "إدارة التصنيفات والدورات والمحتوى" : "Gestion du catalogue et des cours"}</li>
              <li>{lang === "ar" ? "معالجة الشكاوى والبلاغات" : "Modération des signalements"}</li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !emailInput.trim()}
            className="tap-target inline-flex items-center justify-center gap-2 rounded-xl bg-[#006233] hover:bg-[#004d29] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          >
            <UserPlus className="size-4" />
            <span>{isSubmitting ? (lang === "ar" ? "جاري الإضافة..." : "Ajout...") : (lang === "ar" ? "إضافة كمسؤول في المنصة" : "Ajouter comme administrateur")}</span>
          </button>
        </form>
      </div>

      {/* List of Current Admins */}
      <div className="rounded-2xl border border-[#e3e8e5] bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#e3e8e5] pb-3">
          <div className="flex items-center gap-2">
            <Key className="size-5 text-[#006233]" />
            <h3 className="text-sm font-bold text-neutral-900">
              {lang === "ar" ? "قائمة مسؤولي المنصة الحاليين" : "Liste des administrateurs actuels"}
            </h3>
          </div>
          <span className="rounded-full bg-[#eef6f1] px-2.5 py-0.5 text-xs font-bold text-[#006233]">
            {combinedAdminEmails.length} {lang === "ar" ? "مسؤول" : "admins"}
          </span>
        </div>

        <div className="divide-y divide-[#e3e8e5] rounded-xl border border-[#e3e8e5] overflow-hidden">
          {combinedAdminEmails.map((email) => {
            const isSuper = SUPER_ADMIN_EMAILS.includes(email);
            return (
              <div key={email} className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-white hover:bg-neutral-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-2 ${isSuper ? "bg-[#006233] text-white" : "bg-[#eef6f1] text-[#006233]"}`}>
                    <ShieldCheck className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <bdi dir="ltr" className="font-bold text-xs text-neutral-900">{email}</bdi>
                      {isSuper ? (
                        <span className="rounded-md bg-[#006233] px-2 py-0.5 text-[10px] font-bold text-white">
                          {lang === "ar" ? "المدير العام (Super Admin)" : "Super Admin"}
                        </span>
                      ) : (
                        <span className="rounded-md bg-[#eef6f1] px-2 py-0.5 text-[10px] font-bold text-[#006233] border border-[#dcefe4]">
                          {lang === "ar" ? "مسؤول المنصة (Admin)" : "Admin"}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      {isSuper
                        ? (lang === "ar" ? "مالك المنصة - كامل الصلاحيات غير قابلة للحذف" : "Propriétaire de la plateforme")
                        : (lang === "ar" ? "صلاحيات كاملة للتحكم في المنصة والحسابات والدفع" : "Accès complet gestion")}
                    </p>
                  </div>
                </div>

                <div>
                  {isSuper ? (
                    <span className="text-[11px] font-semibold text-neutral-400 px-3 py-1.5">
                      {lang === "ar" ? "حساب دائم" : "Compte permanent"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRemoveAdmin(email)}
                      className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors cursor-pointer"
                    >
                      <Trash2 className="size-3.5" />
                      <span>{lang === "ar" ? "سحب الصلاحية" : "Retirer"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <AlertDialog
        open={pendingRemoveEmail !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveEmail(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "ar" ? "سحب صلاحيات الإدارة" : "Retirer l'administrateur"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "ar"
                ? `هل أنت متأكد من سحب صلاحيات الإدارة من ${pendingRemoveEmail ?? ""}؟`
                : `Confirmer le retrait des droits d'administration pour ${pendingRemoveEmail ?? ""} ?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{lang === "ar" ? "إلغاء" : "Annuler"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmRemoveAdmin()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {lang === "ar" ? "سحب الصلاحية" : "Retirer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
