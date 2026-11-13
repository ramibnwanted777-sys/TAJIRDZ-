/**
 * Wholesaler dashboard: products, stats, reviews, quote requests, messages and
 * billing. Tabs are addressed by URL so a view can be linked directly.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation } from "convex/react";
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  Pause,
  Play,
  BarChart3,
  Star,
  FileText,
  MessageCircle,
  CreditCard,
  BadgeCheck,
  Crown,
} from "lucide-react";
import { toast } from "sonner";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import {
  CATEGORIES,
  formatDinar,
  formatDate,
  formatNumber,
} from "@/lib/catalog";
import { EmptyState } from "@/components/marketplace";
import { ProductForm } from "@/pages/ProductForm";
import { VipDashboard } from "@/components/VipDashboard";
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

type Tab = "products" | "vip" | "stats" | "reviews" | "quotes" | "messages" | "billing";

const TABS: { key: Tab; labelKey: string; icon: typeof Plus }[] = [
  { key: "products", labelKey: "dashProducts", icon: Plus },
  { key: "vip", labelKey: "vipOfferTitle", icon: Crown },
  { key: "stats", labelKey: "dashStats", icon: BarChart3 },
  { key: "reviews", labelKey: "dashReviews", icon: Star },
  { key: "quotes", labelKey: "dashQuotes", icon: FileText },
  { key: "messages", labelKey: "dashMessages", icon: MessageCircle },
  { key: "billing", labelKey: "dashBilling", icon: CreditCard },
];

export function Dashboard() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const active = (TABS.find((x) => x.key === tab)?.key ?? "products") as Tab;

  const myProducts = useAuthQuery(api.wholesaler.myProducts, {});
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const togglePause = useMutation(api.wholesaler.toggleProductPause);
  const duplicate = useMutation(api.wholesaler.duplicateProduct);
  const remove = useMutation(api.wholesaler.deleteProduct);

  const sub = myProducts?.sub;
  const shop = myProducts?.shop;
  const planLabel =
    sub?.plan === "pro"
      ? t.planPro
      : sub?.plan === "basic"
        ? t.planBasic
        : sub?.plan === "trial"
          ? t.planTrial
          : t.planFree;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-black">
            {myProducts?.shop?.name ?? t.navDashboard}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {shop?.verification === "approved" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#006233] px-2 py-0.5 text-white">
                <BadgeCheck className="size-3" aria-hidden />
                {t.sellerVerified}
              </span>
            ) : (
              <span className="rounded-full border border-[#e3e8e5] px-2 py-0.5 text-neutral-600">
                {t.sellerUnverified}
              </span>
            )}
            {sub ? (
              <span className="rounded-full border border-[#e3e8e5] px-2 py-0.5 text-neutral-700">
                {planLabel} · {t.expiresOn} <bdi>{formatDate(sub.expiresAt, lang)}</bdi>
              </span>
            ) : (
              <span className="rounded-full bg-[#eef6f1] px-2 py-0.5 text-[#006233]">
                {t.subscriptionInactive}
              </span>
            )}
          </div>
        </div>
        <Link
          to="/billing"
          className="tap-target inline-flex items-center justify-center rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
        >
          {t.dashBilling}
        </Link>
      </header>

      {!sub && (
        <p className="rounded-lg border border-[#e3e8e5] bg-[#eef6f1] px-4 py-3 text-xs text-neutral-700">
          {t.subscriptionHiddenNote}
        </p>
      )}

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto border-b border-[#e3e8e5]" aria-label={t.navDashboard}>
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => navigate(`/dashboard/${item.key}`)}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium ${
              active === item.key
                ? "border-[#006233] text-[#006233]"
                : "border-transparent text-neutral-600"
            }`}
          >
            <item.icon className="size-4" aria-hidden />
            {t[item.labelKey as keyof typeof t]}
          </button>
        ))}
      </nav>

      {active === "products" && (
        <section>
          {creating ? (
            <ProductForm onClose={() => setCreating(false)} />
          ) : editing ? (
            <ProductForm
              productId={editing as never}
              onClose={() => setEditing(null)}
            />
          ) : (
            <>
              <button
                onClick={() => setCreating(true)}
                className="tap-target mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#006233] text-sm font-semibold text-white"
              >
                <Plus className="size-4" aria-hidden />
                {t.dashAddProduct}
              </button>

              {myProducts === undefined ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-20 rounded-lg bg-neutral-100" />
                  ))}
                </div>
              ) : myProducts.products.length === 0 ? (
                <EmptyState title={t.dashProducts} hint={t.dashAddProduct} />
              ) : (
                <ul className="space-y-2">
                  {myProducts.products.map((product) => (
                    <li
                      key={product._id}
                      className="flex flex-col gap-3 rounded-lg border border-[#e3e8e5] p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-black">
                          {product.name}
                          {product.isPaused && (
                            <span className="ms-2 text-[10px] text-neutral-500">
                              ({t.pause})
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-600">
                          <bdi>{formatDinar(product.wholesalePriceDa, lang)}</bdi> ·{" "}
                          {t.productMinQty} <bdi>{formatNumber(product.minQty, lang)}</bdi> ·{" "}
                          <bdi>{product.reviewCount}</bdi> {t.productReviews}
                        </p>
                      </div>
                      <div className="flex flex-wrap shrink-0 gap-1.5">
                        <IconAction
                          label={t.edit}
                          onClick={() => setEditing(product._id)}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </IconAction>
                        <IconAction
                          label={t.duplicate}
                          onClick={() => duplicate({ productId: product._id })}
                        >
                          <Copy className="size-4" aria-hidden />
                        </IconAction>
                        <IconAction
                          label={product.isPaused ? t.resume : t.pause}
                          onClick={() => togglePause({ productId: product._id })}
                        >
                          {product.isPaused ? (
                            <Play className="size-4" aria-hidden />
                          ) : (
                            <Pause className="size-4" aria-hidden />
                          )}
                        </IconAction>
                        <IconAction
                          label={t.deleteProduct}
                          danger
                          onClick={() => setPendingDeleteId(product._id)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </IconAction>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <AlertDialog
                open={pendingDeleteId !== null}
                onOpenChange={(open) => {
                  if (!open) setPendingDeleteId(null);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t.deleteProduct}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {lang === "ar"
                        ? "هل أنت متأكد من حذف هذا المنتج نهائياً؟"
                        : "Voulez-vous vraiment supprimer ce produit ?"}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const id = pendingDeleteId;
                        setPendingDeleteId(null);
                        if (id) void remove({ productId: id as never });
                      }}
                      className="bg-red-600 text-white hover:bg-red-700"
                    >
                      {t.deleteProduct}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </section>
      )}

      {active === "vip" && <VipDashboard />}
      {active === "stats" && <StatsPanel />}
      {active === "reviews" && <ReviewsPanel />}
      {active === "quotes" && <QuotesPanel />}
      {active === "messages" && (
        <p className="rounded-lg border border-[#e3e8e5] p-4 text-sm text-neutral-600">
          <Link to="/messages" className="font-semibold text-[#006233] underline">
            {t.dashMessages}
          </Link>
        </p>
      )}
      {active === "billing" && (
        <p className="rounded-lg border border-[#e3e8e5] p-4 text-sm text-neutral-600">
          <Link to="/billing" className="font-semibold text-[#006233] underline">
            {t.dashBilling}
          </Link>
        </p>
      )}
    </div>
  );
}

function IconAction({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`tap-target flex items-center justify-center rounded-lg border border-[#e3e8e5] ${
        danger ? "text-red-600" : "text-black"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function StatsPanel() {
  const { t, lang } = useLang();
  const [range, setRange] = useState<"7" | "30">("7");
  const stats = useAuthQuery(
    api.wholesaler.productStats, { days: range });

  if (stats === undefined) {
    return <div className="skeleton h-32 rounded-lg bg-neutral-100" />;
  }

  const max = Math.max(1, ...stats.series.map((s) => s.views));

  return (
    <section className="space-y-4">
      <div className="flex gap-2">
        {(["7", "30"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setRange(value)}
            className={`tap-target rounded-lg px-4 text-sm ${
              range === value
                ? "bg-[#006233] text-white"
                : "border border-[#e3e8e5] text-black"
            }`}
          >
            {value === "7" ? t.stats7d : t.stats30d}
          </button>
        ))}
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { label: t.dashViews, value: stats.totals.views },
          { label: t.dashFavorites, value: stats.totals.favorites },
          { label: t.dashContacts, value: stats.totals.contacts },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#e3e8e5] p-3 text-center">
            <dt className="text-[11px] text-neutral-600">{item.label}</dt>
            <dd className="text-lg font-bold text-[#006233]">
              <bdi>{formatNumber(item.value, lang)}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      {/* Simple bar chart of daily views. */}
      <div className="rounded-lg border border-[#e3e8e5] p-4">
        <h2 className="text-sm font-bold text-black">{t.dashViews}</h2>
        <div className="mt-3 flex h-28 items-end gap-1">
          {stats.series.map((point) => (
            <div
              key={point.day}
              className="flex-1 rounded-t bg-[#006233]"
              style={{ height: `${(point.views / max) * 100}%` }}
              title={`${point.day}: ${point.views}`}
            />
          ))}
        </div>
      </div>

      {/* Horizontal scroll on a phone: `html { overflow-x: hidden }` would
          otherwise cut the columns off instead of letting them scroll. */}
      <div className="overflow-x-auto rounded-lg border border-[#e3e8e5]">
        <table className="w-full text-sm">
          <thead className="border-b border-[#e3e8e5] text-xs text-neutral-600">
            <tr>
              <th className="p-2 text-start">{t.dashProducts}</th>
              <th className="p-2 text-end">{t.dashViews}</th>
              <th className="p-2 text-end">{t.dashConversion}</th>
            </tr>
          </thead>
          <tbody>
            {stats.perProduct.slice(0, 10).map((row) => (
              <tr key={row.productId} className="border-b border-[#e3e8e5] last:border-0">
                <td className="max-w-[40%] truncate p-2">{row.name}</td>
                <td className="p-2 text-end">
                  <bdi>{formatNumber(row.views, lang)}</bdi>
                </td>
                <td className="p-2 text-end">
                  <bdi>{Math.round(row.conversion * 100)}%</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Review inbox
// ---------------------------------------------------------------------------

function ReviewsPanel() {
  const { t, lang } = useLang();
  const reviews = useAuthQuery(
    api.reviews.shopReviews, {});
  const reply = useMutation(api.reviews.replyToReview);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (reviews === undefined) {
    return <div className="skeleton h-32 rounded-lg bg-neutral-100" />;
  }
  if (reviews.length === 0) {
    return <EmptyState title={t.productNoReviews} hint={t.productNoReviewsHint} />;
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id} className="rounded-lg border border-[#e3e8e5] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/product/${review.productSlug}`} className="text-sm font-semibold text-black hover:underline">
              {review.productName}
            </Link>
            <span className="text-xs text-neutral-600">
              <Star className="inline size-3.5 text-[#006233]" aria-hidden /> <bdi>{review.productRating}/5</bdi> · {review.reviewerName}
            </span>
          </div>
          {review.comment && (
            <p className="mt-2 text-sm text-neutral-700">{review.comment}</p>
          )}

          {review.reply ? (
            <p className="mt-2 border-s-2 border-[#006233] ps-3 text-sm text-neutral-700">
              <span className="text-xs font-semibold text-[#006233]">{t.reviewReply}</span>
              <br />
              {review.reply}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={drafts[review.id] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [review.id]: e.target.value })}
                placeholder={t.reviewReply}
                maxLength={500}
                className="tap-target flex-1 rounded-lg border border-[#e3e8e5] px-3 text-sm outline-none focus:border-[#006233]"
              />
              <button
                onClick={async () => {
                  try {
                    await reply({ reviewId: review.id, reply: drafts[review.id] ?? "" });
                    toast.success(t.reviewReplied);
                  } catch {
                    toast.error(t.errGeneric);
                  }
                }}
                className="tap-target rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
              >
                {t.save}
              </button>
            </div>
          )}
        </li>
      ))}
      <li className="text-xs text-neutral-500">
        {lang === "ar"
          ? "تقدر ترد مرة وحدة على كل تقييم."
          : "Une seule réponse publique par avis."}
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Quote requests
// ---------------------------------------------------------------------------

function QuotesPanel() {
  const { t, lang } = useLang();
  const requests = useAuthQuery(
    api.contact.matchingQuoteRequests, {});
  const submitOffer = useMutation(api.contact.submitQuoteOffer);
  const [drafts, setDrafts] = useState<Record<string, { price: string; qty: string }>>({});

  if (requests === undefined) {
    return <div className="skeleton h-32 rounded-lg bg-neutral-100" />;
  }
  if (requests.length === 0) {
    return <EmptyState title={t.noQuotes} hint={t.quotesTitle} />;
  }

  return (
    <ul className="space-y-3">
      {requests.map((request) => (
        <li key={request.id} className="rounded-lg border border-[#e3e8e5] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-black">{request.productName}</h3>
            <span className="text-xs text-neutral-600">
              {CATEGORIES.find((c) => c.key === request.category)?.[lang] ?? request.category}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            {t.quoteQuantity}: <bdi>{formatNumber(request.quantity, lang)}</bdi>
            {request.targetPriceDa ? (
              <>
                {" · "}
                {t.quoteTargetPrice}: <bdi>{formatDinar(request.targetPriceDa, lang)}</bdi>
              </>
            ) : null}
          </p>
          {request.note && <p className="mt-1 text-xs text-neutral-700">{request.note}</p>}

          {request.myOffer ? (
            <p className="mt-2 rounded-lg bg-[#eef6f1] px-3 py-2 text-xs text-[#006233]">
              {t.quoteOffer}: <bdi>{formatDinar(request.myOffer.priceDa, lang)}</bdi> ·{" "}
              <bdi>{formatNumber(request.myOffer.quantityAvailable, lang)}</bdi>
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="number"
                inputMode="numeric"
                placeholder={t.quoteTargetPrice}
                value={drafts[request.id]?.price ?? ""}
                onChange={(e) =>
                  setDrafts({
                    ...drafts,
                    [request.id]: {
                      price: e.target.value,
                      qty: drafts[request.id]?.qty ?? "",
                    },
                  })
                }
                className="tap-target w-full rounded-lg border border-[#e3e8e5] px-3 text-sm sm:w-28"
              />
              <input
                type="number"
                inputMode="numeric"
                placeholder={t.quoteQuantity}
                value={drafts[request.id]?.qty ?? ""}
                onChange={(e) =>
                  setDrafts({
                    ...drafts,
                    [request.id]: {
                      price: drafts[request.id]?.price ?? "",
                      qty: e.target.value,
                    },
                  })
                }
                className="tap-target w-full rounded-lg border border-[#e3e8e5] px-3 text-sm sm:w-28"
              />
              <button
                onClick={async () => {
                  const draft = drafts[request.id];
                  if (!draft?.price || !draft.qty) return;
                  try {
                    await submitOffer({
                      requestId: request.id,
                      priceDa: Number(draft.price),
                      quantityAvailable: Number(draft.qty),
                    });
                    toast.success(t.quoteOffer);
                  } catch {
                    toast.error(t.errGeneric);
                  }
                }}
                className="tap-target flex-1 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
              >
                {t.quoteOffer}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}