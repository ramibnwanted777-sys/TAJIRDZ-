/**
 * Wholesaler VIP panel — `/dashboard/vip`.
 *
 * Three jobs, in the order the wholesaler does them:
 *
 *  1. **Offers** — create or edit a teaser (generic title/description, wilaya
 *     rules, quantity floor) and its private showcase. The teaser row carries
 *     no real name or price; everything sensitive lives behind approval.
 *  2. **Requests** — approve / reject / revoke / block. Approving repeats the
 *     one-time off-platform warning (`hasAck` kind `approval`) and always
 *     sends `acknowledged: true`, matching the server rule.
 *  3. **Slots** — the plan's VIP allowance gates creation, so the upgrade
 *     path is visible instead of a silent failure.
 *
 * Purity note: no `Date.now()` during render — expiry dates are formatted
 * from timestamps the server already computed.
 */

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { localUploadFetch } from "@/lib/localConvexClient";
import {
  Crown,
  ExternalLink,
  ImagePlus,
  Inbox,
  Lock,
  Pencil,
  Plus,
  ShieldAlert,
  Star,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { useLang } from "@/lib/lang";
import { MAX_IMAGE_BYTES, WILAYAS, formatDate, formatNumber } from "@/lib/catalog";
import { useCategories, useSelectableCategories } from "@/hooks/use-categories";
import { VIP_MAX_SHOWCASE_IMAGES } from "@/lib/vip";
import { compressImage } from "@/lib/imageUpload";
import { StorageImage } from "@/components/StorageImage";
import { EmptyState, VipBadge } from "@/components/marketplace";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** Server error keys are dictionary keys; anything else falls back to generic. */
function useErrorText() {
  const { t } = useLang();
  return (error: unknown): string => {
    const msg = error instanceof Error ? error.message : "";
    if (
      (msg.startsWith("errVip") || msg.startsWith("vipErr") || msg.startsWith("errImage")) &&
      msg in t
    ) {
      return t[msg as keyof typeof t];
    }
    return t.errGeneric;
  };
}

export function VipDashboard() {
  const { t, lang } = useLang();
  const inbox = useInboxQuery();
  const ackState = useQuery(api.vip.hasAck, { kind: "approval" });
  const ack = useMutation(api.vip.ack);
  const decide = useMutation(api.vip.decide);
  const revoke = useMutation(api.vip.revoke);
  const blockRetailer = useMutation(api.vip.blockRetailer);
  const errorText = useErrorText();

  const [filter, setFilter] = useState<"pending" | "approved" | "all">("pending");
  const [approveFor, setApproveFor] = useState<Id<"vipRequests"> | null>(null);
  const [rejectFor, setRejectFor] = useState<Id<"vipRequests"> | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editing, setEditing] = useState<InboxProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    | { kind: "revoke"; requestId: Id<"vipRequests"> }
    | { kind: "block"; row: InboxRequest }
    | null
  >(null);

  if (inbox === undefined) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-20 rounded-lg bg-neutral-100" />
        <div className="skeleton h-40 rounded-lg bg-neutral-100" />
        <div className="skeleton h-40 rounded-lg bg-neutral-100" />
      </div>
    );
  }

  const runApprove = async (requestId: Id<"vipRequests">) => {
    setBusy(String(requestId));
    try {
      await decide({ requestId, action: "approve", acknowledged: true });
      toast.success(lang === "ar" ? "توافق على الطلب" : "Demande accordée");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const approve = (requestId: Id<"vipRequests">) => {
    if (!ackState?.acked) {
      setApproveFor(requestId);
      return;
    }
    void runApprove(requestId);
  };

  const confirmAck = async () => {
    if (!approveFor) return;
    try {
      await ack({ kind: "approval" });
    } catch {
      // A duplicate ack is a no-op server-side, so press on either way.
    }
    const requestId = approveFor;
    setApproveFor(null);
    await runApprove(requestId);
  };

  const reject = async () => {
    if (!rejectFor) return;
    setBusy(String(rejectFor));
    try {
      await decide({
        requestId: rejectFor,
        action: "reject",
        reason: rejectReason.trim() || undefined,
        acknowledged: false,
      });
      setRejectFor(null);
      setRejectReason("");
      toast.success(lang === "ar" ? "تم الرد على الطلب" : "Demande répondue");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const executeRevoke = async (requestId: Id<"vipRequests">) => {
    setBusy(String(requestId));
    try {
      await revoke({ requestId });
      toast.success(t.vipRevoke);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const executeBlock = async (row: InboxRequest) => {
    setBusy(String(row.request._id));
    try {
      await blockRetailer({ userId: row.retailer.id, block: !row.blocked });
      toast.success(row.blocked ? t.vipUnblock : t.vipBlock);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const doRevoke = (requestId: Id<"vipRequests">) => {
    setPendingAction({ kind: "revoke", requestId });
  };

  const toggleBlock = (row: InboxRequest) => {
    if (!row.blocked) {
      setPendingAction({ kind: "block", row });
      return;
    }
    void executeBlock(row);
  };

  const rows = inbox.requests.filter((row) =>
    filter === "all" ? true : row.request.status === filter,
  );
  const noSlots = inbox.slotLimit === 0;
  const slotsFull = !noSlots && inbox.products.length >= inbox.slotLimit;

  return (
    <div className="space-y-5">
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === "revoke" ? t.vipRevoke : t.vipBlock}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.kind === "revoke"
                ? lang === "ar"
                  ? "تسحب الوصول لهاد التاجر؟"
                  : "Révoquer l'accès de cet acheteur ?"
                : t.vipBlockConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                if (!action) return;
                if (action.kind === "revoke") void executeRevoke(action.requestId);
                else void executeBlock(action.row);
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {pendingAction?.kind === "revoke" ? t.vipRevoke : t.vipBlock}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* ----------------------------------------------------------- Slots */}
      <section
        className={`rounded-lg border p-4 text-sm ${
          noSlots || slotsFull
            ? "border-amber-300 bg-amber-50"
            : "border-[#e3e8e5] bg-[#eef6f1]/60"
        }`}
      >
        {noSlots ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-semibold text-amber-900">
              <Lock className="size-4 shrink-0 text-amber-600" aria-hidden />
              {t.vipSlotsFull}
            </p>
            <Link
              to="/billing"
              className="tap-target inline-flex shrink-0 items-center rounded-lg bg-[#006233] px-4 text-xs font-semibold text-white"
            >
              {t.dashBilling}
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-[#006233]">
              {t.vipSlotsUsed
                .replace("{used}", String(inbox.products.length))
                .replace("{limit}", String(inbox.slotLimit))}
            </p>
            <p className="text-xs text-neutral-600">{t.vipAutoRejectNote}</p>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- Offers */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-black">
            <Crown className="size-5 text-amber-500" aria-hidden />
            {t.vipOfferTitle}
          </h2>
          <button
            type="button"
            disabled={noSlots || slotsFull}
            onClick={() => setCreating(true)}
            className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden />
            {lang === "ar" ? "عرض جديد" : "Nouvelle offre"}
          </button>
        </div>

        {inbox.products.length === 0 ? (
          <EmptyState
            title={t.vipOfferTitle}
            hint={t.vipCreateHint}
            action={
              <button
                type="button"
                disabled={noSlots || slotsFull}
                onClick={() => setCreating(true)}
                className="tap-target mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Plus className="size-4" aria-hidden />
                {lang === "ar" ? "إنشاء أول عرض" : "Créer la première offre"}
              </button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {inbox.products.map((product) => (
              <OfferCard
                key={product.id}
                product={product}
                onEdit={() => setEditing(product)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- Requests */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-black">
            <Inbox className="size-5 text-[#006233]" aria-hidden />
            {t.vipInboxTitle}
          </h2>
          {inbox.stats.pending > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              {t.vipNewRequests.replace("{n}", String(inbox.stats.pending))}
            </span>
          )}
        </div>

        <nav
          className="flex gap-1 overflow-x-auto border-b border-[#e3e8e5]"
          aria-label={t.vipInboxTitle}
        >
          {(["pending", "approved", "all"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium ${
                filter === key
                  ? "border-[#006233] text-[#006233]"
                  : "border-transparent text-neutral-600"
              }`}
            >
              {key === "all"
                ? lang === "ar"
                  ? "الكل"
                  : "Tous"
                : key === "pending"
                  ? t.vipStatusPending
                  : t.vipStatusApproved}
            </button>
          ))}
        </nav>

        {rows.length === 0 ? (
          <EmptyState title={t.vipInboxEmpty} />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.request._id}
                className="rounded-lg border border-[#e3e8e5] bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusChipClass(row.request.status)}`}
                      >
                        {statusLabel(row.request.status, t)}
                      </span>
                      {row.blocked && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          {t.vipBlock}
                        </span>
                      )}
                      <span className="text-xs text-neutral-500">
                        {formatDate(row.request.createdAt, lang)}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-black">{row.retailer.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600">
                      {row.retailer.wilaya !== null && (
                        <span>
                          {WILAYAS.find((w) => w.code === row.retailer.wilaya)?.[lang] ??
                            String(row.retailer.wilaya)}
                        </span>
                      )}
                      <span>
                        {t.vipQuantity}:{" "}
                        <bdi>{formatNumber(row.request.quantity, lang)}</bdi>
                      </span>
                      {row.product && <span>{row.product.name}</span>}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {row.request.status === "pending" && (
                      <>
                        <button
                          type="button"
                          disabled={busy === String(row.request._id)}
                          onClick={() => approve(row.request._id)}
                          className="tap-target rounded-lg bg-[#006233] px-3 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {t.vipApprove}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectFor(row.request._id);
                            setRejectReason("");
                          }}
                          className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs font-semibold"
                        >
                          {t.vipReject}
                        </button>
                      </>
                    )}
                    {row.request.status === "approved" && (
                      <button
                        type="button"
                        disabled={busy === String(row.request._id)}
                        onClick={() => void doRevoke(row.request._id)}
                        className="tap-target rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 disabled:opacity-60"
                      >
                        {t.vipRevoke}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === String(row.request._id)}
                      onClick={() => void toggleBlock(row)}
                      className="tap-target rounded-lg border border-[#e3e8e5] px-3 text-xs font-semibold text-neutral-700 disabled:opacity-60"
                    >
                      {row.blocked ? t.vipUnblock : t.vipBlock}
                    </button>
                  </div>
                </div>

                {row.request.message && (
                  <p className="mt-2 whitespace-pre-line rounded bg-[#eef6f1] px-3 py-2 text-xs text-neutral-700">
                    {row.request.message}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" aria-hidden />
                    {t.vipMemberSince} {formatDate(row.retailer.memberSince, lang)}
                  </span>
                  <span
                    className={row.retailer.planActive ? "text-[#006233]" : "text-neutral-400"}
                  >
                    {t.vipPlanActive}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3" aria-hidden />
                    <bdi>{formatNumber(row.retailer.reviewsWritten, lang)}</bdi>{" "}
                    {t.vipReviewsWritten}
                  </span>
                  {row.retailer.reportsAgainstThem > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                      <ShieldAlert className="size-3" aria-hidden />
                      <bdi>{formatNumber(row.retailer.reportsAgainstThem, lang)}</bdi>{" "}
                      {t.vipReportsAgainst}
                    </span>
                  )}
                  {row.request.status === "pending" && (
                    <span>
                      {lang === "ar" ? "تنتهي في" : "Expire le"}{" "}
                      <bdi>{formatDate(row.request.expiresAt, lang)}</bdi>
                    </span>
                  )}
                  {(row.request.status === "rejected" ||
                    row.request.status === "expired") &&
                    row.request.decisionReason && (
                      <span className="text-red-600">{row.request.decisionReason}</span>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------- Approve ack */}
      <Dialog
        open={approveFor !== null}
        onOpenChange={(open) => !open && setApproveFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.vipAckTitle}</DialogTitle>
            <DialogDescription>{t.vipApprove}</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-neutral-700">{t.vipAckBody}</p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => void confirmAck()}
              className="tap-target w-full rounded-lg bg-[#006233] px-5 text-sm font-semibold text-white"
            >
              {t.vipAckAccept}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------------- Reject */}
      <Dialog
        open={rejectFor !== null}
        onOpenChange={(open) => !open && setRejectFor(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.vipReject}</DialogTitle>
            <DialogDescription>{t.vipRejectReason}</DialogDescription>
          </DialogHeader>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            maxLength={200}
            rows={3}
            className="w-full rounded-lg border border-[#e3e8e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#006233]"
          />
          <DialogFooter>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void reject()}
              className="tap-target w-full rounded-lg bg-black px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {t.vipReject}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------- Create / edit */}
      <TeaserDialog
        open={creating}
        onOpenChange={setCreating}
        initial={null}
      />
      <TeaserDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        initial={editing}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Mirrors `api.vip.inbox`'s products array without hand-written duplicates. */
type InboxData = NonNullable<ReturnType<typeof useInboxQuery>>;
function useInboxQuery() {
  return useQuery(api.vip.inbox, {});
}
type InboxProduct = InboxData["products"][number];
type InboxRequest = InboxData["requests"][number];

function statusChipClass(status: string): string {
  if (status === "approved") return "bg-[#006233] text-white";
  if (status === "pending") return "bg-amber-100 text-amber-800";
  if (status === "rejected") return "bg-red-100 text-red-700";
  return "bg-neutral-100 text-neutral-600";
}

function statusLabel(
  status: string,
  t: { vipStatusPending: string; vipStatusApproved: string; vipStatusRejected: string; vipStatusRevoked: string; vipStatusExpired: string },
): string {
  if (status === "pending") return t.vipStatusPending;
  if (status === "approved") return t.vipStatusApproved;
  if (status === "rejected") return t.vipStatusRejected;
  if (status === "revoked") return t.vipStatusRevoked;
  return t.vipStatusExpired;
}

// ---------------------------------------------------------------------------
// Offer card
// ---------------------------------------------------------------------------

function OfferCard({ product, onEdit }: { product: InboxProduct; onEdit: () => void }) {
  const { t, lang } = useLang();
  const setRequestsOpen = useMutation(api.vip.setRequestsOpen);
  const setVipStatus = useMutation(api.vip.setVipStatus);
  const errorText = useErrorText();

  const open = product.vip.requestsOpen && !product.isPaused;
  const active = product.vip.status === "active";

  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <article className="space-y-3 rounded-lg border border-[#e3e8e5] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <VipBadge label={t.vipBadge} />
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                active ? "bg-[#006233] text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {active
                ? lang === "ar"
                  ? "مفتوح"
                  : "Ouvert"
                : lang === "ar"
                  ? "مغلق"
                  : "Clos"}
            </span>
            {!open && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                {t.vipErrNotOpen}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-sm font-bold text-black">{product.name}</h3>
          <p className="text-xs text-neutral-600">
            {lang === "ar" ? product.categoryLabelAr : product.categoryLabelFr}
          </p>
        </div>
        <Link
          to={`/vip/${product.slug}`}
          className="tap-target inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#e3e8e5] px-2.5 text-xs font-semibold text-[#006233]"
        >
          {t.vipViewDetails}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { value: product.pending, label: t.vipStatusPending },
          { value: product.approved, label: t.vipStatusApproved },
          { value: product.requests, label: lang === "ar" ? "المجموع" : "Total" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg bg-[#eef6f1] px-2 py-1.5">
            <p className="text-sm font-bold text-[#006233]">
              <bdi>{formatNumber(stat.value, lang)}</bdi>
            </p>
            <p className="text-[10px] text-neutral-600">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void wrap(() => setRequestsOpen({ productId: product.id, open: !open }))}
          className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-[#e3e8e5] px-3 text-xs font-semibold"
        >
          {open ? t.vipPauseRequests : t.vipResumeRequests}
        </button>
        <button
          type="button"
          onClick={() =>
            void wrap(() =>
              setVipStatus({
                productId: product.id,
                status: active ? "closed" : "active",
              }),
            )
          }
          className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-[#e3e8e5] px-3 text-xs font-semibold"
        >
          {active ? t.vipCloseOffer : t.vipReopenOffer}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-[#e3e8e5] px-3 text-xs font-semibold"
        >
          <Pencil className="size-3" aria-hidden />
          {lang === "ar" ? "تعديل" : "Modifier"}
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------

function TeaserDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  initial: InboxProduct | null;
}) {
  const { t } = useLang();
  const showcase = useQuery(
    api.vip.showcase,
    open && initial ? { productId: initial.id } : "skip",
  );

  // The form mounts only once every value it needs is loaded, so its
  // `useState` initialisers receive complete data — no effect round-trip.
  const ready = !initial || showcase !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? initial.name : t.vipCreateSwitch}</DialogTitle>
          <DialogDescription>
            {initial ? t.vipShowcaseLabel : t.vipCreateHint}
          </DialogDescription>
        </DialogHeader>
        {!ready ? (
          <div className="skeleton h-64 rounded-lg bg-neutral-100" />
        ) : (
          <TeaserForm
            key={initial?.id ?? "new"}
            initial={initial}
            showcase={
              initial && showcase
                ? {
                    imageStorageIds: showcase.imageStorageIds,
                    priceHint: showcase.priceHint ?? "",
                    notes: showcase.notes ?? "",
                  }
                : { imageStorageIds: [], priceHint: "", notes: "" }
            }
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TeaserForm({
  initial,
  showcase,
  onDone,
}: {
  initial: InboxProduct | null;
  showcase: { imageStorageIds: string[]; priceHint: string; notes: string };
  onDone: () => void;
}) {
  const { t, lang } = useLang();
  const createTeaser = useMutation(api.vip.createTeaser);
  const updateTeaser = useMutation(api.vip.updateTeaser);
  const createUpload = useMutation(api.storage.createImageUpload);
  const errorText = useErrorText();

  const [category, setCategory] = useState(initial?.category ?? "");
  const categories = useCategories();
  const selectable = useSelectableCategories();
  // Same rule as the main product form: an existing teaser keeps its type even
  // if that type is now deactivated, a new one may only start on an active one.
  const categoryOptions = useMemo(() => {
    if (!initial) return selectable;
    const filed = categories.find((c) => c.key === initial.category);
    if (!filed || selectable.some((c) => c.key === filed.key)) return selectable;
    return [filed, ...selectable];
  }, [initial, categories, selectable]);
  // Derived rather than written back by an effect: a new teaser starts on the
  // first type that can still be chosen until the operator picks another.
  const effectiveCategory = useMemo(() => {
    if (initial || categoryOptions.length === 0) return category;
    if (categoryOptions.some((c) => c.key === category)) return category;
    return categoryOptions[0].key;
  }, [initial, categoryOptions, category]);
  const [title, setTitle] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [allWilayas, setAllWilayas] = useState(
    (initial?.vip.allowedWilayas.length ?? 0) === 0,
  );
  const [selectedWilayas, setSelectedWilayas] = useState<number[]>(
    initial?.vip.allowedWilayas ?? [],
  );
  const [minQty, setMinQty] = useState(initial?.minQty ?? 1);
  const [maxBuyers, setMaxBuyers] = useState(initial?.vip.maxApprovedBuyers ?? 0);
  const [requestsOpen, setRequestsOpenState] = useState(initial?.vip.requestsOpen ?? true);
  const [images, setImages] = useState<string[]>(showcase.imageStorageIds);
  const [priceHint, setPriceHint] = useState(showcase.priceHint);
  const [notes, setNotes] = useState(showcase.notes);
  const [busy, setBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImages = async (files: FileList | null) => {
    if (!files) return;
    setImageError(null);
    const remaining = VIP_MAX_SHOWCASE_IMAGES - images.length;
    const selected = Array.from(files).slice(0, remaining);
    for (const file of selected) {
      if (!file.type.startsWith("image/")) {
        setImageError(t.errImageType);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError(t.errImageSize);
        continue;
      }
      try {
        const blob = await compressImage(file);
        if (blob.size > MAX_IMAGE_BYTES) {
          setImageError(t.errImageSize);
          continue;
        }
        const { uploadUrl } = await createUpload({
          kind: "product",
          contentType: "image/jpeg",
          sizeBytes: blob.size,
        });
        const response = await localUploadFetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (!response.ok) throw new Error("upload failed");
        const { storageId } = (await response.json()) as { storageId: string };
        setImages((prev) => [...prev, storageId]);
      } catch {
        setImageError(t.errGeneric);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    if (cleanTitle.length < 6 || cleanDescription.length < 30) {
      toast.error(t.errRequired);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        category: effectiveCategory,
        teaserTitle: cleanTitle,
        teaserDescription: cleanDescription,
        allowedWilayas: allWilayas ? [] : selectedWilayas,
        minQuantity: Math.max(1, Math.round(minQty)),
        maxApprovedBuyers: Math.max(0, Math.round(maxBuyers)),
        requestsOpen,
        showcase: {
          imageStorageIds: images,
          priceHint: priceHint.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      };
      if (initial) {
        await updateTeaser({ productId: initial.id, ...payload });
      } else {
        await createTeaser(payload);
      }
      toast.success(t.vipSaveTeaser);
      onDone();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "tap-target w-full rounded-lg border border-[#e3e8e5] bg-white px-3 text-sm outline-none focus:border-[#006233]";

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          {t.vipTeaserTitleLabel}
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          {t.vipTeaserDescLabel}
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={600}
          rows={3}
          className="w-full rounded-lg border border-[#e3e8e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#006233]"
        />
        <span className="mt-1 block text-[11px] text-neutral-500">
          {t.vipTeaserDescHint}
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          {t.filterCategory}
        </span>
        <select
          value={effectiveCategory}
          onChange={(e) => setCategory(e.target.value)}
          className={fieldClass}
        >
          {categoryOptions.map((c) => (
            <option key={c.key} value={c.key}>
              {lang === "ar" ? c.ar : c.fr}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-neutral-700">
          {t.vipAllowedWilayas}
        </legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm">
          <input
            type="checkbox"
            checked={allWilayas}
            onChange={(e) => setAllWilayas(e.target.checked)}
            className="accent-[#006233]"
          />
          {lang === "ar" ? "كل الولايات (بدون تصفية)" : "Toutes les wilayas (sans filtre)"}
        </label>
        {!allWilayas && (
          <div className="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-[#e3e8e5] p-2 sm:grid-cols-3">
            {WILAYAS.map((w) => (
              <label
                key={w.code}
                className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={selectedWilayas.includes(w.code)}
                  onChange={(e) =>
                    setSelectedWilayas((prev) =>
                      e.target.checked
                        ? [...prev, w.code]
                        : prev.filter((code) => code !== w.code),
                    )
                  }
                  className="accent-[#006233]"
                />
                <span className="truncate">{w[lang]}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.vipMinQuantity}
          </span>
          <input
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={1}
            value={minQty}
            onChange={(e) => setMinQty(Number(e.target.value))}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            {t.vipMaxBuyers}
          </span>
          <input
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={0}
            value={maxBuyers}
            onChange={(e) => setMaxBuyers(Number(e.target.value))}
            className={fieldClass}
          />
        </label>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[#e3e8e5] px-3 text-sm">
        <input
          type="checkbox"
          checked={requestsOpen}
          onChange={(e) => setRequestsOpenState(e.target.checked)}
          className="accent-[#006233]"
        />
        {lang === "ar" ? "استقبال الطلبات" : "Recevoir les demandes"}
      </label>

      {/* --------------------------------------------------- Showcase */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
        <p className="text-xs font-bold text-amber-900">{t.vipShowcaseLabel}</p>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((id) => (
            <div
              key={id}
              className="relative aspect-square overflow-hidden rounded-lg border border-[#e3e8e5] bg-white"
            >
              <StorageImage
                storageId={id}
                alt={t.vipShowcaseImages}
                seed={initial?.slug ?? id}
                className="size-full object-cover"
              />
              <button
                type="button"
                aria-label={lang === "ar" ? "حذف الصورة" : "Supprimer l'image"}
                onClick={() => setImages((prev) => prev.filter((x) => x !== id))}
                className="absolute top-1 end-1 flex size-6 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ))}
          {images.length < VIP_MAX_SHOWCASE_IMAGES && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-amber-400 bg-white text-[10px] font-semibold text-amber-700"
            >
              <ImagePlus className="size-5" aria-hidden />
              {t.vipShowcaseImages}
            </button>
          )}
        </div>
        {imageError && <p className="mt-1 text-[11px] text-red-600">{imageError}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void onPickImages(e.target.files)}
        />

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-amber-900">
            {t.vipPriceHintLabel}
          </span>
          <input
            value={priceHint}
            onChange={(e) => setPriceHint(e.target.value)}
            maxLength={80}
            placeholder={lang === "ar" ? "مثال: 3 200 دج / 100 وحدة" : "ex : 3 200 DA / 100 u."}
            className={fieldClass}
          />
        </label>

        <label className="mt-2 block">
          <span className="mb-1 block text-xs font-medium text-amber-900">
            {t.vipShowcaseNotesLabel}
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={600}
            rows={2}
            className="w-full rounded-lg border border-[#e3e8e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#006233]"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="tap-target w-full rounded-lg bg-[#006233] px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {t.vipSaveTeaser}
      </button>
    </div>
  );
}
