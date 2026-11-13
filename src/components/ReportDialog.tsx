/**
 * Shared abuse-report dialog.
 *
 * One component so the four reasons the queue promises — scam, counterfeit,
 * leaked VIP product, harassment — read the same everywhere: on a product
 * page, a VIP teaser, a wholesaler shop, or another account. The reason is
 * required, the free-text detail is not, and the mutation rate-limits the
 * caller server-side.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { Flag } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { useLang } from "@/lib/lang";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ReportTargetType = "product" | "shop" | "review" | "message" | "user";

const REASONS = [
  { key: "scam", labelKey: "reasonScam" },
  { key: "counterfeit", labelKey: "reasonFake" },
  { key: "leaked_product", labelKey: "reasonLeaked" },
  { key: "harassment", labelKey: "reasonHarassment" },
] as const;

export function ReportDialog({
  targetType,
  targetId,
  trigger,
  className,
}: {
  targetType: ReportTargetType;
  targetId: string;
  /** Defaults to the small flag button used on product cards. */
  trigger?: React.ReactNode;
  className?: string;
}) {
  const { t, lang } = useLang();
  const report = useMutation(api.notifications.reportContent);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["key"]>("scam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await report({
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      });
      setOpen(false);
      setDetails("");
      toast.success(lang === "ar" ? "تم الإبلاغ" : "Signalement envoyé");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("errRateLimit")) {
        toast.error(lang === "ar" ? "بروك، جرّب من بعد شوية" : "Réessayez plus tard");
      } else {
        toast.error(t.errGeneric);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={t.report}
            className={
              className ??
              "tap-target flex items-center justify-center rounded-lg border border-[#e3e8e5]"
            }
          >
            <Flag className="size-4" aria-hidden />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.report}</DialogTitle>
          <DialogDescription>{t.reportReason}</DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-neutral-700">
            {t.reportReason}
          </legend>
          {REASONS.map((item) => (
            <label
              key={item.key}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm"
            >
              <input
                type="radio"
                name="report-reason"
                value={item.key}
                checked={reason === item.key}
                onChange={() => setReason(item.key)}
                className="accent-[#006233]"
              />
              <span>{t[item.labelKey]}</span>
            </label>
          ))}
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            {lang === "ar" ? "تفاصيل (اختياري)" : "Détails (optionnel)"}
          </span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={600}
            rows={3}
            className="w-full rounded-lg border border-[#e3e8e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#006233]"
          />
        </label>

        <DialogFooter>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="tap-target rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t.report}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
